import Link from 'next/link'
import { CreateGuildForm } from '@/components/create-guild-form'
import { Empty, Panel } from '@/components/ui'
import { INVITE_TTL_HOURS } from '@/lib/rules'
import { peekInvite } from '@/services/invites'

export const dynamic = 'force-dynamic'

/** What the visitor is told before they fill anything in. */
const REFUSALS: Record<string, string> = {
  UNKNOWN: 'This invite link is not valid. Ask whoever runs the server for a new one.',
  EXPIRED: `This invite has expired. They last ${INVITE_TTL_HOURS} hours — ask for a fresh link.`,
  REDEEMED: 'This invite has already been used. Each one creates exactly one guild.',
  REVOKED: 'This invite was revoked.',
}

export default async function CreateGuildPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token?.trim() ?? ''
  const status = token ? await peekInvite(token, new Date()) : 'UNKNOWN'

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
        GuildMate
      </Link>

      {status === 'LIVE' ? (
        <Panel
          title="Create a guild"
          subtitle="You become the leader. This invite is spent the moment the guild exists."
          tone="ore"
        >
          <CreateGuildForm token={token} />
        </Panel>
      ) : (
        <Panel title="Invite required" tone="slag">
          <Empty>{REFUSALS[status] ?? REFUSALS.UNKNOWN}</Empty>
          <p className="mt-4 text-center text-xs text-muted">
            Already have an account?{' '}
            <Link href="/login" className="text-ore hover:underline">
              Sign in
            </Link>
          </p>
        </Panel>
      )}
    </main>
  )
}
