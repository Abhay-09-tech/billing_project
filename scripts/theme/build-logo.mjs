/**
 * Builds the complete Perfect Vision logo lock-up as ONE image.
 *
 * Mark, wordmark, descriptor and tagline are baked into a single PNG, so the
 * application renders one <img> and never recomposes the logo from separate
 * icons and text.
 *
 * Rendered through Chromium rather than hand-authored as SVG text: the type
 * is rasterised at build time, so the logo looks identical everywhere and
 * does not depend on a font being installed on the viewer's device.
 *
 * Transparent background, so it sits directly on the cream page with no
 * container behind it.
 *
 * Run: npm run logo:build
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'public/perfect-vision-billing-logo.png')

const W = 1000
const H = 880
const SCALE = 2

const DARK = '#3B2418'
const COFFEE = '#6F4E37'
const MEDIUM = '#8B6F47'
const LIGHT = '#C8A27A'
const CREAM = '#F7F1E8'

/** Gear teeth, computed rather than hand-placed so they sit evenly. */
function gearTeeth(cx, cy, radius, count, w, h) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (360 / count) * i
    return `<rect x="${cx - w / 2}" y="${cy - radius - h}" width="${w}" height="${h}" rx="${w / 3}"
                  transform="rotate(${angle} ${cx} ${cy})" />`
  }).join('\n      ')
}

/** Receipt torn edge — an even zigzag across the full width. */
function tornEdge(width, depth, teeth) {
  const step = width / teeth
  let d = `M0 0`
  for (let i = 0; i < teeth; i++) {
    d += ` L${(i + 0.5) * step} ${depth} L${(i + 1) * step} 0`
  }
  return d + ' Z'
}

/**
 * The mark. Drawn on transparent — no rounded card behind it, so nothing
 * reads as a container the app has added. Elements are laid out so they
 * touch but never obscure one another.
 */
const mark = `
<svg viewBox="0 0 560 430" width="560" height="430" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">

  <!-- Cloud (software) — sits above, clear of the eye -->
  <g fill="${LIGHT}">
    <circle cx="238" cy="52" r="26" />
    <circle cx="280" cy="38" r="34" />
    <circle cx="322" cy="52" r="24" />
    <rect x="238" y="48" width="84" height="30" rx="15" />
  </g>

  <!-- Eye (vision) — the dominant element, centred -->
  <g stroke="${COFFEE}" stroke-width="20" stroke-linejoin="round" stroke-linecap="round">
    <path d="M140 196s58-76 140-76 140 76 140 76-58 76-140 76-140-76-140-76Z" />
    <circle cx="280" cy="196" r="46" />
  </g>
  <circle cx="280" cy="196" r="19" fill="${DARK}" />

  <!-- Eyeglasses (optical) — bottom left, well clear of the eye -->
  <g stroke="${MEDIUM}" stroke-width="11" stroke-linecap="round">
    <circle cx="66" cy="366" r="34" />
    <circle cx="156" cy="366" r="34" />
    <path d="M100 360c8-9 14-9 22 0" />
    <path d="M32 366c-6-14-4-25 3-32" />
    <path d="M190 366c6-14 4-25-3-32" />
  </g>

  <!-- Gear with checkmark (automation, billed successfully) — bottom centre -->
  <g fill="${LIGHT}">
    ${gearTeeth(280, 360, 46, 8, 22, 20)}
    <circle cx="280" cy="360" r="52" />
  </g>
  <path d="M258 360l16 17 30-34" stroke="${DARK}" stroke-width="14"
        fill="none" stroke-linecap="round" stroke-linejoin="round" />

  <!-- Invoice with rupee (billing + payments) — bottom right -->
  <g transform="translate(390 292)">
    <rect width="150" height="122" rx="12" fill="${COFFEE}" />
    <g transform="translate(0 122)" fill="${COFFEE}">
      <path d="${tornEdge(150, 15, 6)}" />
    </g>
    <!-- Rupee, sized to sit inside with margin: two bars, stem, bowl, leg -->
    <g stroke="${CREAM}" stroke-width="11" stroke-linecap="round" fill="none">
      <path d="M46 30h58" />
      <path d="M46 51h58" />
      <path d="M64 30v66" />
      <path d="M66 51c26 0 30 26 3 26" />
      <path d="M71 77l33 30" />
    </g>
  </g>
</svg>`

const html = `
<html>
  <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${W}px; height: ${H}px;
        background: transparent;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        /* Type is rasterised at build time, so this stack only affects the
           machine producing the asset, never the viewer. */
        font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .wordmark {
        font-size: 106px; font-weight: 600; letter-spacing: -0.02em;
        color: ${DARK}; line-height: 1; margin-top: 34px;
      }
      .descriptor {
        font-size: 41px; font-weight: 600; letter-spacing: 0.22em;
        color: ${COFFEE}; margin-top: 20px; text-transform: uppercase;
      }
      .rule {
        width: 320px; height: 3px; background: ${LIGHT};
        margin: 28px 0 24px; border-radius: 2px;
      }
      .tagline {
        font-size: 28px; font-weight: 600; letter-spacing: 0.16em;
        color: ${MEDIUM}; text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    ${mark}
    <div class="wordmark">Perfect vision</div>
    <div class="descriptor">Billing Software</div>
    <div class="rule"></div>
    <div class="tagline">Smart billing. Clear vision.</div>
  </body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: SCALE,
})
await page.setContent(html, { waitUntil: 'load' })
await page.waitForTimeout(200)

const buf = await page.screenshot({ omitBackground: true })
writeFileSync(OUT, buf)
await browser.close()

console.log(
  `wrote public/perfect-vision-billing-logo.png ` +
    `(${W * SCALE}x${H * SCALE}, ${(buf.length / 1024).toFixed(1)} KB, transparent)`,
)
