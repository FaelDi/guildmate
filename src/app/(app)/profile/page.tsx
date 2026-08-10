import { AddCharacterForm, CharacterActions } from '@/components/character-roster'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { MAX_CHARACTERS_PER_ACCOUNT } from '@/lib/rules'
import { getDictionary } from '@/lib/i18n'
import { requireSession } from '@/lib/session'
import { listRoster } from '@/services/characters'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const { actor, user } = await requireSession()
  const roster = await listRoster(actor.id)
  const t = await getDictionary()

  const active = roster.filter((character) => character.isActive)
  const hasMain = roster.some((character) => character.kind === 'MAIN')

  return (
    <div className="space-y-6">
      <Panel title={t.profile.accountTitle} subtitle={user.email}>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <Badge value={actor.role} />
          <span>
            {active.length} {t.profile.activeCount} · {roster.length}/
            {MAX_CHARACTERS_PER_ACCOUNT} {t.profile.slotsUsed}
          </span>
        </div>
      </Panel>

      <Panel
        title={t.profile.rosterTitle}
        subtitle={t.profile.rosterSubtitle}
      >
        {roster.length === 0 ? (
          <Empty>{t.dashboard.noCharacters}</Empty>
        ) : (
          <Table head={t.profile.rosterHead}>
            {roster.map((character) => (
              <tr key={character.id} className={character.isActive ? '' : 'opacity-50'}>
                <td className="px-3 py-2.5 font-medium text-ink">{character.name}</td>
                <td className="px-3 py-2.5">
                  <Badge value={character.kind} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge value={character.race} />
                </td>
                <td className="px-3 py-2.5 text-muted">{character.biosuit}</td>
                <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{character.level}</td>
                <td className="px-3 py-2.5 align-top">
                  <CharacterActions
                    character={{
                      id: character.id,
                      name: character.name,
                      kind: character.kind,
                      biosuit: character.biosuit,
                      level: character.level,
                      isActive: character.isActive,
                    }}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={t.profile.addTitle}>
        <AddCharacterForm
          hasMain={hasMain}
          full={roster.length >= MAX_CHARACTERS_PER_ACCOUNT}
        />
      </Panel>
    </div>
  )
}
