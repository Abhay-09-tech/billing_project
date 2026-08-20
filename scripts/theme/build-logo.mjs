/**
 * Builds the complete Perfect Vision logo lock-up as ONE image.
 *
 * Everything — emblem, wordmark, descriptor, tagline — is baked into a single
 * transparent PNG. The application renders one <img> and composes nothing, so
 * no icon component or text node can drift away from the brand.
 *
 * Built from the written description of the reference (the image itself has
 * never reached us). Overwrite public/perfect-vision-billing-logo.png with the
 * real artwork whenever it is available; no code change is needed.
 *
 * Rendered through Chromium rather than hand-authored SVG text so the type is
 * rasterised at build time and looks identical on every device.
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

const W = 1040
const H = 940
const SCALE = 2

const DARK = '#3B2418'
const CHARCOAL = '#2B211B'
const COFFEE = '#6F4E37'
const MEDIUM = '#8B6F47'
const LIGHT = '#C8A27A'
const WHITE = '#FFFFFF'

/** Receipt torn edge — even zigzag across the full width. */
function tornEdge(width, depth, teeth) {
  const step = width / teeth
  let d = 'M0 0'
  for (let i = 0; i < teeth; i++) {
    d += ` L${(i + 0.5) * step} ${depth} L${(i + 1) * step} 0`
  }
  return `${d} Z`
}

/** Gear teeth, computed so they sit evenly rather than hand-placed. */
function gearTeeth(cx, cy, radius, count, w, h) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (360 / count) * i
    return `<rect x="${cx - w / 2}" y="${cy - radius - h}" width="${w}" height="${h}" rx="${w / 3}"
                  transform="rotate(${angle} ${cx} ${cy})" />`
  }).join('\n    ')
}

/** Barcode: irregular bar widths, so it reads as a barcode and not a comb. */
function barcode(x, y, height) {
  const widths = [4, 2, 6, 2, 3, 7, 2, 4, 2, 6, 3, 2, 5, 2, 4]
  let cursor = x
  return widths
    .map((w) => {
      const bar = `<rect x="${cursor}" y="${y}" width="${w}" height="${height}" rx="1" />`
      cursor += w + 4
      return bar
    })
    .join('\n      ')
}

/**
 * The emblem: overlapping elements forming one illustration rather than a row
 * of separate icons — cloud behind, invoice in front of it, eye inside the
 * invoice, gear breaking the top-right edge, glasses across the front.
 */
const emblem = `
<svg viewBox="0 0 620 470" width="620" height="470" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">

  <!-- Cloud (software) — dark coffee, sitting behind the invoice -->
  <g fill="${DARK}">
    <circle cx="212" cy="96" r="52" />
    <circle cx="292" cy="66" r="68" />
    <circle cx="378" cy="94" r="50" />
    <rect x="212" y="88" width="166" height="62" rx="31" />
  </g>

  <!-- Invoice / receipt — white, overlapping the cloud -->
  <g transform="translate(196 128)">
    <rect width="228" height="284" rx="18" fill="${WHITE}" stroke="${LIGHT}" stroke-width="4" />
    <g transform="translate(0 282)" fill="${WHITE}">
      <path d="${tornEdge(228, 22, 7)}" stroke="${LIGHT}" stroke-width="4" stroke-linejoin="round" />
    </g>

    <!-- Eye (optical) — inside the invoice, the focal point -->
    <g stroke="${COFFEE}" stroke-width="13" stroke-linejoin="round" stroke-linecap="round">
      <path d="M40 74s31-42 74-42 74 42 74 42-31 42-74 42-74-42-74-42Z" />
      <circle cx="114" cy="74" r="25" />
    </g>
    <circle cx="114" cy="74" r="11" fill="${DARK}" />

    <!-- Rupee (payment) -->
    <g stroke="${COFFEE}" stroke-width="10" stroke-linecap="round" fill="none">
      <path d="M64 150h44" />
      <path d="M64 168h44" />
      <path d="M78 150v52" />
      <path d="M80 168c20 0 23 20 2 20" />
      <path d="M84 188l26 24" />
    </g>
    <!-- Amount rules beside the rupee -->
    <g fill="${LIGHT}">
      <rect x="126" y="150" width="62" height="9" rx="4.5" />
      <rect x="126" y="170" width="46" height="9" rx="4.5" />
      <rect x="126" y="190" width="54" height="9" rx="4.5" />
    </g>

    <!-- Barcode (billing detail) -->
    <g fill="${MEDIUM}">
      ${barcode(52, 226, 34)}
    </g>
  </g>

  <!-- Gear with checkmark (automation) — breaking the invoice's top-right -->
  <g fill="${COFFEE}">
    ${gearTeeth(452, 176, 50, 8, 24, 22)}
    <circle cx="452" cy="176" r="56" />
  </g>
  <path d="M428 176l17 18 32-36" stroke="${WHITE}" stroke-width="15"
        fill="none" stroke-linecap="round" stroke-linejoin="round" />

  <!-- Eyeglasses — dark, in front of everything -->
  <g stroke="${CHARCOAL}" stroke-width="15" stroke-linecap="round">
    <circle cx="212" cy="392" r="54" fill="${WHITE}" fill-opacity="0.92" />
    <circle cx="392" cy="392" r="54" fill="${WHITE}" fill-opacity="0.92" />
    <path d="M266 384c14-13 46-13 60 0" />
    <path d="M158 388c-13-16-9-30 2-40" />
    <path d="M446 388c13-16 9-30-2-40" />
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
        font-size: 108px; font-weight: 600; letter-spacing: -0.02em;
        line-height: 1; margin-top: 28px;
      }
      /* Two tone, exactly as described: "Perfect" coffee, "vision" charcoal. */
      .wordmark .a { color: ${COFFEE}; }
      .wordmark .b { color: ${CHARCOAL}; }

      .descriptor-row {
        display: flex; align-items: center; gap: 22px; margin-top: 22px;
      }
      .descriptor-row .line {
        width: 92px; height: 2px; background: ${LIGHT}; border-radius: 2px;
      }
      .descriptor {
        font-size: 40px; font-weight: 600; letter-spacing: 0.24em;
        color: ${COFFEE}; text-transform: uppercase;
      }
      .tagline {
        font-size: 26px; font-weight: 600; letter-spacing: 0.18em;
        color: ${MEDIUM}; text-transform: uppercase; margin-top: 22px;
      }
    </style>
  </head>
  <body>
    ${emblem}
    <div class="wordmark"><span class="a">Perfect</span> <span class="b">vision</span></div>
    <div class="descriptor-row">
      <span class="line"></span>
      <span class="descriptor">Billing Software</span>
      <span class="line"></span>
    </div>
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
