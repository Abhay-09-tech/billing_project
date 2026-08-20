/**
 * Screenshots the Connect screen at real phone widths.
 *
 * The brief says this page is used mostly on phones and the form should be
 * reachable without excessive scrolling. That is a claim about pixels, so it
 * gets checked in pixels rather than asserted.
 *
 * Requires the dev server on :5173.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'preview')
mkdirSync(OUT, { recursive: true })

const URL = process.env.POV_URL ?? 'http://localhost:5173/'

const viewports = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'desktop', width: 1280, height: 900 },
]

const browser = await chromium.launch()

for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  })
  // Force the Connect screen: clear any saved configuration first.
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('pov.supabase.config'))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  // First viewport only — what the user sees before scrolling.
  await page.screenshot({ path: path.join(OUT, `connect-${vp.name}-fold.png`) })
  await page.screenshot({ path: path.join(OUT, `connect-${vp.name}-full.png`), fullPage: true })

  // Does the page scroll sideways? It never should.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  // Is the first input visible without scrolling?
  const urlInputVisible = await page.evaluate(() => {
    const el = document.getElementById('cfg-url')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  })

  console.log(
    `${vp.name.padEnd(10)} horizontal overflow: ${overflow}px` +
      `   Project URL field in first screen: ${urlInputVisible}`,
  )
  await page.close()
}

await browser.close()
