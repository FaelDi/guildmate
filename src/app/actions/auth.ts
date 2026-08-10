'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AppError, runAction, type ActionResult } from '@/lib/errors'
import {
  createGuildWithLeader,
  registerAccount,
  signIn,
  signOutCurrent,
} from '@/services/accounts'

/**
 * Every auth call goes through these server actions, which talk to Supabase
 * from the server and hand the browser nothing but an httpOnly cookie.
 */

function fieldError(error: unknown): never {
  if (error instanceof z.ZodError) {
    const first = error.errors[0]
    throw new AppError('VALIDATION_ERROR', first?.message ?? 'Check the form and try again')
  }
  throw error
}

export async function signInAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    try {
      await signIn({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      })
    } catch (error) {
      fieldError(error)
    }
    return null
  })

  if (result.ok) redirect('/dashboard')
  return result
}

export async function registerAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    try {
      await registerAccount({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        guildSlug: String(formData.get('guildSlug') ?? ''),
        characterName: String(formData.get('characterName') ?? ''),
        race: String(formData.get('race') ?? 'BELLATO') as 'BELLATO' | 'CORA' | 'ACCRETIA',
        biosuit: String(formData.get('biosuit') ?? ''),
        level: Number(formData.get('level') ?? 1),
        kind: String(formData.get('kind') ?? 'MAIN') as 'MAIN' | 'ALT',
      })
      // Sign the new member straight in so they land on the dashboard.
      await signIn({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      })
    } catch (error) {
      fieldError(error)
    }
    return null
  })

  if (result.ok) redirect('/dashboard')
  return result
}

export async function createGuildAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    try {
      await createGuildWithLeader({
        guildName: String(formData.get('guildName') ?? ''),
        guildTag: String(formData.get('guildTag') ?? '') || undefined,
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        characterName: String(formData.get('characterName') ?? ''),
        race: String(formData.get('race') ?? 'BELLATO') as 'BELLATO' | 'CORA' | 'ACCRETIA',
        biosuit: String(formData.get('biosuit') ?? ''),
        level: Number(formData.get('level') ?? 1),
        kind: 'MAIN',
      })
      await signIn({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
      })
    } catch (error) {
      fieldError(error)
    }
    return null
  })

  if (result.ok) redirect('/dashboard')
  return result
}

export async function signOutAction(): Promise<void> {
  await signOutCurrent()
  redirect('/login')
}
