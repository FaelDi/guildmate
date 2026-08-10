import 'server-only'

import { db, type Executor } from '@/db'
import { auditLog } from '@/db/schema'
import { redact } from './redact'

export { redact }

export type AuditInput = {
  guildId: string | null
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  ipHash?: string | null
}

/**
 * Appends one entry. Call it inside the same transaction as the change it
 * describes, so a rolled-back mutation never leaves a phantom audit record.
 */
export async function recordAudit(input: AuditInput, executor: Executor = db): Promise<void> {
  await executor.insert(auditLog).values({
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : (redact(input.before) as object),
    after: input.after === undefined ? null : (redact(input.after) as object),
    ipHash: input.ipHash ?? null,
  })
}
