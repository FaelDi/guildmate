import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GuildMate — Guild Portal',
  description: 'Guild registry, event scoring, point auctions and the guild store.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
