import { redact } from './redact'
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
 * Driver-level failures that mean "the database was not reachable", as opposed
 * to a query the database rejected. postgres.js surfaces the Node socket codes
 * plus a few of its own.
 */
const DATABASE_UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
])

type ErrorReport = {
  name: string
  message: string
  /** Node/postgres.js code. Named `errorCode` so `redact` does not eat it. */
  errorCode?: string
  /** Postgres detail, present only when the server itself rejected a query. */
  postgres?: {
    severity?: string
    detail?: string
    hint?: string
    table?: string
    constraint?: string
    routine?: string
  }
  stack?: string
  cause?: ErrorReport
}

/**
 * Turns an unknown throwable into something an operator can act on.
 *
 * The user still gets a generic message - this is only for the server log. It
 * runs through `redact` for the same reason the audit trail does: an error
 * body can carry the value that failed a constraint.
 */
export function describeError(error: unknown): ErrorReport {
  if (!(error instanceof Error)) {
    return { name: 'NonError', message: String(error) }
  }

  const source = error as Error & {
    code?: unknown
    severity?: unknown
    detail?: unknown
    hint?: unknown
    table_name?: unknown
    constraint_name?: unknown
    routine?: unknown
    cause?: unknown
  }

  const postgres = {
    severity: asText(source.severity),
    detail: asText(source.detail),
    hint: asText(source.hint),
    table: asText(source.table_name),
    constraint: asText(source.constraint_name),
    routine: asText(source.routine),
  }
  const hasPostgresDetail = Object.values(postgres).some((v) => v !== undefined)

  const report: ErrorReport = {
    name: error.name,
    message: error.message,
    errorCode: asText(source.code),
    ...(hasPostgresDetail ? { postgres } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
    ...(source.cause instanceof Error ? { cause: describeError(source.cause) } : {}),
  }

  return redact(report) as ErrorReport
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

/**
 * An unreachable database is an outage, not a bug in the request. Saying so
 * costs nothing - it discloses no resource and no identity - and stops the one
 * failure an operator can actually fix from hiding behind "something went
 * wrong".
 */
function toDisplayableFailure(report: ErrorReport): { code: string; message: string } {
  if (report.errorCode && DATABASE_UNREACHABLE_CODES.has(report.errorCode)) {
    return {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Try again in a moment.',
    }
  }
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' }
}

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

    // One structured, greppable line: hosted log viewers flatten a raw Error
    // into "[object Object]" or drop everything except the message, which is
    // how a missing table and an unreachable host end up looking identical.
    const report = describeError(error)
    console.error('[action] unhandled error', JSON.stringify(report))
    return { ok: false, ...toDisplayableFailure(report) }
  }
}
