import { ptBR, type Dictionary } from './pt-BR'

/**
 * The portal is written in Portuguese (Brazil). Other languages are served by
 * the Google Translate selector in the header, which rewrites the rendered
 * page on the visitor's side - so there is exactly one dictionary to keep in
 * sync with the code, and it is this one.
 *
 * Rule denials still travel as stable English codes from `src/lib/rules.ts`
 * and are turned into Portuguese here, never in the domain layer.
 */

export type Locale = 'pt-BR'

export const DEFAULT_LOCALE: Locale = 'pt-BR'

const DICTIONARIES: Record<Locale, Dictionary> = { 'pt-BR': ptBR }

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

export async function getLocale(): Promise<Locale> {
  return DEFAULT_LOCALE
}

export async function getDictionary(): Promise<Dictionary> {
  return ptBR
}

export type { Dictionary }
