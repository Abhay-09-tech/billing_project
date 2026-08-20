/**
 * Generates public/logo.png from public/logo.svg.
 *
 * A raster copy is kept for contexts that cannot take SVG — some email
 * clients, older Android home screens, third-party embeds. It is generated
 * rather than hand-made so it can never drift from the vector original.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SIZE = 512

const svg = readFileSync(path.join(ROOT, 'public/logo.svg'), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
})
// Transparent ground: the artwork supplies its own rounded card.
await page.setContent(
  `<body style="margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent">
     <div style="width:${SIZE}px;height:${SIZE}px">${svg}</div>
   </body>`,
)
const buf = await page.screenshot({ omitBackground: true })
writeFileSync(path.join(ROOT, 'public/logo.png'), buf)
await browser.close()

console.log(`wrote public/logo.png (${SIZE}x${SIZE}, ${(buf.length / 1024).toFixed(1)} KB)`)
