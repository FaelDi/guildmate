import { and, eq, isNull } from 'drizzle-orm'
import { db, type Executor } from '@/db'
import { userRestrictions } from '@/db/schema'
import type { RestrictionLike } from './rules'

/**
 * Loads the restrictions that could still be in force. Whether one actually
 * applies right now is decided by `isRestrictionInForce`, keeping the time
 * comparison in one pure, tested place instead of spread across SQL.
 */
export async function loadRestrictions(
  userId: string,
  executor: Executor = db,
): Promise<RestrictionLike[]> {
  return executor
    .select({
      type: userRestrictions.type,
      startsAt: userRestrictions.startsAt,
      expiresAt: userRestrictions.expiresAt,
      revokedAt: userRestrictions.revokedAt,
    })
    .from(userRestrictions)
    .where(and(eq(userRestrictions.userId, userId), isNull(userRestrictions.revokedAt)))
}
