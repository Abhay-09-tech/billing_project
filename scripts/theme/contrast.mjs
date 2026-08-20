/**
 * Guards the palette against accessibility regressions.
 *
 * Colour choices drift: someone lightens a shade to "soften" a badge and
 * quietly drops it below readable contrast. This runs in CI so that change
 * fails the build instead of shipping to a shop counter.
 *
 * Thresholds are WCAG 2.1 AA — 4.5:1 for body text, 3:1 for large text and
 * non-text UI boundaries such as placeholders.
 */
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf8')

/**
 * Reads a token straight from the stylesheet, so this check and the app can
 * never disagree about what a colour actually is. Plain string parsing rather
 * than a constructed regex: nothing to mis-escape, and a wrong value produces
 * a clear message instead of a silent mismatch.
 */
function token(name) {
  const needle = `--color-${name}:`
  const line = css
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(needle))
  if (!line) throw new Error(`Token ${needle} not found in src/index.css`)

  const hex = line.slice(needle.length).split(';')[0].trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Token ${needle} is not a 6-digit hex colour: "${hex}"`)
  }
  return hex
}

const luminance = (hex) => {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
  const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = '#ffffff'

// Every pairing the interface actually renders. If a combination is not here,
// it is not guarded — add it rather than assuming it is fine.
const checks = [
  ['Body text on page', 'charcoal', 'cream-100', 4.5],
  ['Body text on card', 'charcoal', WHITE, 4.5],
  ['Heading on card', 'brand-900', WHITE, 4.5],
  ['Muted text on card', 'brand-700', WHITE, 4.5],
  ['Muted text on page', 'brand-700', 'cream-100', 4.5],
  ['Hint text on card', 'brand-600', WHITE, 4.5],
  ['Primary button label', WHITE, 'brand-700', 4.5],
  ['Secondary button label', 'brand-800', 'brand-50', 4.5],
  ['Table header text', 'brand-800', 'brand-50', 4.5],
  ['Sidebar active label', 'cream-50', 'brand-700', 4.5],
  ['Sidebar idle label', 'brand-100', 'brand-900', 4.5],
  ['Sidebar secondary line', 'brand-300', 'brand-900', 4.5],
  ['Input text', 'charcoal', 'cream-50', 4.5],
  ['Input placeholder', 'brand-500', 'cream-50', 3.0],
  ['Success badge', 'success-700', 'success-50', 4.5],
  ['Warning badge', 'warning-700', 'warning-50', 4.5],
  ['Error badge', 'error-700', 'error-50', 4.5],
  ['Error text on card', 'error-700', WHITE, 4.5],
]

/** Literal hex passes through; anything else is a token name to look up. */
const resolve = (value) => (value.startsWith('#') ? value : token(value))

let failures = 0
for (const [label, fg, bg, min] of checks) {
  const ratio = contrast(resolve(fg), resolve(bg))
  const pass = ratio >= min
  if (!pass) failures++
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)}:1  (need ${min.toFixed(1)})  ${label}`,
  )
}

console.log(
  failures === 0
    ? '\nAll contrast checks pass (WCAG AA)'
    : `\n${failures} contrast failure(s) — adjust the tokens in src/index.css`,
)
process.exit(failures === 0 ? 0 : 1)
