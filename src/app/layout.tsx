import type { Metadata } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans, Oxanium } from 'next/font/google'
import { LocaleProvider } from '@/components/locale-provider'
import { dictionaryFor, getLocale } from '@/lib/i18n'
import './globals.css'

/**
 * Three faces, three jobs. Oxanium is angular enough to read as hardware and
 * is kept to headings and the wordmark; Plex Sans carries the prose; Plex Mono
 * carries every number, because a ledger that does not align in a column is a
 * ledger nobody audits.
 *
 * next/font self-hosts them, so no request leaves the browser for a font.
 */
const display = Oxanium({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-oxanium',
  display: 'swap',
})

const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GuildMate — Guild Portal',
  description: 'Guild registry, event scoring, point auctions and the guild store.',
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="antialiased">
        <LocaleProvider dictionary={dictionaryFor(locale)}>{children}</LocaleProvider>
      </body>
    </html>
  )
}
