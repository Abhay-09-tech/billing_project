/**
 * Diagnoses the Connect button: is it present, visible, enabled, and does it
 * sit inside the viewport once both fields are filled?
 *
 * Reproduces what the owner reported rather than reasoning about the code.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'preview')
mkdirSync(OUT, { recursive: true })

const URL = process.env.POV_URL ?? 'http://localhost:5173/'
const PROJECT_URL = process.env.POV_TEST_URL ?? 'https://exampleprojectref.supabase.co'
const KEY = process.env.POV_TEST_KEY ?? 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAA_bbbbbbbb'

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.removeItem('pov.supabase.config'))
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const button = () => page.getByRole('button', { name: /connect/i })

async function report(label) {
  const b = button()
  const count = await b.count()
  if (count === 0) {
    console.log(`${label}: BUTTON NOT IN THE DOM`)
    return
  }
  const visible = await b.isVisible()
  const enabled = await b.isEnabled()
  const boxRect = await b.boundingBox()
  const inViewport = boxRect ? boxRect.y + boxRect.height <= 800 : null
  const styles = await b.evaluate((el) => {
    const s = getComputedStyle(el)
    return { bg: s.backgroundColor, color: s.color, opacity: s.opacity, pointer: s.pointerEvents }
  })
  console.log(
    `${label}\n` +
      `   visible=${visible} enabled=${enabled} insideFirstScreen=${inViewport}\n` +
      `   y=${boxRect ? Math.round(boxRect.y) : '?'}  bg=${styles.bg}  opacity=${styles.opacity}`,
  )
}

await report('EMPTY FIELDS')

await page.fill('#cfg-url', PROJECT_URL)
await page.fill('#cfg-key', KEY)
await page.waitForTimeout(300)
await report('BOTH FIELDS FILLED')

// Any validation messages showing that would block submission?
const alerts = await page.locator('[role="alert"]').allTextContents()
console.log('validation messages:', alerts.length ? alerts : '(none)')

await page.screenshot({ path: path.join(OUT, 'connect-filled-fold.png') })
await page.screenshot({ path: path.join(OUT, 'connect-filled-full.png'), fullPage: true })

await browser.close()
