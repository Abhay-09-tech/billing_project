import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The single source of truth for Perfect Vision branding.
 *
 * Every logo in the app renders through this component — sidebar, mobile bar,
 * login, connect screen — so the artwork is defined in exactly one place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TO INSTALL THE REAL LOGO: drop the file in and rebuild. No code changes.
 *
 *    public/logo.svg     (preferred — stays sharp at every size)
 *    public/logo.png     (also fine — use at least 512×512, transparent)
 *
 *  This component looks for logo.svg, then logo.png, and falls back to the
 *  neutral placeholder mark below if neither exists. The fallback is
 *  deliberately plain geometry, NOT an invented brand.
 *
 *  Also replace public/favicon.svg with the same artwork so the browser tab
 *  and phone home-screen icon match.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Tone = 'onLight' | 'onDark'

// Vite rewrites BASE_URL per deployment, so this resolves correctly whether
// the app is served from the root or from /billing_project/ on GitHub Pages.
const CANDIDATES = [
  `${import.meta.env.BASE_URL}logo.svg`,
  `${import.meta.env.BASE_URL}logo.png`,
]

/**
 * The icon only — square, no text.
 *
 * Artwork is never stretched: the box is square and the image is
 * object-contain, so any aspect ratio is preserved with clear space around it.
 */
export function LogoMark({ className, tone = 'onLight' }: { className?: string; tone?: Tone }) {
  // Walks the candidate list on load failure, then gives up to the fallback.
  const [attempt, setAttempt] = useState(0)

  if (attempt < CANDIDATES.length) {
    return (
      <img
        src={CANDIDATES[attempt]}
        alt=""
        onError={() => setAttempt((a) => a + 1)}
        className={cn('h-full w-full shrink-0 object-contain', className)}
      />
    )
  }

  return <PlaceholderMark className={className} tone={tone} />
}

/**
 * Neutral stand-in used only until real artwork is supplied. Two versions so
 * the mark stays legible on either background rather than one fighting for
 * contrast on both.
 */
function PlaceholderMark({ className, tone = 'onLight' }: { className?: string; tone?: Tone }) {
  const ring = tone === 'onDark' ? '#F7F1E8' : '#6F4E37'
  const pupil = tone === 'onDark' ? '#C8A27A' : '#8B6F47'

  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Perfect Vision"
      fill="none"
    >
      <path
        d="M4 24s7.5-11 20-11 20 11 20 11-7.5 11-20 11S4 24 4 24Z"
        stroke={ring}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="6.5" stroke={ring} strokeWidth="3" />
      <circle cx="24" cy="24" r="2.5" fill={pupil} />
    </svg>
  )
}

/**
 * Mark plus wordmark, in the brand hierarchy:
 *   Perfect Vision   (primary)
 *   Billing Software (secondary)
 */
export function Logo({
  className,
  tone = 'onLight',
  size = 'md',
  showTagline = false,
}: {
  className?: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  showTagline?: boolean
}) {
  const box = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  const primary = size === 'lg' ? 'text-lg' : 'text-sm'
  const secondary = size === 'lg' ? 'text-sm' : 'text-xs'

  const primaryColor = tone === 'onDark' ? 'text-cream-50' : 'text-brand-900'
  const secondaryColor = tone === 'onDark' ? 'text-brand-300' : 'text-brand-600'

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {/* Padding inside the rounded box preserves clear space around the mark. */}
      <span
        className={cn(
          'flex items-center justify-center rounded-xl p-1.5',
          tone === 'onDark' ? 'bg-brand-800/60' : 'bg-brand-50',
          box,
        )}
      >
        <LogoMark className="h-full w-full" tone={tone} />
      </span>
      <span className="leading-tight">
        <span className={cn('block font-semibold tracking-tight', primary, primaryColor)}>
          Perfect Vision
        </span>
        <span className={cn('block font-medium', secondary, secondaryColor)}>Billing Software</span>
        {showTagline && (
          <span
            className={cn(
              'mt-1 block text-[10px] font-semibold tracking-[0.14em] uppercase',
              tone === 'onDark' ? 'text-brand-400' : 'text-brand-500',
            )}
          >
            Smart billing. Clear vision.
          </span>
        )}
      </span>
    </div>
  )
}
