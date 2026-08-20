import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, MoreHorizontal, X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { NAV_ITEMS } from './nav'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'
import { Logo } from '@/components/ui/logo'

/**
 * Responsive shell:
 *  · ≥lg — fixed dark-coffee sidebar, content area with max width
 *  · <lg — cream top bar + bottom navigation (4 primary items + "More" sheet)
 */
export function AppShell() {
  const { user, can, signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  const items = useMemo(() => NAV_ITEMS.filter((i) => can(i.permission)), [can])
  const primary = items.filter((i) => i.primary).slice(0, 4)
  const secondary = items.filter((i) => !primary.includes(i))

  // The active item carries BOTH a filled block and a left bar, so the current
  // page is identifiable without relying on colour perception alone.
  const linkClasses = (active: boolean) =>
    cn(
      'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
      active
        ? 'bg-brand-700 text-cream-50 before:absolute before:top-1/2 before:left-0 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-brand-300'
        : 'text-brand-100/75 hover:bg-brand-800 hover:text-cream-50',
    )

  return (
    <div className="min-h-dvh bg-cream-100">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-900 lg:flex">
        <div className="flex items-center justify-center border-b border-brand-800 bg-cream-50 px-4 py-4">
          <Logo width="sm" />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => linkClasses(isActive)}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-brand-800 p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-cream-50">
              {user ? initials(user.profile.full_name) : '·'}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-cream-50">{user?.profile.full_name}</p>
              <p className="truncate text-xs text-brand-300">{user?.role.name}</p>
            </div>
            <button
              onClick={() => void signOut()}
              className="rounded-lg p-2 text-brand-300 transition-colors hover:bg-brand-800 hover:text-cream-50"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <header className="pt-safe sticky top-0 z-30 flex items-center justify-between border-b border-cream-300 bg-cream-50 px-4 py-3 lg:hidden">
        <Logo width="sm" />
        <button
          onClick={() => void signOut()}
          className="rounded-lg p-2 text-brand-500 transition-colors hover:bg-brand-50 hover:text-brand-800"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="px-4 pt-4 pb-24 sm:px-6 lg:ml-60 lg:pb-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-cream-300 bg-cream-50 lg:hidden"
        aria-label="Main"
      >
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-touch flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand-700' : 'text-brand-500/70',
              )
            }
          >
            <item.icon className="h-5 w-5" aria-hidden />
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex min-h-touch flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
            secondary.some((i) => location.pathname.startsWith(i.to))
              ? 'text-brand-700'
              : 'text-brand-500/70',
          )}
          aria-label="More sections"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>

      {/* ── Mobile "More" sheet ─────────────────────────────────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="More sections">
          <button
            className="absolute inset-0 bg-brand-950/50"
            onClick={() => setMoreOpen(false)}
            aria-label="Close"
          />
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-2xl bg-cream-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-900">All sections</p>
              <button
                onClick={() => setMoreOpen(false)}
                className="rounded-lg p-2 text-brand-500 hover:bg-brand-50 hover:text-brand-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 pb-4">
              {secondary.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors',
                      isActive
                        ? 'border-brand-300 bg-brand-50 text-brand-800'
                        : 'border-cream-300 bg-white text-brand-700 hover:bg-brand-50',
                    )
                  }
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
