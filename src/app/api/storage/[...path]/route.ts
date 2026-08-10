import { NextResponse, type NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
import { isGuildAdmin } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'
import { deleteObject, getObject, parseObjectKey } from '@/lib/supabase'

/**
 * Read/delete half of the storage proxy.
 *
 * Every byte the browser gets comes from this origin: the Supabase URL, the
 * bucket name and the service role key never leave the server. The route is
 * deny-by-default - a path that is not exactly the key shape this app writes
 * is rejected before any upstream call happens.
 *
 * The service role key bypasses RLS, so authorization is decided HERE, from the
 * key itself: `guild/<guildId>/user/<ownerId>/<uuid>.<ext>`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.httpStatus })
  }
  console.error('[storage-proxy] unhandled error', error)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}

export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const session = await getSessionContext()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const key = (await context.params).path.join('/')
    const parsed = parseObjectKey(key)
    if (!parsed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Guild scoping: members only ever read their own guild's uploads. A 404
    // rather than a 403 so the proxy does not confirm the object exists.
    if (parsed.guildId !== session.actor.guildId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const upstream = await getObject(key)
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Length': upstream.headers.get('content-length') ?? '',
        // Private: the object is guild-scoped, so no shared cache may keep it.
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const session = await getSessionContext()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const key = (await context.params).path.join('/')
    const parsed = parseObjectKey(key)
    if (!parsed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (parsed.guildId !== session.actor.guildId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Object-level authorization: the uploader, or an admin of the same guild.
    const isOwner = parsed.ownerUserId === session.actor.id
    if (!isOwner && !isGuildAdmin(session.actor.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await deleteObject(key)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
