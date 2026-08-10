import type { RuleFailure } from './rules'

/**
 * A failure that is safe to show the user. Anything else must surface as a
 * generic message, so an unexpected exception cannot leak internals.
 */
export class AppError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  ACCOUNT_BANNED: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_INACTIVE: 403,
  ACCOUNT_DELETED: 403,
  ACCOUNT_LOCKED: 429,
  RESTRICTED: 403,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
}

export function failureToError(failure: RuleFailure): AppError {
  return new AppError(failure.code, failure.message, STATUS_BY_CODE[failure.code] ?? 400)
}

/** Unwraps a RuleResult, throwing the mapped AppError when it denied. */
export function unwrap<T>(result: { ok: true; value: T } | RuleFailure): T {
  if (result.ok) return result.value
  throw failureToError(result)
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

/**
 * Wraps a server action so rule denials become structured, displayable results
 * and anything unexpected becomes a generic message (the details go to the
 * server log, never to the client).
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('[action] unhandled error', error)
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' }
  }
}
