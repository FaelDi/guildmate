'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavItem = { href: string; label: string }

/**
 * The command bar tabs. The active one carries the ore rail, so the terminal
 * always says which instrument you are looking at.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`border-b-2 px-2.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors ${
              active
                ? 'border-ore text-ink'
                : 'border-transparent text-muted hover:border-edge hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
