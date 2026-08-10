import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
import { rateLimit } from '@/lib/rate-limit'
import { activeRestrictionTypes } from '@/lib/rules'
import { getSessionContext } from '@/lib/session'
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  buildObjectKey,
  putObject,
} from '@/lib/supabase'

/**
 * Write half of the storage proxy: item screenshots for market listings.
 *
 * The client posts to our origin; we validate, name the object inside the
 * caller's own namespace and forward it to Supabase. The caller never chooses
 * the object key, so it cannot write into another member's prefix or overwrite
 * an existing file.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionContext()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (activeRestrictionTypes(session.restrictions, session.now).has('NO_MARKET')) {
      return NextResponse.json({ error: 'You are barred from listing items' }, { status: 403 })
    }

    const limit = rateLimit({ key: `upload:${session.actor.id}`, limit: 20, windowMs: 60 * 60_000 })
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Upload limit reached. Try again later.' }, { status: 429 })
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > MAX_UPLOAD_BYTES * 1.1) {
      return NextResponse.json({ error: 'That file is too large' }, { status: 413 })
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was provided' }, { status: 400 })
    }

    // Trust neither the declared type nor the extension: the magic bytes below
    // are the real check, and the stored content type is derived from them.
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: 'That file is empty' }, { status: 400 })
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'That file is too large' }, { status: 413 })
    }

    const detected = detectImageType(bytes)
    if (!detected || !ALLOWED_UPLOAD_TYPES.has(detected)) {
      return NextResponse.json({ error: 'Only PNG, JPEG and WebP images are allowed' }, { status: 415 })
    }

    const key = buildObjectKey({
      guildId: session.actor.guildId,
      userId: session.actor.id,
      objectId: randomUUID(),
      extension: ALLOWED_UPLOAD_TYPES.get(detected) as string,
    })

    await putObject({ key, body: bytes, contentType: detected })

    // The client only ever learns our own URL.
    return NextResponse.json({ key, url: `/api/storage/${key}` }, { status: 201 })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus })
    }
    console.error('[storage-proxy] upload failed', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}

/** Signature sniffing, so a renamed executable cannot pose as a screenshot. */
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}
