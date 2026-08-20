/**
 * Renders the logo files to PNG so they can actually be looked at.
 *
 * Vector artwork can be structurally valid and still look wrong — a stray
 * path, one shape covering another, detail that turns to mud at icon size.
 * This makes the result visible instead of assumed.
 *
 * The SVG markup is inlined rather than referenced: Chromium refuses to load
 * file:// subresources into a page built with setContent.
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'preview')
mkdirSync(OUT, { recursive: true })

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const box = (svg, px) => `<div style="width:${px}px;height:${px}px">${svg}</div>`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2 })

const targets = [
  { file: 'public/logo.svg', sizes: [256, 64, 32] },
  { file: 'public/favicon.svg', sizes: [128, 32, 16] },
]

for (const { file, sizes } of targets) {
  const svg = read(file)
  for (const size of sizes) {
    const pad = 20
    await page.setViewportSize({ width: size + pad * 2, height: size + pad * 2 })
    await page.setContent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;
                    width:${size + pad * 2}px;height:${size + pad * 2}px;background:#F7F1E8">
         ${box(svg, size)}
       </body>`,
    )
    const name = `${path.basename(file, '.svg')}-${size}.png`
    await page.screenshot({ path: path.join(OUT, name) })
    console.log('rendered', name)
  }
}

// Contact sheet at the sizes the app really uses, on both backgrounds the
// logo has to survive: the cream page and the dark-coffee sidebar.
const logo = read('public/logo.svg')
await page.setViewportSize({ width: 620, height: 160 })
await page.setContent(`
  <body style="margin:0;display:flex">
    <div style="flex:1;background:#F7F1E8;display:flex;align-items:center;gap:20px;padding:24px">
      ${box(logo, 80)}${box(logo, 40)}${box(logo, 24)}
    </div>
    <div style="flex:1;background:#3B2418;display:flex;align-items:center;gap:20px;padding:24px">
      ${box(logo, 80)}${box(logo, 40)}${box(logo, 24)}
    </div>
  </body>
`)
await page.screenshot({ path: path.join(OUT, 'logo-sheet.png') })
console.log('rendered logo-sheet.png')

await browser.close()
