import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditLog, users } from '@/db/schema'
import { Empty, Panel, Table } from '@/components/ui'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function AuditLogPage() {
  const { actor } = await requireAdmin()

  const entries = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(eq(auditLog.guildId, actor.guildId))
    .orderBy(desc(auditLog.createdAt))
    .limit(200)

  return (
    <Panel
      title="Audit trail"
      subtitle="Append-only. Secrets and event codes are redacted before anything is written here."
    >
      {entries.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <Table head={['When', 'Actor', 'Action', 'Entity', 'Detail']}>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted">
                {entry.actorEmail ?? <span className="text-plasma">system</span>}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-ink">{entry.action}</td>
              <td className="px-3 py-2.5 text-xs text-muted">{entry.entityType}</td>
              <td className="max-w-md truncate px-3 py-2.5 font-mono text-[11px] text-muted/80">
                {entry.after ? JSON.stringify(entry.after) : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  )
}
