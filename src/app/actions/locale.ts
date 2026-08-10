'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, LOCALE_COOKIE, DEFAULT_LOCALE } from '@/lib/i18n'

/**
 * Switches the interface language.
 *
 * Deliberately not tied to an account: a visitor on the landing page has no
 * account yet, and the choice has to survive the sign-up they are about to do.
 * The cookie carries no identity, so it is readable by the page and lasts a
 * year.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const requested = String(formData.get('locale') ?? '')
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath('/', 'layout')
}
