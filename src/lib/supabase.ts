import 'server-only'

import { AppError } from './errors'

/**
 * Server-side Supabase access.
 *
 * The browser never reaches Supabase. There is no `NEXT_PUBLIC_SUPABASE_*`
 * variable anywhere in this project on purpose: the project URL, the
 * publishable key and the secret key all stay on the server, and the client
 * only ever talks to this app's own origin (`/api/storage/...`). That keeps the
 * Supabase project unadvertised and means a stolen browser bundle yields no
 * credentials.
 *
 * The secret key used here BYPASSES row level security. Every caller in this
 * module must therefore have already been authenticated and authorized by the
 * route that invokes it - the key is never a substitute for an ownership check.
 */

type SupabaseConfig = {
  url: string
  secretKey: string
  bucket: string
}

function readConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL
  // New-style `sb_secret_...`, falling back to the legacy service_role JWT.
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET

  if (!url || !secretKey || !bucket) {
    throw new AppError(
      'STORAGE_UNCONFIGURED',
      'File storage is not configured on this deployment',
      503,
    )
  }
  return { url: url.replace(/\/+$/, ''), secretKey, bucket }
}

/** Uploads are limited to what a screenshot of an item legitimately needs. */
export const ALLOWED_UPLOAD_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/**
 * Object keys are namespaced by guild and owner so authorization is decidable
 * from the key alone: `guild/<guildId>/user/<userId>/<uuid>.<ext>`.
 */
const OBJECT_KEY_PATTERN =
  /^guild\/[0-9a-f-]{36}\/user\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/

export type ParsedObjectKey = { guildId: string; ownerUserId: string }

/**
 * Validates and destructures an object key. Rejects traversal, absolute paths
 * and anything that is not the exact shape this app writes, so a crafted path
 * cannot escape the caller's namespace or reach another bucket.
 */
export function parseObjectKey(key: string): ParsedObjectKey | null {
  if (key.includes('..') || key.includes('//') || key.startsWith('/')) return null
  if (!OBJECT_KEY_PATTERN.test(key)) return null

  const segments = key.split('/')
  const guildId = segments[1]
  const ownerUserId = segments[3]
  if (!guildId || !ownerUserId) return null
  return { guildId, ownerUserId }
}

export function buildObjectKey(params: {
  guildId: string
  userId: string
  objectId: string
  extension: string
}): string {
  return `guild/${params.guildId}/user/${params.userId}/${params.objectId}.${params.extension}`
}

function storageUrl(config: SupabaseConfig, key: string): string {
  // Each segment is encoded so a key can never inject a query string or escape
  // the bucket prefix.
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encoded}`
}

export async function putObject(params: {
  key: string
  body: ArrayBuffer | Uint8Array
  contentType: string
}): Promise<void> {
  const config = readConfig()
  const response = await fetch(storageUrl(config, params.key), {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': params.contentType,
      'cache-control': 'max-age=31536000',
      'x-upsert': 'false',
    },
    body: params.body as BodyInit,
    cache: 'no-store',
  })

  if (!response.ok) {
    // The upstream body can name the bucket and project; keep it in the log,
    // never in the response.
    console.error('[storage] upload failed', response.status, await safeText(response))
    throw new AppError('UPLOAD_FAILED', 'The file could not be stored', 502)
  }
}

export async function getObject(key: string): Promise<Response> {
  const config = readConfig()
  const response = await fetch(storageUrl(config, key), {
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}` },
    cache: 'no-store',
  })

  if (response.status === 404) throw new AppError('NOT_FOUND', 'File not found', 404)
  if (!response.ok) {
    console.error('[storage] download failed', response.status, await safeText(response))
    throw new AppError('DOWNLOAD_FAILED', 'The file could not be read', 502)
  }
  return response
}

export async function deleteObject(key: string): Promise<void> {
  const config = readConfig()
  const response = await fetch(storageUrl(config, key), {
    method: 'DELETE',
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}` },
    cache: 'no-store',
  })

  if (!response.ok && response.status !== 404) {
    console.error('[storage] delete failed', response.status, await safeText(response))
    throw new AppError('DELETE_FAILED', 'The file could not be deleted', 502)
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return '<unreadable>'
  }
}
