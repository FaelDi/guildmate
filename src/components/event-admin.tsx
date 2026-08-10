'use client'

import { useActionState, useState } from 'react'
import {
  cancelEventAction,
  changeEventPointsAction,
  createEventAction,
  grantPointsAction,
  rotateEventCodeAction,
} from '@/app/actions/events'
import { FormMessage, SubmitButton } from '@/components/form'
import { Field, Input, Select, Textarea } from '@/components/ui'

/**
 * The generated code is shown exactly once, here, right after creation. Only a
 * hash and a blind index are stored, so it cannot be read back later - an admin
 * who loses it rotates instead.
 */
function CodeReveal({ code }: { code: string }) {
  return (
    <div className="notch-control border border-refined/40 bg-refined/10 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-refined">
        Join code — shown only once
      </p>
      <p className="mt-1 font-mono text-3xl tracking-[0.3em] text-refined">{code}</p>
      <p className="mt-1.5 text-[11px] text-refined/80">
        Announce it now. It is stored hashed and cannot be recovered.
      </p>
    </div>
  )
}

export function CreateEventForm({ defaultTtl }: { defaultTtl: number }) {
  const [state, formAction] = useActionState(createEventAction, null)

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Event name">
        <Input name="name" required minLength={3} maxLength={120} placeholder="Chip War — Sette" />
      </Field>

      <Field label="Description">
        <Textarea name="description" maxLength={1000} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Points">
          <Input
            name="pointsValue"
            type="number"
            min={1}
            max={100000}
            required
            className="font-mono tabular-nums"
          />
        </Field>

        <Field label="Code lifetime (min)" hint="How long the code works.">
          <Input
            name="ttlMinutes"
            type="number"
            min={1}
            defaultValue={defaultTtl}
            required
            className="font-mono tabular-nums"
          />
        </Field>

        <Field label="Min participants" hint="Below this by the deadline, it cancels.">
          <Input
            name="minParticipants"
            type="number"
            min={1}
            defaultValue={3}
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <FormMessage state={state} />
      {state?.ok && <CodeReveal code={state.data.code} />}

      <SubmitButton>Create event and generate code</SubmitButton>
    </form>
  )
}

export function EventRowActions({
  eventId,
  currentPoints,
  canRotate,
}: {
  eventId: string
  currentPoints: number
  canRotate: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pointsState, pointsAction] = useActionState(changeEventPointsAction, null)
  const [rotateState, rotateAction] = useActionState(rotateEventCodeAction, null)
  const [cancelState, cancelAction] = useActionState(cancelEventAction, null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="notch-control border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:border-muted/60 hover:text-ink"
      >
        Manage
      </button>
    )
  }

  return (
    <div className="w-72 space-y-4 notch-control border border-edge bg-void/70 p-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
          close
        </button>
      </div>

      <form action={pointsAction} className="space-y-2">
        <input type="hidden" name="eventId" value={eventId} />
        <Field label="New point value" hint="Applies to everyone already registered.">
          <Input
            name="newPoints"
            type="number"
            min={1}
            defaultValue={currentPoints}
            required
            className="font-mono tabular-nums"
          />
        </Field>
        <Input name="reason" placeholder="Reason" required minLength={3} />
        <SubmitButton className="w-full">Re-score</SubmitButton>
        <FormMessage
          state={pointsState}
          success={
            pointsState?.ok
              ? `${pointsState.data.delta > 0 ? '+' : ''}${pointsState.data.delta} applied to ${pointsState.data.affected} registration(s).`
              : null
          }
        />
      </form>

      {canRotate && (
        <form action={rotateAction} className="space-y-2 border-t border-edge pt-3">
          <input type="hidden" name="eventId" value={eventId} />
          <SubmitButton variant="ghost" className="w-full">
            Rotate code
          </SubmitButton>
          <FormMessage state={rotateState} />
          {rotateState?.ok && <CodeReveal code={rotateState.data.code} />}
        </form>
      )}

      <form action={cancelAction} className="space-y-2 border-t border-edge pt-3">
        <input type="hidden" name="eventId" value={eventId} />
        <Input name="reason" placeholder="Cancellation reason" required minLength={3} />
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" name="force" className="accent-[#ff5c78]" />
          Force even if confirmed (reverses spent points)
        </label>
        <SubmitButton variant="danger" className="w-full">
          Cancel event
        </SubmitButton>
        <FormMessage state={cancelState} />
      </form>
    </div>
  )
}

export function GrantPointsForm({
  events,
  characters,
}: {
  events: { id: string; name: string; pointsValue: number }[]
  characters: { id: string; label: string }[]
}) {
  const [state, formAction] = useActionState(grantPointsAction, null)

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">
        Manual scoring requires an existing event. Create one first.
      </p>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event" hint="Points can only be granted against a real event.">
          <Select name="eventId" required>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} ({event.pointsValue} pts)
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Character" hint="Your own account is not in this list.">
          <Select name="characterId" required>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Reason">
        <Input name="reason" required minLength={3} placeholder="Attended but the code expired" />
      </Field>

      <FormMessage
        state={state}
        success={
          state?.ok
            ? `Granted ${state.data.pointsAwarded} points.${
                state.data.needsSecondApproval
                  ? ' Flagged for second-admin review: above the approval threshold.'
                  : ''
              }`
            : null
        }
      />

      <SubmitButton>Grant points</SubmitButton>
    </form>
  )
}
