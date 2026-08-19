import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Table primitives. Always wrapped in an overflow container so wide tables
 * scroll inside their own box on mobile instead of breaking the page.
 */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-left text-sm', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-gray-200 bg-gray-50/60">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(props.onClick && 'cursor-pointer transition-colors hover:bg-brand-50/40', className)}
      {...props}
    />
  )
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('px-3 py-2.5 text-xs font-semibold tracking-wide text-gray-500 uppercase first:pl-4 last:pr-4', className)}
      {...props}
    />
  )
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-3 align-middle first:pl-4 last:pr-4', className)} {...props} />
}

/** Right-aligned numeric cell with tabular digits (money, quantities). */
export function TDNum({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <TD className={cn('text-right tabular-nums', className)} {...props} />
}

export function THNum({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <TH className={cn('text-right', className)} {...props} />
}
