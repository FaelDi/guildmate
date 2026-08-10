/**
 * Issues a guild invite from the operator's machine.
 *
 * This is the bootstrap path: a fresh database has no users, so nobody exists
 * who could authorize the first invite from inside the app. Running this needs
 * database credentials, which is a stronger check than any web session.
 *
 *   npm run invite:new -- "Rafa - BRAZUKAS"
 *
 * Prints the link once. Only its digest is stored.
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })

async function main() {
  const { issueInviteFromOperator } = await import('../src/services/invites')

  const note = process.argv.slice(2).join(' ').trim() || null
  const origin = process.env.APP_ORIGIN?.replace(/\/+$/, '') ?? 'http://localhost:3000'

  const invite = await issueInviteFromOperator({ note: note ?? undefined, now: new Date() })

  console.info('[invite] issued, valid until', invite.expiresAt.toISOString())
  console.info(`[invite] ${origin}/register/guild?token=${invite.token}`)
  console.info('[invite] this link is shown once and cannot be recovered')
  process.exit(0)
}

main().catch((error) => {
  console.error('[invite] failed', error)
  process.exit(1)
})
