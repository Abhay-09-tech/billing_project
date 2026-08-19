import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Glasses, LogOut, MoreHorizontal, X } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { NAV_ITEMS } from './nav'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'

/**
 * Responsive shell:
 *  · ≥lg — fixed left sidebar, content area with max width
 *  · <lg — top bar + bottom navigation (4 primary items + "More" sheet)
 */
export function AppShell() {
  const { user, can, signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  const items = useMemo(() => NAV_ITEMS.filter((i) => can(i.permission)), [can])
  const primary = items.filter((i) => i.primary).slice(0, 4)
  const secondary = items.filter((i) => !primary.includes(i))

  const linkClasses = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
      active ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
    )

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-gray-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Glasses className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-gray-900">Perfect Optical</p>
            <p className="text-xs text-gray-500">Vision</p>
          </div>
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
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">
              {user ? initials(user.profile.full_name) : '·'}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-gray-900">{user?.profile.full_name}</p>
              <p className="truncate text-xs text-gray-500">{user?.role.name}</p>
            </div>
            <button
              onClick={() => void signOut()}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 pt-safe lg:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Glasses className="h-4.5 w-4.5" />
          </span>
          <p className="text-sm font-semibold text-gray-900">Perfect Optical Vision</p>
        </div>
        <button
          onClick={() => void signOut()}
          className="rounded-lg p-2 text-gray-400 hover:text-gray-600"
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
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-gray-200 bg-white pb-safe lg:hidden"
        aria-label="Main"
      >
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-touch flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
                isActive ? 'text-brand-700' : 'text-gray-500',
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
            'flex min-h-touch flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
            secondary.some((i) => location.pathname.startsWith(i.to)) ? 'text-brand-700' : 'text-gray-500',
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
          <button className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} aria-label="Close" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-safe">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">All sections</p>
              <button
                onClick={() => setMoreOpen(false)}
                className="rounded-lg p-2 text-gray-400 hover:text-gray-600"
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
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium',
                      isActive
                        ? 'border-brand-200 bg-brand-50 text-brand-800'
                        : 'border-gray-200 text-gray-600',
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
