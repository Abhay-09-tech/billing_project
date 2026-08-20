import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { saveSupabaseConfig, validateConfig } from '@/lib/config'
import { Button } from '@/components/ui/button'
import { FormField, Input } from '@/components/ui/fields'
import { Logo } from '@/components/ui/logo'

/**
 * Shown when the app has no database connection.
 *
 * Deliberately not a blank page or a raw error: this screen explains what is
 * missing, where to find it, and tests the connection before accepting it —
 * so a wrong paste is caught here rather than surfacing as broken screens.
 *
 * This is the one place outside src/services that talks to supabase-js, and
 * only to verify credentials that are not yet configured.
 */
export function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

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
      onConnected()
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

  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream-100 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Logo size="lg" showTagline />
          <p className="mt-1 text-sm text-brand-600">Connect to your database to begin</p>
        </div>

        <div className="rounded-xl border border-cream-300 bg-white p-5 shadow-sm shadow-brand-900/[0.04] sm:p-6">
          <p className="text-sm text-brand-700">
            This app stores your customers, prescriptions and bills in your own Supabase database.
            Paste its two connection details below — you only do this once per device.
          </p>

          <ol className="mt-4 space-y-1.5 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
            <li>1. Open your project at supabase.com</li>
            <li>
              2. Go to <strong>Project Settings → API</strong>
            </li>
            <li>
              3. Copy the <strong>Project URL</strong> and the <strong>anon public</strong> key
            </li>
          </ol>

          <div className="mt-5 space-y-4">
            <FormField label="Project URL" required htmlFor="cfg-url">
              <Input
                id="cfg-url"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://abcdefghijk.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </FormField>

            <FormField
              label="Anon public key"
              required
              hint="The long key labelled “anon public”. Never the service_role key."
              htmlFor="cfg-key"
            >
              <Input
                id="cfg-key"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
              />
            </FormField>

            {error && (
              <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
                {error}
              </p>
            )}

            <Button size="lg" className="w-full" loading={testing} onClick={() => void handleConnect()}>
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Testing connection…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Connect
                </>
              )}
            </Button>
          </div>

          <div className="mt-5 border-t border-cream-200 pt-4">
            <p className="text-xs text-brand-600">
              <strong>Is this safe?</strong> Yes. The anon key is designed to be public — every
              table is protected by row-level security, so this key alone can read nothing. You
              still have to sign in. Never paste the <em>service_role</em> key here; this screen
              refuses it if you try.
            </p>
          </div>
        </div>

        <div className="mt-4 text-center">
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            <ExternalLink className="h-4 w-4" />
            Open the Supabase dashboard
          </a>
          <p className="mt-3 text-xs text-brand-500">
            No project yet? Follow docs/GETTING-STARTED.md — it takes about 30 minutes and is free
            to start.
          </p>
        </div>
      </div>
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
