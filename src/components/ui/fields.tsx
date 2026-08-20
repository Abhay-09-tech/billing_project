import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'block w-full rounded-lg border border-cream-300 bg-cream-50 px-3 text-charcoal transition-colors ' +
  'placeholder:text-brand-400/70 focus:border-brand-600 focus:bg-white focus:ring-2 focus:ring-brand-600/20 focus:outline-none ' +
  'disabled:bg-cream-200/50 disabled:text-brand-500 aria-invalid:border-error-600 aria-invalid:focus:ring-error-600/20 ' +
  'text-base sm:text-sm' // 16px on mobile prevents iOS zoom

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, 'h-11', className)} {...props} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(fieldBase, 'py-2', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, 'h-11 pr-8', className)} {...props}>
        {children}
      </select>
    )
  },
)

interface FormFieldProps {
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: ReactNode
  htmlFor?: string
  className?: string
}

/** Label + control + error/hint in the standard vertical rhythm. */
export function FormField({ label, required, error, hint, children, htmlFor, className }: FormFieldProps) {
  const autoId = useId()
  const id = htmlFor ?? autoId
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-brand-800">
        {label}
        {required && <span className="ml-0.5 text-error-600">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-sm font-medium text-error-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-brand-600">{hint}</p>
      ) : null}
    </div>
  )
}
