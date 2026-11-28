import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailTokens, users } from '../db/schema.js';
import { revokeAllUserSessions, revokeOtherSessions } from './session.service.js';
import { loadRevocableAccounts, revokeAccounts } from './provider-revoke.service.js';
import type { UserRecord } from '../types/auth.types.js';

export async function getUserById(id: string): Promise<UserRecord | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    hasPassword: user.passwordHash !== null,
    emailVerified: user.emailVerified,
  };
}

export async function getUserPasswordHash(id: string): Promise<string | null> {
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
  return row?.passwordHash ?? null;
}

export async function updateName(userId: string, name: string): Promise<UserRecord | null> {
  await db.update(users).set({ name }).where(eq(users.id, userId));
  return getUserById(userId);
}

export async function updatePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId?: string,
): Promise<'ok' | 'wrong_password' | 'no_password'> {
  const hash = await getUserPasswordHash(userId);
  if (!hash) return 'no_password';

  const { verifyPassword, hashPassword } = await import('../lib/password.js');
  const ok = await verifyPassword(currentPassword, hash);
  if (!ok) return 'wrong_password';

  const newHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
  // Whoever else knew the old password is signed out, and a pending reset link dies.
  await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, 'password_reset'), isNull(emailTokens.usedAt)));
  if (currentSessionId) await revokeOtherSessions(userId, currentSessionId);
  else await revokeAllUserSessions(userId);
  return 'ok';
}

export async function deleteAccount(userId: string): Promise<void> {
  // Read the tokens before the cascade removes them; revoke only after the account is gone.
  const toRevoke = await loadRevocableAccounts(userId).catch(() => []);
  await revokeAllUserSessions(userId);
  await db.delete(users).where(eq(users.id, userId));
  await revokeAccounts(toRevoke);
}
