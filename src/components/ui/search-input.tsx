import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onValueChange: (value: string) => void
  /** ms of quiet before onValueChange fires (brief §36: debounced search). */
  debounce?: number
}

export function SearchInput({
  value,
  onValueChange,
  debounce = 300,
  className,
  placeholder = 'Search…',
  ...props
}: SearchInputProps) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep local text in sync when the parent resets the query.
  useEffect(() => setLocal(value), [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  const update = (next: string) => {
    setLocal(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onValueChange(next), debounce)
  }

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-500" />
      <input
        type="search"
        enterKeyHint="search"
        value={local}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-cream-300 bg-white pr-9 pl-9 text-base text-brand-900 placeholder:text-brand-500 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 focus:outline-none sm:text-sm"
        {...props}
      />
      {local && (
        <button
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-brand-500 hover:text-brand-700"
          onClick={() => update('')}
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
