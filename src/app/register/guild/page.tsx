import Link from 'next/link'
import { CreateGuildForm } from '@/components/create-guild-form'
import { Empty, Panel } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { peekInvite } from '@/services/invites'

export const dynamic = 'force-dynamic'

export default async function CreateGuildPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token?.trim() ?? ''
  const status = token ? await peekInvite(token, new Date()) : 'UNKNOWN'
  const t = await getDictionary()
  const refusals: Record<string, string> = t.invite.refusals

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
        GuildMate
      </Link>

      {status === 'LIVE' ? (
        <Panel
          title={t.invite.createTitle}
          subtitle={t.invite.createSubtitle}
          tone="ore"
        >
          <CreateGuildForm token={token} />
        </Panel>
      ) : (
        <Panel title={t.invite.requiredTitle} tone="slag">
          <Empty>{refusals[status] ?? refusals.UNKNOWN}</Empty>
          <p className="mt-4 text-center text-xs text-muted">
            {t.auth.alreadyMember}{' '}
            <Link href="/login" className="text-ore hover:underline">
              {t.common.signIn}
            </Link>
          </p>
        </Panel>
      )}
    </main>
  )
}
