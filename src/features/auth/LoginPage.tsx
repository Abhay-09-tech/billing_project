import { useState, type FormEvent } from 'react'
import { Glasses } from 'lucide-react'
import { signIn } from '@/services/auth'
import { friendlyError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { FormField, Input } from '@/components/ui/fields'

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
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white">
            <Glasses className="h-7 w-7" />
          </span>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">Perfect Optical Vision</h1>
            <p className="mt-0.5 text-sm text-gray-500">Sign in to continue</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" loading={loading} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Staff accounts are created by the administrator.
        </p>
      </div>
    </div>
  )
}
