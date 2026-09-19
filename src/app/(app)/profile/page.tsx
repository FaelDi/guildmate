import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { events, pointLedger } from '@/db/schema'
import { AddCharacterForm, CharacterActions } from '@/components/character-roster'
import { Badge, Empty, Panel, Stat, Table } from '@/components/ui'
import { formatNumber } from '@/components/vx/format'
import { MAX_CHARACTERS_PER_ACCOUNT } from '@/lib/rules'
import { getDictionary } from '@/lib/i18n'
import { requireSession } from '@/lib/session'
import { listRoster } from '@/services/characters'
import { getBalance } from '@/services/points'

export const dynamic = 'force-dynamic'

/** "Meus Personagens": the member's own roster, alts included, and their statement. */
export default async function ProfilePage() {
  const { actor, user } = await requireSession()
  const t = await getDictionary()

  const [roster, balance, ledger] = await Promise.all([
    listRoster(actor.id),
    getBalance(actor.id),
    db
      .select({
        id: pointLedger.id,
        kind: pointLedger.kind,
        state: pointLedger.state,
        amount: pointLedger.amount,
        reason: pointLedger.reason,
        createdAt: pointLedger.createdAt,
        eventName: events.name,
      })
      .from(pointLedger)
      .leftJoin(events, eq(events.id, pointLedger.eventId))
      .where(eq(pointLedger.userId, actor.id))
      .orderBy(desc(pointLedger.createdAt))
      .limit(50),
  ])

  const active = roster.filter((character) => character.isActive)
  const hasMain = roster.some((character) => character.kind === 'MAIN')

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Stat label={t.dashboard.spendable} value={balance.available} tone="refined" hint={t.dashboard.spendableHint} />
        <Stat label={t.dashboard.pending} value={balance.pending} tone="ore" hint={t.dashboard.pendingHint} />
        <Stat
          label={t.common.characters}
          value={`${active.length} / ${MAX_CHARACTERS_PER_ACCOUNT}`}
          hint={user.email}
        />
      </div>

      <Panel title={t.profile.rosterTitle} subtitle={t.profile.rosterSubtitle}>
        {roster.length === 0 ? (
          <Empty>{t.dashboard.noCharacters}</Empty>
        ) : (
          <Table head={[...t.profile.rosterHead.slice(0, 5), 'CP', '']}>
            {roster.map((character) => (
              <tr key={character.id} style={{ opacity: character.isActive ? 1 : 0.5 }}>
                <td style={{ fontWeight: 700, color: '#fff' }}>{character.name}</td>
                <td>
                  <Badge value={character.kind} />
                </td>
                <td>
                  <Badge value={character.race} />
                </td>
                <td style={{ color: 'var(--neon-cyan)' }}>{character.biosuit}</td>
                <td>{character.level}</td>
                <td style={{ color: 'var(--neon-green)', fontFamily: 'var(--font-mono)' }}>
                  {formatNumber(character.combatPower)}
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  <CharacterActions
                    character={{
                      id: character.id,
                      name: character.name,
                      kind: character.kind,
                      biosuit: character.biosuit,
                      level: character.level,
                      combatPower: character.combatPower,
                      build: {
                        skill4: character.skill4,
                        skill5: character.skill5,
                        skill6: character.skill6,
                        skill7: character.skill7,
                        constant3: character.constant3,
                        painAdaptation: character.painAdaptation,
                        trinity: character.trinity,
                        techniqueMaster: character.techniqueMaster,
                      },
                      isActive: character.isActive,
                    }}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={t.profile.addTitle} tone="refined">
        <AddCharacterForm hasMain={hasMain} full={roster.length >= MAX_CHARACTERS_PER_ACCOUNT} />
      </Panel>

      <Panel title={t.vx.ledgerTitle} subtitle={t.dashboard.ledgerSubtitle} tone="ore">
        {ledger.length === 0 ? (
          <Empty>{t.dashboard.ledgerEmpty}</Empty>
        ) : (
          <Table head={t.dashboard.ledgerHead}>
            {ledger.map((entry) => (
              <tr key={entry.id}>
                <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td
                  style={{
                    fontWeight: 700,
                    color: entry.amount < 0 ? 'var(--neon-red)' : 'var(--neon-green)',
                  }}
                >
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </td>
                <td>
                  <Badge value={entry.state} />
                </td>
                <td style={{ color: 'var(--text-muted)', whiteSpace: 'normal' }}>{entry.reason}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}
