import { describe, expect, it } from 'vitest'
import { isSecretKey, validateConfig } from './config'

// Synthetic keys with the same SHAPE as real ones. No real credential is ever
// committed to this repository.
const PUBLISHABLE_NEW = 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAA_bbbbbbbb'
const SECRET_NEW = 'sb_secret_AAAAAAAAAAAAAAAAAAAAAA_bbbbbbbb'

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=/g, '')}.c2lnbmF0dXJlc2lnbmF0dXJl`

const ANON_LEGACY = jwt({ iss: 'supabase', role: 'anon', exp: 2000000000 })
const SERVICE_LEGACY = jwt({ iss: 'supabase', role: 'service_role', exp: 2000000000 })

const URL_OK = 'https://exampleprojectref.supabase.co'

describe('isSecretKey — both Supabase key generations', () => {
  it('flags a current-format secret key', () => {
    expect(isSecretKey(SECRET_NEW)).toBe(true)
  })

  it('flags a legacy service_role JWT', () => {
    expect(isSecretKey(SERVICE_LEGACY)).toBe(true)
  })

  it('allows a current-format publishable key', () => {
    expect(isSecretKey(PUBLISHABLE_NEW)).toBe(false)
  })

  it('allows a legacy anon JWT', () => {
    expect(isSecretKey(ANON_LEGACY)).toBe(false)
  })

  it('is not fooled by surrounding whitespace from a sloppy paste', () => {
    expect(isSecretKey(`  ${SECRET_NEW}  `)).toBe(true)
  })

  it('does not crash on malformed input', () => {
    for (const junk of ['', 'not-a-key', 'a.b.c', 'eyJ.!!!.x']) {
      expect(() => isSecretKey(junk)).not.toThrow()
    }
  })
})

describe('validateConfig', () => {
  it('accepts a publishable key with an https project URL', () => {
    expect(validateConfig(URL_OK, PUBLISHABLE_NEW)).toEqual({ valid: true })
  })

  it('accepts a legacy anon key', () => {
    expect(validateConfig(URL_OK, ANON_LEGACY).valid).toBe(true)
  })

  it('REFUSES a current-format secret key', () => {
    const result = validateConfig(URL_OK, SECRET_NEW)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/secret key/i)
    expect(result.error).toMatch(/never be used in a browser/i)
  })

  it('REFUSES a legacy service_role key', () => {
    expect(validateConfig(URL_OK, SERVICE_LEGACY).valid).toBe(false)
  })

  it('rejects a non-https URL', () => {
    expect(validateConfig('http://example.supabase.co', PUBLISHABLE_NEW).valid).toBe(false)
  })

  it('rejects nonsense as a URL', () => {
    expect(validateConfig('just some text', PUBLISHABLE_NEW).valid).toBe(false)
  })

  it('rejects a truncated key', () => {
    expect(validateConfig(URL_OK, 'sb_publishable_short').valid).toBe(false)
  })

  it('never leaks a technical error to staff', () => {
    for (const [u, k] of [['', ''], ['x', 'y'], [URL_OK, SECRET_NEW]] as const) {
      const err = validateConfig(u, k).error
      if (err) expect(err).not.toMatch(/undefined|null|TypeError|at Object/)
    }
  })
})
