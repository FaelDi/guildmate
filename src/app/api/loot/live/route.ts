import { NextResponse } from 'next/server'
import { describeError } from '@/lib/errors'
import { getSessionContext } from '@/lib/session'
import { getRecentDraw } from '@/services/loot'

/**
 * The draw that just happened in the caller's guild, if any, so every open
 * screen can replay the same wheel the admin saw. Guild-scoped by the session:
 * the caller never names a guild, so there is nothing to enumerate.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getSessionContext()
    if (!session) return NextResponse.json({ draw: null }, { status: 401 })

    const draw = await getRecentDraw(session.actor.guildId, new Date())
    return NextResponse.json(
      {
        draw: draw
          ? {
              id: draw.id,
              itemName: draw.name,
              wheel: draw.drawSlices,
              winnerName: draw.winnerName,
              pointsPaid: draw.pointsPaid,
              drawnAt: draw.drawnAt?.toISOString() ?? null,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[loot-live] read failed', JSON.stringify(describeError(error)))
    return NextResponse.json({ draw: null }, { status: 500 })
  }
}
