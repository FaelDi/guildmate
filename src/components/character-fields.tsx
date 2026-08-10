import { RF_NEXT_BIOSUITS } from '@/lib/biosuits'
import { Field, Input, Select } from './ui'

/**
 * The character block shared by "join a guild", "create a guild" and the roster
 * screen.
 *
 * `biosuit` is free text backed by a catalogue table rather than an enum: the
 * suit list is game content that changes between RF Next updates, and an admin
 * should be able to extend it without a deploy.
 *
 * `lockKind` pins the type when the context leaves no choice: creating a guild
 * always mints a MAIN, and an account that already has one can only add ALTs.
 */
export function CharacterFields({ lockKind }: { lockKind?: 'MAIN' | 'ALT' }) {
  return (
    <>
      <Field label="Character name">
        <Input name="characterName" required minLength={2} maxLength={40} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Race">
          <Select name="race" defaultValue="BELLATO">
            <option value="BELLATO">Bellato</option>
            <option value="CORA">Cora</option>
            <option value="ACCRETIA">Accretia</option>
          </Select>
        </Field>

        <Field label="Biosuit">
          {/* Suggestions, not a whitelist: the roster is game content, and a
              private server may run suits Netmarble never shipped. */}
          <Input name="biosuit" required maxLength={60} list="biosuit-roster" placeholder="Technician" />
          <datalist id="biosuit-roster">
            {RF_NEXT_BIOSUITS.map((suit) => (
              <option key={suit} value={suit} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current level">
          <Input name="level" type="number" min={1} max={999} defaultValue={1} required />
        </Field>

        {lockKind ? (
          <input type="hidden" name="kind" value={lockKind} />
        ) : (
          <Field label="Character type" hint="Only a main character can spend points in auctions.">
            <Select name="kind" defaultValue="MAIN">
              <option value="MAIN">Main</option>
              <option value="ALT">Alt</option>
            </Select>
          </Field>
        )}
      </div>
    </>
  )
}
