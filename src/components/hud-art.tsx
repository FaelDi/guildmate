/**
 * Drawn art, not stock art.
 *
 * Everything here is SVG generated from the same tokens as the rest of the UI,
 * so the illustration cannot drift from the palette and nothing is licensed
 * from anyone. The subject is the thing the whole app is about: an ore core
 * under contested ground, and the three nations fighting over it.
 */

/** The ore core: concentric shells around a molten centre. */
export function OreCore({ className = '' }: { className?: string }) {
  const rings = [190, 156, 122, 88]

  return (
    <svg
      viewBox="0 0 420 420"
      role="presentation"
      aria-hidden
      className={className}
      fill="none"
    >
      <defs>
        <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-ore)" stopOpacity="0.85" />
          <stop offset="45%" stopColor="var(--color-ore)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-ore)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-ore)" stopOpacity="0.55" />
          <stop offset="55%" stopColor="var(--color-cora)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-ore)" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      <circle cx="210" cy="210" r="200" fill="url(#core-glow)" />

      {/* Hex shells. Each one is cut open, the way a schematic is. */}
      {rings.map((radius, index) => (
        <polygon
          key={radius}
          points={hexagon(210, 210, radius)}
          stroke="url(#shell)"
          strokeWidth={index === 0 ? 1.5 : 1}
          strokeDasharray={index % 2 === 0 ? '2 0' : '46 14'}
          opacity={0.9 - index * 0.14}
        />
      ))}

      {/* Survey ticks around the outer shell. */}
      {Array.from({ length: 36 }, (_, i) => {
        const angle = (i * Math.PI) / 18
        const inner = 198
        const outer = i % 3 === 0 ? 212 : 205
        return (
          <line
            key={i}
            x1={210 + Math.cos(angle) * inner}
            y1={210 + Math.sin(angle) * inner}
            x2={210 + Math.cos(angle) * outer}
            y2={210 + Math.sin(angle) * outer}
            stroke="var(--color-edge)"
            strokeWidth="1"
          />
        )
      })}

      {/* The seam: raw ore on one side of the core, refined on the other. */}
      <path
        d="M120 210 L180 168 L240 226 L300 184"
        stroke="var(--color-ore)"
        strokeWidth="2"
        strokeLinecap="square"
        opacity="0.9"
      />
      <path
        d="M120 250 L180 208 L240 266 L300 224"
        stroke="var(--color-refined)"
        strokeWidth="2"
        strokeLinecap="square"
        opacity="0.55"
      />

      <circle cx="210" cy="210" r="7" fill="var(--color-ore)" />
    </svg>
  )
}

function hexagon(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`
  }).join(' ')
}

type Nation = 'BELLATO' | 'CORA' | 'ACCRETIA'

const SIGILS: Record<Nation, { color: string; blurb: string; path: string }> = {
  // A frame around a core: engineers, the nation that builds around a problem.
  BELLATO: {
    color: 'text-bellato',
    blurb: 'Engineers. Field mechs and a maintenance bill nobody warns you about.',
    path: 'M8 4 L32 4 L36 12 L36 28 L32 36 L8 36 L4 28 L4 12 Z M14 14 L26 14 L26 26 L14 26 Z',
  },
  // An open eye of force: faith, and magic that reaches from a distance.
  CORA: {
    color: 'text-cora',
    blurb: 'Faith and force. Summons that keep fighting after you look away.',
    path: 'M20 3 L34 20 L20 37 L6 20 Z M20 12 L27 20 L20 28 L13 20 Z',
  },
  // A closed plate: machines, no flesh, no healing.
  ACCRETIA: {
    color: 'text-accretia',
    blurb: 'Machines. No healers, so every push is a supply decision.',
    path: 'M6 8 L34 8 L34 32 L6 32 Z M12 14 L28 14 M12 20 L28 20 M12 26 L22 26',
  },
}

export function FactionSigil({ nation }: { nation: Nation }) {
  const sigil = SIGILS[nation]

  return (
    <div className="flex items-start gap-3">
      <svg
        viewBox="0 0 40 40"
        role="presentation"
        aria-hidden
        className={`h-9 w-9 shrink-0 ${sigil.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d={sigil.path} />
      </svg>
      <div>
        <div
          className={`font-display text-[11px] font-semibold uppercase tracking-[0.22em] ${sigil.color}`}
        >
          {nation}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{sigil.blurb}</p>
      </div>
    </div>
  )
}
