import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  Link2,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import { saveSupabaseConfig, validateConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { cn } from '@/lib/utils'

/**
 * Shown when the app has no database connection.
 *
 * Designed mobile-first (360–430px): this is almost always opened on a phone,
 * and the logo plus the first input need to fit the opening viewport without
 * scrolling. Deliberately not a blank page or a raw error — it explains what
 * is missing, where to find it, and verifies before accepting.
 *
 * The connection logic below is unchanged: same probe, same validation, same
 * treatment of an RLS refusal as success.
 *
 * This is the one place outside src/services that talks to supabase-js, and
 * only to verify credentials that are not configured yet.
 */
export function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [connected, setConnected] = useState(false)

  // Inline hints appear only once a field has content, so the form does not
  // scold someone who has simply not typed yet.
  const urlTouched = url.trim().length > 0
  const keyTouched = anonKey.trim().length > 0
  const urlProblem = urlTouched ? validateConfig(url, 'x'.repeat(40)).error : undefined
  const keyProblem = keyTouched ? validateConfig('https://x.supabase.co', anonKey).error : undefined

  async function handleConnect() {
    setError(null)

    const validation = validateConfig(url, anonKey)
    if (!validation.valid) {
      setError(validation.error ?? 'Please check the details.')
      return
    }

    setTesting(true)
    try {
      // Prove the credentials work before saving them. A harmless query
      // against a table every signed-out visitor is allowed to reach.
      const probe = createClient(url.trim(), anonKey.trim())
      const { error: probeError } = await probe.from('branches').select('id').limit(1)

      // RLS refusing to return rows is a SUCCESS: it means we reached the
      // database and its security is working. Only transport/auth failures
      // mean the details are wrong.
      if (probeError && isConnectionFailure(probeError)) {
        setError(describeProbeError(probeError))
        return
      }

      saveSupabaseConfig(url, anonKey)
      // Let the success state land before swapping the screen out.
      setConnected(true)
      setTimeout(onConnected, 700)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Could not reach that address. Check the Project URL and your internet connection.'
          : 'Could not connect. Please check both values and try again.',
      )
    } finally {
      setTesting(false)
    }
  }

  const canSubmit = urlTouched && keyTouched && !urlProblem && !keyProblem && !testing && !connected

  return (
    <div className="min-h-dvh bg-cream-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6 sm:max-w-lg sm:py-10">
        {/* ── Brand ─────────────────────────────────────────────────────── */}
        <header className="mb-5 sm:mb-7">
          <Logo size="xl" stacked showTagline />
          <p className="mt-4 text-center text-sm text-brand-700 sm:text-base">
            Connect to your database to begin
          </p>
        </header>

        {/* ── Connection card ───────────────────────────────────────────── */}
        <div className="rounded-2xl border border-cream-300 bg-white p-4 shadow-lg shadow-brand-900/[0.06] sm:p-6">
          <p className="text-sm leading-relaxed text-brand-800">
            This app stores your customers, prescriptions and bills in your own Supabase database.
            Paste its two connection details below — you only do this once per device.
          </p>

          {/* Numbered steps */}
          <ol className="mt-4 space-y-2.5 rounded-xl bg-cream-100 p-3.5">
            {[
              <>Open your project at supabase.com</>,
              <>
                Go to <strong className="font-semibold">Project Settings → API</strong>
              </>,
              <>
                Copy the <strong className="font-semibold">Project URL</strong> and the{' '}
                <strong className="font-semibold">anon public</strong> key
              </>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-sm leading-snug text-brand-800">{step}</span>
              </li>
            ))}
          </ol>

          {/* ── Inputs ──────────────────────────────────────────────────── */}
          <div className="mt-5 space-y-4">
            <Field
              id="cfg-url"
              label="Project URL"
              icon={<Link2 className="h-4 w-4" />}
              error={urlProblem}
            >
              <input
                id="cfg-url"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://abcdefghijk.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={inputClasses(Boolean(urlProblem), false)}
              />
            </Field>

            <Field
              id="cfg-key"
              label="Anon public key"
              icon={<Lock className="h-4 w-4" />}
              error={keyProblem}
              hint={
                <>
                  The long key labelled <strong className="font-semibold">anon public</strong>.
                  Never the <strong className="font-semibold">service_role</strong> key.
                </>
              }
            >
              <input
                id="cfg-key"
                type={showKey ? 'text' : 'password'}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                className={inputClasses(Boolean(keyProblem), true)}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-brand-500 transition-colors hover:text-brand-800"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>

            {error && (
              <p
                className="flex items-start gap-2 rounded-xl bg-error-50 px-3 py-2.5 text-sm text-error-700"
                role="alert"
              >
                <span aria-hidden>⚠</span>
                <span>{error}</span>
              </p>
            )}

            {connected && (
              <p
                className="flex items-center gap-2 rounded-xl bg-success-50 px-3 py-2.5 text-sm font-medium text-success-700"
                role="status"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Connected. Opening your dashboard…
              </p>
            )}

            <Button
              size="lg"
              className="min-h-touch w-full active:scale-[0.99]"
              disabled={!canSubmit}
              onClick={() => void handleConnect()}
            >
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Testing connection…
                </>
              ) : connected ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Connect
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── Security note ─────────────────────────────────────────────── */}
        <div className="mt-4 rounded-2xl border border-cream-300 bg-cream-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-700" />
            Is this safe?
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-brand-700">
            Yes. The anon key is designed to be public — every table is protected by row-level
            security, so this key alone can read nothing. You still have to sign in. Never paste the{' '}
            <strong className="font-semibold">service_role</strong> key here; this screen refuses it
            if you try.
          </p>
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="mt-auto pt-6 text-center">
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-touch items-center gap-1.5 px-3 text-sm font-medium text-brand-700 transition-colors hover:text-brand-900"
          >
            <ExternalLink className="h-4 w-4" />
            Open the Supabase dashboard
          </a>
        </div>
      </div>
    </div>
  )
}

