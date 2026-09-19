import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { guilds } from '@/db/schema'
import { BossBoard, type ScheduleView } from '@/components/vx/boss-board'
import { isGuildAdmin, type BossSchedule } from '@/lib/rules'
import { requireSession } from '@/lib/session'
import { listBossBoard } from '@/services/bosses'

export const dynamic = 'force-dynamic'

function toView(schedule: BossSchedule): ScheduleView {
  return {
    respawnKind: schedule.respawnKind,
    intervalHours: schedule.intervalHours,
    anchorAtMs: schedule.anchorAt?.getTime() ?? null,
    dailyTimes: schedule.dailyTimes,
    weekdays: schedule.weekdays,
  }
}

/** "Escala de Bosses". Countdowns run on the client from the schedules. */
export default async function BossesPage() {
  const { actor, now } = await requireSession()
  const [board, guildRows] = await Promise.all([
    listBossBoard(actor.guildId, now),
    db.select({ name: guilds.name }).from(guilds).where(eq(guilds.id, actor.guildId)).limit(1),
  ])

  return (
    <BossBoard
      guildName={guildRows[0]?.name ?? 'Guild'}
      isAdmin={isGuildAdmin(actor.role)}
      groups={board.groups.map((g) => ({
        id: g.id,
        name: g.name,
        schedule: toView(g),
      }))}
      bosses={board.bosses.map((b) => ({
        id: b.id,
        name: b.name,
        location: b.location,
        groupId: b.groupId,
        groupName: b.groupName,
        inRotation: b.inRotation,
        schedule: b.schedule ? toView(b.schedule) : null,
        ownSchedule: b.groupId === null && b.schedule ? toView(b.schedule) : null,
      }))}
    />
  )
}
