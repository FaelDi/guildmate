import { ClassesBoard } from '@/components/vx/classes-board'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext, getSettings } from '@/lib/session'
import { getGuildBoard, sortForClasses } from '@/services/board'
import { requirePrimaryGuild } from '@/services/guilds'

export const dynamic = 'force-dynamic'

/** "Ordem de Classes & Builds". Public, with the builds themselves members-only. */
export default async function ClassesPage() {
  const session = await getSessionContext()
  const guildId = session?.actor.guildId ?? (await requirePrimaryGuild()).id

  const [board, settings] = await Promise.all([getGuildBoard(guildId), getSettings(guildId)])

  return (
    <ClassesBoard
      rows={sortForClasses(board.rows).map((r) => ({
        mainId: r.mainId,
        userId: r.userId,
        name: r.name,
        details: session
          ? { biosuit: r.biosuit, level: r.level, combatPower: r.combatPower, build: r.build }
          : null,
      }))}
      meId={session?.actor.id ?? null}
      isAdmin={session ? isGuildAdmin(session.actor.role) : false}
      thresholds={settings}
    />
  )
}
