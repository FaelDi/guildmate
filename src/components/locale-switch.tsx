import { setLocaleAction } from '@/app/actions/locale'
import { dictionaryFor, getLocale, otherLocale } from '@/lib/i18n'

/**
 * The language toggle. A form, not a link: switching writes a cookie, and a
 * GET that changes state is a request every crawler and prefetcher will make
 * for you.
 */
export async function LocaleSwitch({ className = '' }: { className?: string }) {
  const locale = await getLocale()
  const target = otherLocale(locale)

  return (
    <form action={setLocaleAction} className={className}>
      <input type="hidden" name="locale" value={target} />
      <button
        type="submit"
        lang={target}
        aria-label={dictionaryFor(locale).locale.label}
        className="notch-control border border-edge px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-ore/50 hover:text-ore"
      >
        {dictionaryFor(locale).locale.switchTo}
      </button>
    </form>
  )
}
