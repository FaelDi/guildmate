import Link from 'next/link'
import { JoinGuildForm } from '@/components/join-guild-form'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { listGuildDirectory } from '@/services/accounts'

export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const directory = await listGuildDirectory()
  const joinable = directory.filter((guild) => guild.isActive)

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl grid-cols-1 items-start gap-8 px-6 py-16 lg:grid-cols-[1fr_1fr]">
      <div className="lg:col-span-2">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.3em] text-ore">
          GuildMate
        </Link>
      </div>

      <Panel title="Join a guild" subtitle="Your account and your first character.">
        <JoinGuildForm
          guilds={joinable.map((guild) => ({
            slug: guild.slug,
            name: guild.name,
            tag: guild.tag,
          }))}
        />

        <p className="mt-5 text-xs text-muted">
          Already a member?{' '}
          <Link href="/login" className="text-ore hover:underline">
            Sign in
          </Link>
        </p>
      </Panel>

      <Panel
        title="Guild directory"
        subtitle="Headcount only. Who is in a guild is visible to its members, not to the public."
      >
        {directory.length === 0 ? (
          <Empty>No guild has been created yet.</Empty>
        ) : (
          <Table head={['Guild', 'Status', 'Members', 'Active', 'Restricted']}>
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
