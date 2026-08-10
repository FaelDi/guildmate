import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'
import { promisify } from 'node:util'

// promisify picks the no-options overload, which loses the cost parameters.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

// scrypt parameters. N=2^15 with r=8 costs roughly 100ms and ~32MB, which fits
// a serverless function and is well above the OWASP minimum.
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16

/**
 * Derives a scrypt digest in the self-describing format
 * `scrypt$N$r$p$salt$hash`, so the cost parameters can be raised later without
 * invalidating existing hashes.
 */
async function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(secret.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt's working set is ~128*N*r bytes (32MB here), above Node's 32MB
    // default. OpenSSL also needs headroom on top of that, so allow double the
    // theoretical minimum - budgeting exactly 128*N*r fails with
    // "memory limit exceeded".
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  })) as Buffer
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const hash = await derive(secret, salt)
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/**
 * Constant-time verification. Returns false instead of throwing on a malformed
 * digest so a corrupted row cannot turn into a 500 that leaks its existence.
 */
export async function verifySecret(secret: string, digest: string): Promise<boolean> {
  const parts = digest.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let expected: Buffer
  let actual: Buffer
  try {
    expected = Buffer.from(String(hashB64), 'base64')
    actual = (await scrypt(secret.normalize('NFKC'), Buffer.from(String(saltB64), 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    })) as Buffer
  } catch {
    return false
  }

  if (expected.length !== actual.length || expected.length === 0) return false
  return timingSafeEqual(expected, actual)
}

/** Unambiguous alphabet: no O/0, I/1, so codes read aloud in voice chat survive. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Generates a join code with ~5 bits of entropy per character. */
export function generateEventCode(length = 8): string {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

/** Codes are compared case-insensitively and ignoring separators players add. */
export function normalizeEventCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, '')
}

/**
 * Event codes are short enough to brute-force offline if a dump leaks, so a
 * server-side pepper is mixed in before hashing.
 */
function pepper(): string {
  return process.env.EVENT_CODE_PEPPER ?? ''
}

export async function hashEventCode(code: string): Promise<string> {
  return hashSecret(`${normalizeEventCode(code)}::${pepper()}`)
}

export async function verifyEventCode(code: string, digest: string): Promise<boolean> {
  return verifySecret(`${normalizeEventCode(code)}::${pepper()}`, digest)
}

/**
 * Deterministic blind index for a join code. Lets the redeem endpoint find the
 * event with one indexed lookup instead of running scrypt against every open
 * event, without ever storing the code itself.
 */
export function eventCodeLookup(code: string): string {
  return createHmac('sha256', pepper() || 'guildmate-dev-pepper')
    .update(normalizeEventCode(code))
    .digest('hex')
}

/**
 * One-way fingerprint for correlating registrations without storing the raw IP
 * or user agent. Keyed with the same pepper so the values are not rainbow-table
 * reversible.
 */
export function fingerprint(value: string | null | undefined): string | null {
  if (!value) return null
  return createHash('sha256').update(`${value}::${pepper()}`).digest('hex').slice(0, 32)
}
