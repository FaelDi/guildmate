import { cookies } from 'next/headers'
import { enUS } from './en-US'
import { ptBR, type Dictionary } from './pt-BR'

/**
 * Locale lives in a cookie, not in the URL.
 *
 * Every link in this app is shared as-is - an invite link, an event screen
 * someone screenshots - and prefixing routes with /pt would make the same
 * screen exist at two addresses for no gain. The cookie also survives sign-in,
 * so the language a visitor picked on the landing page is still theirs after
 * they have an account.
 */

export const LOCALES = ['pt-BR', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]

/** Brazilian guild, Brazilian default. */
export const DEFAULT_LOCALE: Locale = 'pt-BR'

export const LOCALE_COOKIE = 'gm_locale'

const DICTIONARIES: Record<Locale, Dictionary> = {
  'pt-BR': ptBR,
  'en-US': enUS,
}

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale)
}

/** The other one. With two locales a toggle beats a menu. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'pt-BR' ? 'en-US' : 'pt-BR'
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const stored = cookieStore.get(LOCALE_COOKIE)?.value
  return isLocale(stored) ? stored : DEFAULT_LOCALE
}

export async function getDictionary(): Promise<Dictionary> {
  return dictionaryFor(await getLocale())
}

export type { Dictionary }
