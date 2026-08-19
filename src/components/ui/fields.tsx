import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500 aria-invalid:border-red-400 aria-invalid:focus:ring-red-500/20 ' +
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
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-gray-500">{hint}</p>
      ) : null}
    </div>
  )
}
