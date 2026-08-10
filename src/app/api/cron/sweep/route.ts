import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { describeError } from '@/lib/errors'
import { settleAuctions } from '@/services/auctions'
import { sweepEvents } from '@/services/events'
import { expireListings } from '@/services/market'

/**
 * Scheduled reconciliation, invoked by Vercel Cron (see vercel.json).
 *
 * This is where the CEO's anti-fraud rule actually fires: an event that has not
 * reached its minimum number of registrations by the confirmation deadline is
 * cancelled and every point it awarded is reversed.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // Fail closed: an unconfigured secret must not mean an open endpoint.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date()
  const started = Date.now()

  try {
    const events = await sweepEvents(now)
    const auctions = await settleAuctions(now)
    const listingsExpired = await expireListings(now)

    const report = {
      ranAt: now.toISOString(),
      durationMs: Date.now() - started,
      events,
      auctionsSettled: auctions.settled.length,
      listingsExpired,
    }
    console.info('[cron] sweep complete', JSON.stringify(report))
    return NextResponse.json(report)
  } catch (error) {
    console.error('[cron] sweep failed', JSON.stringify(describeError(error)))
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
