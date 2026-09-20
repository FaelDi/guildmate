import Link from 'next/link'
import { getDictionary } from '@/lib/i18n'
import { getPrimaryGuild } from '@/services/guilds'
import { LanguageSelector } from './language-selector'

/**
 * The command-center header for the signed-out pages. It carries the guild's
 * own name: this deployment is that guild's site, not a product's.
 */
export async function PublicHeader({
  signInLabel,
  joinLabel,
}: {
  signInLabel: string
  joinLabel: string
}) {
  const [guild, t] = await Promise.all([getPrimaryGuild(), getDictionary()])

  return (
    <div className="header">
      <h1>
        <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          {guild?.name ?? 'Guild'} {t.vx.commandCenter}
        </Link>
      </h1>
      <div style={{ display: 'flex', gap: 15, alignItems: 'center', flexWrap: 'wrap' }}>
        <LanguageSelector />
        <Link href="/register" className="btn btn-success">
          {joinLabel}
        </Link>
        <Link href="/login" className="btn btn-outline">
          🔒 {signInLabel}
        </Link>
      </div>
    </div>
  )
}
