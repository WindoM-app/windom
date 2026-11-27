import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client.js';
import { emailTokens, oauthAccounts, oauthStates, refreshSessions, userSettings, users } from '../../db/schema.js';
import { purgeSpentTokens } from '../../services/audit.service.js';
import { loginWithGoogle, refresh } from '../../services/auth.service.js';
import { updatePassword } from '../../services/me.service.js';
import { hashPassword } from '../../lib/password.js';
import { createSession, findSessionByToken, REUSE_GRACE_MS } from '../../services/session.service.js';
import { buildTestApp } from '../../test-utils/app.js';
import { closeDb, truncateAll } from '../../test-utils/db.js';
import { config } from '../../config.js';

const app = await buildTestApp();
const meta = { ip: '127.0.0.1', userAgent: 'test' };
const EMAIL = 'victim@example.com';

beforeEach(truncateAll);
afterAll(async () => {
  await app.close();
  await closeDb();
});

async function seedUser(emailVerified: boolean): Promise<string> {
  const passwordHash = await hashPassword('original-password');
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, name: 'Registrant', passwordHash, emailVerified })
    .returning({ id: users.id });
  return user.id;
}

async function seedBelongings(userId: string): Promise<void> {
  await db.insert(userSettings).values({ userId, data: {} });
  await db
    .insert(oauthAccounts)
    .values({ userId, provider: 'spotify', providerUserId: 'planted', accessTokenEnc: 'x' });
  await db.insert(emailTokens).values({
    userId,
    token: 'planted-token',
    type: 'password_reset',
    expiresAt: new Date(Date.now() + 60_000),
  });
}

const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe('Google sign-in to an address that was registered but never verified', () => {
  it('removes everything the registrant left behind', async () => {
    const userId = await seedUser(false);
    await seedBelongings(userId);
    const planted = await createSession(userId, meta);

    const tokens = await loginWithGoogle(EMAIL, 'Real Owner', meta);

    expect(await userRow(userId)).toMatchObject({ passwordHash: null, emailVerified: true, name: 'Real Owner' });
    expect(await findSessionByToken(planted)).toBeNull();
    expect(await findSessionByToken(tokens.rawRefreshToken)).not.toBeNull();
    expect(await db.select().from(oauthAccounts)).toEqual([]);
    expect(await db.select().from(emailTokens)).toEqual([]);
    expect(await db.select().from(userSettings)).toEqual([]);
  });

  it('leaves a verified account as it was', async () => {
    const userId = await seedUser(true);
    await seedBelongings(userId);
    const existing = await createSession(userId, meta);

    await loginWithGoogle(EMAIL, 'Other Name', meta);

    expect(await userRow(userId)).toMatchObject({ name: 'Registrant' });
    expect((await userRow(userId)).passwordHash).not.toBeNull();
    expect(await findSessionByToken(existing)).not.toBeNull();
    expect(await db.select().from(oauthAccounts)).toHaveLength(1);
    expect(await db.select().from(userSettings)).toHaveLength(1);
  });
});

describe('replaying a rotated refresh token', () => {
  async function rotated(): Promise<{ userId: string; old: string; next: string }> {
    const userId = await seedUser(true);
    const old = await createSession(userId, meta);
    const result = await refresh(old, meta);
    if (!result.ok) throw new Error(result.error);
    return { userId, old, next: result.data.rawRefreshToken };
  }

  /** Move every revocation into the past, beyond the grace period. */
  async function ageRevoked(): Promise<void> {
    const rows = await db.select().from(refreshSessions);
    for (const row of rows.filter((r) => r.revokedAt)) {
      await db
        .update(refreshSessions)
        .set({ revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 1000) })
        .where(eq(refreshSessions.id, row.id));
    }
  }

  it('ends every session once the grace period has passed', async () => {
    const { userId, old, next } = await rotated();
    const elsewhere = await createSession(userId, meta);
    await ageRevoked();

    expect(await refresh(old, meta)).toEqual({ ok: false, error: 'TOKEN_REUSE_DETECTED' });
    expect(await findSessionByToken(next)).toBeNull();
    expect(await findSessionByToken(elsewhere)).toBeNull();
  });

  it('is reported once: the same token cannot sign the user out again', async () => {
    const { userId, old } = await rotated();
    await ageRevoked();
    await refresh(old, meta);
    const afterwards = await createSession(userId, meta);

    expect(await refresh(old, meta)).toEqual({ ok: false, error: 'SESSION_NOT_FOUND' });
    expect(await findSessionByToken(afterwards)).not.toBeNull();
  });

  it('is forgiven inside the grace period', async () => {
    const { old, next } = await rotated();
    expect(await refresh(old, meta)).toEqual({ ok: false, error: 'SESSION_NOT_FOUND' });
    expect(await findSessionByToken(next)).not.toBeNull();
  });
});

describe('changing the password', () => {
  it('ends the other sessions and any pending reset link', async () => {
    const userId = await seedUser(true);
    await seedBelongings(userId);
    const mine = await createSession(userId, meta);
    const other = await createSession(userId, meta);
    const current = (await findSessionByToken(mine))!.id;

    expect(await updatePassword(userId, 'original-password', 'replacement-password', current)).toBe('ok');

    expect(await findSessionByToken(mine)).not.toBeNull();
    expect(await findSessionByToken(other)).toBeNull();
    expect(await db.select().from(emailTokens)).toEqual([]);
  });
});

describe('purging spent tokens', () => {
  it('removes expired rows and keeps live ones', async () => {
    const userId = await seedUser(true);
    const row = { userId, type: 'verify_email' as const };
    await db.insert(emailTokens).values([
      { ...row, token: 'old', expiresAt: new Date(Date.now() - 1000) },
      { ...row, token: 'live', expiresAt: new Date(Date.now() + 60_000) },
    ]);
    await db.insert(oauthStates).values({
      state: 'old',
      provider: 'google',
      purpose: 'login',
      expiresAt: new Date(Date.now() - 1000),
    });

    await purgeSpentTokens();

    expect((await db.select().from(emailTokens)).map((t) => t.token)).toEqual(['live']);
    expect(await db.select().from(oauthStates)).toEqual([]);
  });
});

describe('the password reset form', () => {
  it('lets the browser send its origin when posting', async () => {
    const page = await app.inject({ method: 'GET', url: '/auth/reset-password?token=abc' });
    expect(page.headers['referrer-policy']).toBe('same-origin');
    const post = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      headers: { origin: config.APP_URL, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'token=abc&newPassword=long-enough-password',
    });
    expect(post.statusCode).toBe(200);
  });

  it('answers a foreign origin with 403, not a server error', async () => {
    const response = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'null' } });
    expect(response.statusCode).toBe(403);
  });
});
