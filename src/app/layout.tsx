import type { Metadata } from 'next'
import { Rajdhani } from 'next/font/google'
import { LocaleProvider } from '@/components/locale-provider'
import { ToastProvider } from '@/components/vx/toast'
import { dictionaryFor, getLocale } from '@/lib/i18n'
import './globals.css'

/**
 * Rajdhani everywhere: it is the command-center face, squared enough to read
 * as a game HUD and still legible at table sizes. next/font self-hosts it, so
 * no request leaves the browser for a font.
 */
const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Command Center — GuildMate',
  description: 'Ranking, builds, loot raffle and boss schedule for the guild.',
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html lang={locale} className={rajdhani.variable}>
      <body className="vx antialiased">
        <LocaleProvider dictionary={dictionaryFor(locale)}>
          <ToastProvider>{children}</ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