/** Input chrome shared by both fields; kept here so the two cannot drift. */
function inputClasses(hasError: boolean, hasTrailingIcon: boolean) {
  return cn(
    'min-h-touch w-full rounded-xl border bg-white py-3 pl-10 text-charcoal transition-colors',
    'placeholder:text-brand-400/70 focus:outline-none focus:ring-2',
    // 16px on mobile stops iOS zooming the page on focus.
    'text-base sm:text-sm',
    hasTrailingIcon ? 'pr-11' : 'pr-3',
    hasError
      ? 'border-error-600 focus:border-error-600 focus:ring-error-600/20'
      : 'border-cream-300 focus:border-brand-600 focus:ring-brand-600/20',
  )
}

function Field({
  id,
  label,
  icon,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  icon: React.ReactNode
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-brand-800">
        {label} <span className="text-error-600">*</span>
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-brand-500">
          {icon}
        </span>
        {children}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-error-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-brand-600">{hint}</p>
      ) : null}
    </div>
  )
}

interface ProbeError {
  message?: string
  code?: string
  status?: number
}

/** Distinguishes "cannot reach / not authorised" from "reached it, RLS said no". */
function isConnectionFailure(error: ProbeError): boolean {
  if (error.message === 'Failed to fetch' || error.message?.includes('NetworkError')) return true
  if (error.message?.includes('Invalid API key')) return true
  if (error.message?.includes('JWT')) return true
  // 42P01 = table missing, which means we DID connect but migrations are pending.
  return false
}

function describeProbeError(error: ProbeError): string {
  if (error.message === 'Failed to fetch' || error.message?.includes('NetworkError')) {
    return 'Could not reach that address. Check the Project URL and your internet connection.'
  }
  if (error.message?.includes('Invalid API key')) {
    return 'That key was not accepted. Copy the whole “anon public” key from Project Settings → API.'
  }
  return 'Could not connect. Please check both values and try again.'
}
