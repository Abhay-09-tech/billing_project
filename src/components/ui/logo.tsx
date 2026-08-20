import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Perfect Vision brand lock-up: ONE image, nothing composed.
 *
 * The artwork file contains the whole logo — mark, "Perfect Vision",
 * "BILLING SOFTWARE" and the tagline. This component does not draw an icon,
 * does not render the product name as text beside a mark, and does not place
 * the image inside a coloured container. Earlier revisions did all three, and
 * the result was a recreated logo rather than the real one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  REQUIRED ASSET — not currently present in the project:
 *
 *      public/perfect-vision-billing-logo.png
 *
 *  Drop the complete logo artwork there (transparent background, roughly
 *  1200px wide) and it appears on the connect screen, the login screen, the
 *  sidebar and the mobile header. No code change needed.
 *
 *  A .webp or .svg of the same name also works — see SOURCES below.
 *
 *  Until that file exists, the product name renders as plain text. That is a
 *  deliberate missing-asset state, not a substitute logo: no icon is drawn,
 *  so it is obvious the artwork has not been added yet.
 * ─────────────────────────────────────────────────────────────────────────
 */

const BASE = import.meta.env.BASE_URL
const SOURCES = [
  `${BASE}perfect-vision-billing-logo.png`,
  `${BASE}perfect-vision-billing-logo.webp`,
  `${BASE}perfect-vision-billing-logo.svg`,
]

type Tone = 'onLight' | 'onDark'

export function Logo({
  className,
  tone = 'onLight',
  /** Rendered width. The image keeps its own aspect ratio; height follows. */
  width = 'md',
}: {
  className?: string
  tone?: Tone
  width?: 'sm' | 'md' | 'lg'
}) {
  const [attempt, setAttempt] = useState(0)
  const src = attempt < SOURCES.length ? SOURCES[attempt] : null

  const sizing = {
    // Sidebar and mobile header.
    sm: 'w-36',
    md: 'w-44',
    // Entry screens: capped as a share of the viewport so it never dominates
    // a small phone, and never crops.
    lg: 'w-[220px] max-w-[70%]',
  }[width]

  if (src) {
    return (
      <img
        src={src}
        alt="Perfect Vision Billing Software"
        onError={() => setAttempt((a) => a + 1)}
        // h-auto + object-contain: the complete artwork, never cropped or
        // stretched, on whatever background it sits on.
        className={cn('block h-auto object-contain', sizing, className)}
      />
    )
  }

  // Missing-asset state. Plain type only — deliberately not a drawn mark.
  return (
    <span
      className={cn(
        'block text-base font-semibold tracking-tight',
        tone === 'onDark' ? 'text-cream-50' : 'text-brand-900',
        className,
      )}
    >
      Perfect Vision Billing Software
    </span>
  )
}
