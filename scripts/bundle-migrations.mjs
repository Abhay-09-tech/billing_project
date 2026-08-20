/**
 * Concatenates every migration into one file that can be pasted into the
 * Supabase SQL Editor in a single go.
 *
 * This is a convenience for FIRST-TIME setup only. The migrations folder stays
 * the source of truth; later changes go through `npm run db:push` so the
 * schema history is never rewritten by hand.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = 'supabase/migrations'
const OUT = 'supabase/setup/full-schema.sql'

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort() // timestamp prefixes make lexical order the correct apply order

const parts = [
  '-- ===========================================================================',
  '-- Perfect Optical Vision — complete database schema',
  '--',
  '-- GENERATED FILE — do not edit. Regenerate with: npm run db:bundle',
  `-- Built from ${files.length} migrations in supabase/migrations/`,
  '--',
  '-- FIRST-TIME SETUP, ON A FRESH PROJECT:',
  '--   Supabase Dashboard → SQL Editor → New query → paste all of this → Run',
  '--',
  '-- Run this ONCE. Migrations are not written to be re-applied, so the guard',
  '-- below stops a second run with a clear message instead of a confusing',
  '-- "relation already exists" error. Everything is inside one transaction, so',
  '-- a refused or failed run leaves the database completely untouched.',
  '--',
  '-- For changes AFTER setup, use `npm run db:push` — never re-paste this file.',
  '-- ===========================================================================',
  '',
  'begin;',
  '',
  '-- Refuse to run twice, rather than half-applying over an existing schema.',
  'do $guard$',
  'begin',
  '  if exists (',
  "    select 1 from information_schema.tables",
  "     where table_schema = 'public' and table_name = 'branches'",
  '  ) then',
  '    raise exception',
  "      'Perfect Optical Vision is already installed in this project. Nothing was changed. To apply later updates run: npm run db:push';",
  '  end if;',
  'end',
  '$guard$;',
  '',
]

for (const file of files) {
  parts.push(
    '-- ---------------------------------------------------------------------------',
    `-- ${file}`,
    '-- ---------------------------------------------------------------------------',
    '',
    readFileSync(join(MIGRATIONS, file), 'utf8').trimEnd(),
    '',
  )
}

parts.push('commit;', '')

mkdirSync('supabase/setup', { recursive: true })
writeFileSync(OUT, parts.join('\n'), 'utf8')

const lines = parts.join('\n').split('\n').length
console.log(`Bundled ${files.length} migrations → ${OUT} (${lines} lines)`)
