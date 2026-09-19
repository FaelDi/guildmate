'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavItem = { href: string; label: string; admin?: boolean }

/**
 * The command-center tab bar. Each tab is a real route, so a tab can be
 * linked and reloaded; admin-only tabs are tinted red.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="tabs">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/admin' && pathname.startsWith(`${item.href}/`))
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`tab-btn ${item.admin ? 'admin' : ''} ${active ? 'active' : ''}`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
