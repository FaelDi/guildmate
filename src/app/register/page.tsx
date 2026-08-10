import Link from 'next/link'
import { JoinGuildForm } from '@/components/join-guild-form'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { getDictionary } from '@/lib/i18n'
import { listGuildDirectory } from '@/services/accounts'

export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const t = await getDictionary()
  const directory = await listGuildDirectory()
  const joinable = directory.filter((guild) => guild.isActive)

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl grid-cols-1 items-start gap-8 px-6 py-16 lg:grid-cols-[1fr_1fr]">
      <div className="lg:col-span-2">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
          GuildMate
        </Link>
      </div>

      <Panel title={t.auth.joinTitle} subtitle={t.auth.joinSubtitle}>
        <JoinGuildForm
          guilds={joinable.map((guild) => ({
            slug: guild.slug,
            name: guild.name,
            tag: guild.tag,
          }))}
        />

        <p className="mt-5 text-xs text-muted">
          {t.auth.alreadyMember}{' '}
          <Link href="/login" className="text-ore hover:underline">
            {t.common.signIn}
          </Link>
        </p>
      </Panel>

      <Panel
        title={t.auth.directoryTitle}
        subtitle={t.auth.directorySubtitle}
      >
        {directory.length === 0 ? (
          <Empty>{t.auth.directoryEmpty}</Empty>
        ) : (
          <Table head={t.auth.directoryHead}>
            {directory.map((guild) => (
              <tr key={guild.id}>
                <td className="px-3 py-2.5">
                  <span className="font-medium text-ink">{guild.name}</span>
                  {guild.tag && (
                    <span className="ml-1.5 font-mono text-[11px] text-muted">[{guild.tag}]</span>
                  )}
                  <div className="font-mono text-[11px] text-muted/70">{guild.slug}</div>
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={guild.isActive ? 'ACTIVE' : 'INACTIVE'} />
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-ink">{guild.members}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-refined">{guild.active}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                  {guild.suspended}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </main>
  )
}
