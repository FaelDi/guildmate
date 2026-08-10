import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Loads `.env` into `process.env` for the test run.
 *
 * Next.js does this automatically; Vitest does not. Values already present in
 * the environment win, so CI secrets are never overwritten by a local file.
 */
for (const file of ['.env', '.env.local']) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    if (key in process.env) continue

    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
