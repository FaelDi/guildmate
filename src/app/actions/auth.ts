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

const signInInputSchema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
})

const registerInputSchema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
  characterName: z.string().max(80),
  race: z.enum(['BELLATO', 'CORA', 'ACCRETIA']),
  biosuit: z.string().max(80),
  level: z.number(),
  kind: z.enum(['MAIN', 'ALT']),
  /** Present only when the visitor arrived through a recruitment link. */
  token: z.string().max(200).optional(),
})

export async function signInAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = signInInputSchema.safeParse(input)

  const result = await runAction(async () => {
    if (!parsed.success) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
    try {
      await signIn(parsed.data)
    } catch (error) {
      fieldError(error)
    }
    return null
  })

  if (result.ok) redirect('/dashboard')
  return result
}

export async function registerAction(
  input: unknown,
): Promise<ActionResult<{ approved: boolean }>> {
  const parsed = registerInputSchema.safeParse(input)

  const result = await runAction(async () => {
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Check the form and try again')
    const { token, ...account } = parsed.data

    let approved = false
    try {
      // No guild is posted: an open sign-up joins the guild this deployment
      // belongs to, and a recruitment token names its own.
      const created = await registerAccount(account, { token })
      approved = created.approved

      // Only an account somebody already vouched for can hold a session; an
      // open sign-up waits on the admin queue instead of landing signed in.
      if (approved) await signIn({ email: account.email, password: account.password })
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
