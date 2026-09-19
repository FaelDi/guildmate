'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

/**
 * The flag selector. The portal is written in Portuguese; any other language
 * is Google Translate rewriting the rendered page, driven by its `googtrans`
 * cookie exactly the way the widget itself sets it.
 *
 * Only public UI text reaches Google this way - the page a member is looking
 * at. The session cookies are httpOnly and never readable by the script.
 */

const LANGUAGES = [
  { code: 'pt', flag: '🇧🇷', label: 'Português' },
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'ru', flag: '🇷🇺', label: 'Русский' },
  { code: 'ja', flag: '🇯🇵', label: '日本語' },
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
  { code: 'zh-CN', flag: '🇨🇳', label: '中文' },
  { code: 'tl', flag: '🇵🇭', label: 'Filipino' },
] as const

declare global {
  interface Window {
    googleTranslateElementInit?: () => void
    google?: {
      translate: {
        TranslateElement: {
          new (options: Record<string, unknown>, elementId: string): unknown
          InlineLayout: { SIMPLE: unknown }
        }
      }
    }
  }
}

function readActiveLanguage(): string {
  const match = /googtrans=\/pt\/([a-zA-Z-]+)/.exec(document.cookie)
  return match?.[1] ?? 'pt'
}

function setLanguage(code: string): void {
  const host = window.location.hostname
  if (code === 'pt') {
    const expired = 'expires=Thu, 01 Jan 1970 00:00:00 UTC'
    document.cookie = `googtrans=; path=/; ${expired}`
    document.cookie = `googtrans=; path=/; domain=${host}; ${expired}`
  } else {
    document.cookie = `googtrans=/pt/${code}; path=/;`
    document.cookie = `googtrans=/pt/${code}; path=/; domain=${host};`
  }
  window.location.reload()
}

/**
 * Google Translate swaps text nodes for its own <font> wrappers, and React
 * then fails to remove or insert around nodes it no longer owns. This is the
 * widely used guard: tolerate the mismatch instead of crashing the page. It
 * is installed only while a translation is active.
 */
function installTranslateGuard(): void {
  const proto = Node.prototype as Node & { __gmGuarded?: boolean }
  if (proto.__gmGuarded) return
  proto.__gmGuarded = true

  const removeChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child
    return removeChild.call(this, child) as T
  }

  const insertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    node: T,
    reference: Node | null,
  ): T {
    if (reference && reference.parentNode !== this) return node
    return insertBefore.call(this, node, reference) as T
  }
}

export function LanguageSelector() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('pt')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const code = readActiveLanguage()
    setActive(code)
    if (code !== 'pt') installTranslateGuard()

    window.googleTranslateElementInit = () => {
      const google = window.google
      if (!google) return
      new google.translate.TranslateElement(
        {
          pageLanguage: 'pt',
          includedLanguages: 'en,es,fr,ru,ja,ko,zh-CN,tl',
          layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        },
        'google_translate_element',
      )
    }

    const onClick = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const flag = LANGUAGES.find((l) => l.code === active)?.flag ?? '🇧🇷'

  return (
    <>
      <div id="google_translate_element" style={{ display: 'none' }} />
      {active !== 'pt' && (
        <Script
          src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
          strategy="afterInteractive"
        />
      )}
      <div className="seletor-idioma notranslate" ref={root}>
        <button type="button" className="seletor-idioma-btn" onClick={() => setOpen((v) => !v)}>
          <span>{flag}</span> <span className="seletor-idioma-seta">▾</span>
        </button>
        <div className={`seletor-idioma-painel ${open ? 'aberto' : ''}`}>
          {LANGUAGES.map((language) => (
            <button
              key={language.code}
              type="button"
              className="idioma-opcao"
              onClick={() => setLanguage(language.code)}
            >
              <span>{language.flag}</span> {language.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
