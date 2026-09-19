import { ClassesBoard } from '@/components/vx/classes-board'
import { isGuildAdmin } from '@/lib/rules'
import { getSettings, requireSession } from '@/lib/session'
import { getGuildBoard, sortForClasses } from '@/services/board'

export const dynamic = 'force-dynamic'

/** "Ordem de Classes & Builds". */
export default async function ClassesPage() {
  const { actor } = await requireSession()
  const [board, settings] = await Promise.all([getGuildBoard(actor.guildId), getSettings(actor.guildId)])

  return (
    <ClassesBoard
      rows={sortForClasses(board.rows).map((r) => ({
        id: r.mainId,
        userId: r.userId,
        name: r.name,
        biosuit: r.biosuit,
        level: r.level,
        combatPower: r.combatPower,
        build: r.build,
      }))}
      meId={actor.id}
      isAdmin={isGuildAdmin(actor.role)}
      thresholds={settings}
    />
  )
}
