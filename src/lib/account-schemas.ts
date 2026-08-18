import { z } from 'zod'

/**
 * Sign-up input shapes, shared by the join flow (`services/accounts`) and the
 * guild-creation flow (`services/invites`). They live here, away from any
 * database import, so the boundary validation is testable on its own.
 */

export const passwordSchema = z
  .string()
  .min(10, 'The password must have at least 10 characters')
  .max(200)

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  /**
   * Absent when a recruitment token names the guild - the join form hides the
   * picker entirely in that case, so the empty string an unfilled form field
   * submits counts as absent, not as a malformed slug.
   */
  guildSlug: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(2).max(60).optional(),
  ),
  characterName: z.string().trim().min(2).max(40),
  race: z.enum(['BELLATO', 'CORA', 'ACCRETIA']),
  biosuit: z.string().trim().min(1).max(60),
  level: z.number().int().min(1).max(999),
  kind: z.enum(['MAIN', 'ALT']),
})

export type RegisterInput = z.infer<typeof registerSchema>
