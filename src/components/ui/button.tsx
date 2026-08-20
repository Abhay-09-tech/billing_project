import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  // Hover deepens one step of the same ramp rather than shifting hue, so the
  // change reads as pressure rather than as a different button.
  primary:
    'bg-brand-700 text-white shadow-sm hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-brand-700 disabled:bg-brand-700/40 disabled:shadow-none',
  secondary:
    'bg-brand-50 text-brand-800 hover:bg-brand-100 active:bg-brand-200 focus-visible:outline-brand-700 disabled:opacity-50',
  outline:
    'border border-cream-300 bg-cream-50 text-brand-800 hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-brand-700 disabled:opacity-50',
  ghost:
    'text-brand-700 hover:bg-brand-50 hover:text-brand-900 focus-visible:outline-brand-700 disabled:opacity-50',
  danger:
    'bg-error-600 text-white shadow-sm hover:bg-error-700 focus-visible:outline-error-600 disabled:bg-error-600/40 disabled:shadow-none',
}

// Touch-friendly heights (≥44px for md/lg) per brief §30/§31.
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-11 w-11',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})
