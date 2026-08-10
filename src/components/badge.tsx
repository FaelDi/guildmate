'use client'

import type { ReactNode } from 'react'
import { useDictionary } from '@/components/locale-provider'

/**
 * A status chip. The value is the domain enum - stable, English, what the
 * database stores - and the label is whatever that means in the reader's
 * language. Anything with no translation falls back to the enum itself, so a
 * new status shows up as a code instead of disappearing.
 */
const BADGE_TONES: Record<string, string> = {
  // Point and event lifecycle.
  PENDING: 'border-ore/45 bg-ore/10 text-ore',
  PENDING_CONFIRMATION: 'border-ore/45 bg-ore/10 text-ore',
  OPEN: 'border-ore/45 bg-ore/10 text-ore',
  LIVE: 'border-ore/45 bg-ore/10 text-ore',
  CONFIRMED: 'border-refined/45 bg-refined/10 text-refined',
  SETTLED: 'border-refined/45 bg-refined/10 text-refined',
  ACTIVE: 'border-refined/45 bg-refined/10 text-refined',
  SOLD: 'border-refined/45 bg-refined/10 text-refined',
  REDEEMED: 'border-refined/45 bg-refined/10 text-refined',
  CANCELLED: 'border-slag/45 bg-slag/10 text-slag',
  REVERSED: 'border-slag/45 bg-slag/10 text-slag',
  REVOKED: 'border-slag/45 bg-slag/10 text-slag',
  BANNED: 'border-slag/45 bg-slag/10 text-slag',
  DELETED: 'border-slag/55 bg-slag/15 text-slag',
  EXPIRED: 'border-edge bg-panel-raised text-muted',
  INACTIVE: 'border-edge bg-panel-raised text-muted',

  // Item rarity.
  LEGENDARY: 'border-ore/55 bg-ore/12 text-ore',
  EPIC: 'border-cora/50 bg-cora/12 text-cora',
  RARE: 'border-accretia/50 bg-accretia/12 text-accretia',
  UNCOMMON: 'border-refined/40 bg-refined/8 text-refined',
  COMMON: 'border-edge bg-panel-raised text-muted',

  // Roster.
  MAIN: 'border-ore/45 bg-ore/10 text-ore',
  ALT: 'border-edge bg-panel-raised text-muted',

  // The three nations.
  BELLATO: 'border-bellato/45 bg-bellato/10 text-bellato',
  CORA: 'border-cora/45 bg-cora/10 text-cora',
  ACCRETIA: 'border-accretia/45 bg-accretia/12 text-accretia',

  // Rank.
  LEADER: 'border-ore/50 bg-ore/12 text-ore',
  VICE_LEADER: 'border-cora/45 bg-cora/10 text-cora',
  SUPER_ADMIN: 'border-slag/45 bg-slag/10 text-slag',
  MEMBER: 'border-edge bg-panel-raised text-muted',
}

export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  const dictionary = useDictionary()
  const tone = BADGE_TONES[value] ?? 'border-edge bg-panel-raised text-muted'
  const label = (dictionary.badges as Record<string, string | undefined>)[value]

  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono text-[10px] uppercase leading-4 tracking-wider ${tone}`}
    >
      {children ?? label ?? value.replace(/_/g, ' ')}
    </span>
  )
}
