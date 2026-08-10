'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Dictionary } from '@/lib/i18n/pt-BR'

/**
 * Client components cannot read the cookie during render, so the server layout
 * hands the whole dictionary down once. It is a few kilobytes of strings the
 * page was going to render anyway.
 */
const DictionaryContext = createContext<Dictionary | null>(null)

export function LocaleProvider({
  dictionary,
  children,
}: {
  dictionary: Dictionary
  children: ReactNode
}) {
  return <DictionaryContext.Provider value={dictionary}>{children}</DictionaryContext.Provider>
}

export function useDictionary(): Dictionary {
  const dictionary = useContext(DictionaryContext)
  if (!dictionary) {
    throw new Error('useDictionary must be used inside a LocaleProvider')
  }
  return dictionary
}

/**
 * Turns a rule denial into text the player can read. Falls back to whatever
 * the server sent, so a code nobody translated yet still says something true
 * rather than nothing.
 */
export function useErrorMessage(): (code: string, fallback: string) => string {
  const dictionary = useDictionary()
  return (code, fallback) =>
    (dictionary.errors as Record<string, string | undefined>)[code] ?? fallback
}
