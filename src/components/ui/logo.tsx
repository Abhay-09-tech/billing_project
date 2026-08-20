import { cn } from '@/lib/utils'

/**
 * The single source of truth for Perfect Vision branding.
 *
 * Every logo in the app renders through this component — sidebar, mobile bar,
 * login, connect screen, printed invoice. When the real artwork arrives it is
 * swapped in HERE, in one place, and the whole application follows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  PLACEHOLDER NOTICE
 *  The supplied reference image never reached us, so the mark below is a
 *  neutral geometric stand-in in the coffee palette — deliberately simple,
 *  NOT an invented brand. To install the real logo:
 *
 *    1. Save it as  public/logo.svg  (preferred) or public/logo.png
 *    2. In LogoMark below, replace the <svg> with:
 *         <img src={`${import.meta.env.BASE_URL}logo.svg`} alt=""
 *              className={cn('object-contain', className)} />
 *    3. Replace public/favicon.svg with the same artwork
 *
 *  Nothing else needs editing. Proportions are preserved because every
 *  caller sizes a square box and the artwork is object-contain inside it.
 * ─────────────────────────────────────────────────────────────────────────
 */

type Tone = 'onLight' | 'onDark'

/** The icon only — square, no text. */
export function LogoMark({ className, tone = 'onLight' }: { className?: string; tone?: Tone }) {
  // Two versions so the mark stays legible on either background, rather than
  // one version fighting for contrast on both.
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
      {/* Eye outline — the optical half of the identity. */}
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
 *   Perfect Vision  (primary)
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
      {/* Clear space around the mark is preserved by the padded rounded box. */}
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
