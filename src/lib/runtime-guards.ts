import 'server-only'

/**
 * Fail-fast checks for a runtime that is configured insecurely.
 *
 * These run once, at module load, on any server path that touches the database
 * or Supabase.
 */

/**
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate verification for
 * every outbound HTTPS request in the process. With it set, the connection to
 * Supabase Auth, Storage and Postgres can be silently intercepted: an attacker
 * on the path presents any certificate and Node accepts it. Tokens, the secret
 * key and the whole database session are then readable.
 *
 * It is occasionally set to work around a corporate TLS-inspecting proxy. That
 * is survivable in local development, where this only warns. In production it
 * is refused outright - shipping with certificate verification off is worse
 * than not shipping.
 */
function assertTlsVerificationEnabled(): void {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') return

  const message =
    'NODE_TLS_REJECT_UNAUTHORIZED=0 is set: TLS certificate verification is disabled for every '
    + 'outbound request, which makes the Supabase connection interceptable. Unset it. If a '
    + 'corporate proxy requires a custom CA, point NODE_EXTRA_CA_CERTS at that CA bundle instead.'

  // `next build` also runs with NODE_ENV=production but serves no traffic, and
  // the build machine's TLS settings are not the deployment's. Throwing there
  // would only break builds on a developer box that has the variable set.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

  if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
    throw new Error(`[security] ${message}`)
  }
  console.warn(`[security] WARNING: ${message}`)
}

/**
 * EVENT_CODE_PEPPER is mixed into every event-code digest, every invite-token
 * digest, both blind indexes and every IP fingerprint. Unset, all of them fall
 * back to a constant that is visible in this repository - which means a leaked
 * database dump yields codes and tokens a reader can recompute offline.
 *
 * Development gets the fallback and a warning, because a fresh clone should
 * run. Production refuses to boot: a peppered digest with a published pepper
 * is not peppered.
 */
function assertPepperConfigured(): void {
  if ((process.env.EVENT_CODE_PEPPER ?? '').length >= 32) return

  const message =
    'EVENT_CODE_PEPPER is unset or shorter than 32 characters. Event codes, invite tokens '
    + 'and request fingerprints then fall back to a hardcoded key that is public in the '
    + 'source. Generate one with: openssl rand -hex 32'

  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

  if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
    throw new Error(`[security] ${message}`)
  }
  console.warn(`[security] WARNING: ${message}`)
}

assertTlsVerificationEnabled()
assertPepperConfigured()

export {}
