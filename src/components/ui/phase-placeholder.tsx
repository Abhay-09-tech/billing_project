import { Construction } from 'lucide-react'
import { Card, PageHeader } from './layout'

/**
 * Honest marker for a module whose backend exists (schema + RPCs + service
 * layer are done and tested) but whose screens are scheduled for a later
 * phase. Deliberately NOT a fake dashboard: showing invented numbers would
 * be worse than showing nothing.
 */
export function PhasePlaceholder({
  title,
  phase,
  ready,
  next,
}: {
  title: string
  phase: string
  ready: string[]
  next: string[]
}) {
  return (
    <>
      <PageHeader title={title} subtitle={`Scheduled for ${phase}`} />
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Construction className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" aria-hidden />
          <div className="space-y-4">
            <p className="text-sm text-brand-800">
              This screen is not built yet. Its database tables, business rules and data-access
              functions are complete and covered by tests — only the user interface remains.
            </p>
            <div>
              <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
                Already working underneath
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-brand-700">
                {ready.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-success-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
                This screen will provide
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-brand-700">
                {next.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-brand-500">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}
