/**
 * Error translation (brief §37): staff never see raw database errors.
 * Postgres RPCs raise custom SQLSTATEs (POV01…POV07); everything else gets a
 * generic message and the technical detail goes to the console/monitoring.
 */

interface PgError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

const POV_MESSAGES: Record<string, string> = {
  POV01: 'A required setting is missing. Please ask the administrator to check Settings.',
  POV02: 'That action is not allowed from the current status.',
  POV03: 'This record is locked and cannot be changed.',
  POV04: 'Not enough stock for this product.',
  POV05: 'The payment is more than the outstanding balance.',
  POV06: 'You do not have permission for this action.',
  POV07: 'Please check the entered details and try again.',
}

const PG_FALLBACKS: Record<string, string> = {
  '23505': 'This record already exists.',
  '23503': 'This record is linked to other records and cannot be changed this way.',
  '23514': 'Some of the entered values are not valid.',
  '42501': 'You do not have permission for this action.',
  PGRST301: 'Your session has expired. Please sign in again.',
}

/**
 * Human message for any thrown error. The RAISE text from our own RPCs is
 * already user-appropriate, so POV codes prefer the server text.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  const e = err as PgError & Error

  if (e.code?.startsWith('POV')) {
    // Our RPCs raise staff-appropriate wording already; fall back to the
    // generic sentence only if the message looks like internal plumbing.
    const raised = e.message
    if (raised && !/[a-z_]+\(\)/.test(raised)) return raised
    return POV_MESSAGES[e.code] ?? fallback
  }
  const pgFallback = e.code ? PG_FALLBACKS[e.code] : undefined
  if (pgFallback) return pgFallback
  if (e.message === 'Failed to fetch' || e.message?.includes('NetworkError')) {
    return 'Cannot reach the server. Please check the internet connection.'
  }

  // Log the technical detail for diagnosis; never surface it.
  console.error('[pov] unhandled error:', e)
  return fallback
}
