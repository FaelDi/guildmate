'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AppError, runAction, type ActionResult } from '@/lib/errors'
import { getSessionContext } from '@/lib/session'
import { registerAccount, signIn, signOutCurrent } from '@/services/accounts'
import { redeemInviteAndCreateGuild } from '@/services/invites'

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
  _previous: ActionResult<{ approved: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ approved: boolean }>> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const result = await runAction(async () => {
    let approved = false
    try {
      // No guild is posted: an open sign-up joins the guild this deployment
      // belongs to, and a recruitment token names its own.
      const created = await registerAccount(
        {
          email,
          password,
          characterName: String(formData.get('characterName') ?? ''),
          race: String(formData.get('race') ?? 'BELLATO') as 'BELLATO' | 'CORA' | 'ACCRETIA',
          biosuit: String(formData.get('biosuit') ?? ''),
          level: Number(formData.get('level')) || 0,
          kind: String(formData.get('kind') ?? 'MAIN') as 'MAIN' | 'ALT',
        },
        { token: String(formData.get('token') ?? '') },
      )
      approved = created.approved

      // Only an account somebody already vouched for can hold a session; an
      // open sign-up waits on the admin queue instead of landing signed in.
      if (approved) await signIn({ email, password })
    } catch (error) {
      fieldError(error)
    }
    return { approved }
  })

  if (result.ok && result.data.approved) redirect('/dashboard')
  return result
}

export async function createGuildAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const result = await runAction(async () => {
    try {
      // The token comes from the URL, so it is attacker-controlled like any
      // other form field: the service is what proves it is live and unspent.
      const session = await getSessionContext()

      await redeemInviteAndCreateGuild({
        actor: session?.actor ?? null,
        now: session?.now ?? new Date(),
        input: {
          token: String(formData.get('token') ?? ''),
          guildName: String(formData.get('guildName') ?? ''),
          guildTag: String(formData.get('guildTag') ?? '') || undefined,
          email: String(formData.get('email') ?? ''),
          password: String(formData.get('password') ?? ''),
          characterName: String(formData.get('characterName') ?? ''),
          race: String(formData.get('race') ?? 'BELLATO') as 'BELLATO' | 'CORA' | 'ACCRETIA',
          biosuit: String(formData.get('biosuit') ?? ''),
          level: Number(formData.get('level')) || 0,
          kind: 'MAIN',
        },
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
