import Link from 'next/link'
import { LanguageSelector } from './language-selector'

/** The command-center header for the signed-out pages. */
export function PublicHeader({ signInLabel, joinLabel }: { signInLabel: string; joinLabel: string }) {
  return (
    <div className="header">
      <h1>
        <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          GuildMate Command Center
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
