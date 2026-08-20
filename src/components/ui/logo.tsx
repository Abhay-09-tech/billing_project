import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The single source of truth for Perfect Vision branding.
 *
 * Every logo in the app renders through this component, so the artwork is
 * defined in exactly one place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TO REPLACE THE LOGO: drop the file in and rebuild. No code changes.
 *
 *    public/logo.svg     (preferred — stays sharp at every size)
 *    public/logo.png     (also fine — 512×512 or larger, transparent)
 *
 *  Also replace public/favicon.svg so the browser tab and phone home-screen
 *  icon match. Keep that one simple: fine detail disappears at 16px.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Tone = 'onLight' | 'onDark'

// BASE_URL is rewritten per deployment, so these resolve whether the app is
// served from the root or from /billing_project/ on GitHub Pages.
const BASE = import.meta.env.BASE_URL

/**
 * Two marks, picked by size.
 *
 * The full logo carries every brand element, which is right at 64px+ on the
 * login and connect screens. In app chrome it renders at 32-40px, where that
 * detail collapses into noise, so the simplified favicon mark is used instead.
 * A logo that is unreadable at its most common size is a worse logo.
 */
const DETAILED = [`${BASE}logo.svg`, `${BASE}logo.png`]
const SIMPLE = [`${BASE}favicon.svg`, `${BASE}logo.svg`, `${BASE}logo.png`]

/**
 * Walks the candidate files, falling back to the placeholder mark.
 *
 * Returning `isCustom` lets callers drop the tinted container when real
 * artwork loads — supplied logos carry their own shape, and nesting them in
 * a tinted box produces a box-inside-a-box.
 */
function useLogoSource(detailed: boolean) {
  const list = detailed ? DETAILED : SIMPLE
  const [attempt, setAttempt] = useState(0)
  return {
    src: attempt < list.length ? list[attempt] : null,
    isCustom: attempt < list.length,
    onError: () => setAttempt((a) => a + 1),
  }
}

/** The icon only — square, never distorted. */
export function LogoMark({
  className,
  tone = 'onLight',
  detailed = false,
}: {
  className?: string
  tone?: Tone
  detailed?: boolean
}) {
  const { src, onError } = useLogoSource(detailed)

  if (src) {
    return (
      <img
        src={src}
        alt=""
        onError={onError}
        // object-contain preserves any aspect ratio instead of stretching it.
        className={cn('h-full w-full shrink-0 object-contain', className)}
      />
    )
  }
  return <PlaceholderMark className={className} tone={tone} />
}

/** Neutral stand-in, used only if no logo file is present. */
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
 *   BILLING SOFTWARE (secondary)
 *   Smart billing. Clear vision. (tagline, entry screens only)
 */
export function Logo({
  className,
  tone = 'onLight',
  size = 'md',
  showTagline = false,
  stacked = false,
}: {
  className?: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showTagline?: boolean
  /** Vertical arrangement for entry screens; horizontal for chrome. */
  stacked?: boolean
}) {
  // Entry screens get the full mark; chrome gets the simplified one.
  const detailed = size === 'lg' || size === 'xl'
  const { src, onError, isCustom } = useLogoSource(detailed)

  const box = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16 sm:h-20 sm:w-20',
  }[size]

  const primaryText = {
    sm: 'text-sm',
    md: 'text-sm',
    lg: 'text-lg',
    xl: 'text-2xl sm:text-3xl',
  }[size]

  const secondaryText = size === 'xl' ? 'text-[11px] sm:text-xs' : size === 'lg' ? 'text-sm' : 'text-xs'

  const primaryColor = tone === 'onDark' ? 'text-cream-50' : 'text-brand-900'
  const secondaryColor = tone === 'onDark' ? 'text-brand-300' : 'text-brand-600'

  const mark = (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-2xl',
        // Supplied artwork brings its own shape; only the placeholder needs a
        // tinted container behind it.
        !isCustom && (tone === 'onDark' ? 'bg-brand-800/60 p-1.5' : 'bg-brand-50 p-1.5'),
        box,
      )}
    >
      {src ? (
        <img src={src} alt="" onError={onError} className="h-full w-full object-contain" />
      ) : (
        <PlaceholderMark className="h-full w-full" tone={tone} />
      )}
    </span>
  )

  const words = (
    <span className={cn('leading-tight', stacked && 'text-center')}>
      <span className={cn('block font-semibold tracking-tight', primaryText, primaryColor)}>
        Perfect Vision
      </span>
      <span
        className={cn(
          'block font-semibold tracking-[0.18em] uppercase',
          secondaryText,
          secondaryColor,
        )}
      >
        Billing Software
      </span>
      {showTagline && (
        <span
          className={cn(
            'mt-1.5 block text-[10px] font-semibold tracking-[0.12em] uppercase',
            tone === 'onDark' ? 'text-brand-400' : 'text-brand-500',
          )}
        >
          Smart billing. Clear vision.
        </span>
      )}
    </span>
  )

  return stacked ? (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {mark}
      {words}
    </div>
  ) : (
    <div className={cn('flex items-center gap-2.5', className)}>
      {mark}
      {words}
    </div>
  )
}
