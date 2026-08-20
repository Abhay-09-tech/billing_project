import { useState, type FormEvent } from 'react'
import { signIn } from '@/services/auth'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { FormField, Input } from '@/components/ui/fields'
import { Logo } from '@/components/ui/logo'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      // AuthProvider's onAuthStateChange picks the session up from here.
    } catch (err) {
      const e = err as { message?: string }
      setError(
        e.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : friendlyError(err),
      )
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo width="md" />
          <p className="mt-1 text-sm text-brand-600">Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-cream-300 bg-white p-5 shadow-sm shadow-brand-900/[0.04] sm:p-6"
        >
          <FormField label="Email" required htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </FormField>
          <FormField label="Password" required htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </FormField>

          {error && (
            <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-brand-500">
          Staff accounts are created by the administrator.
        </p>
      </div>
    </div>
  )
}
