const { chromium } = require('@playwright/test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

;(async () => {
  const browser = await chromium.launch()
  for (const direction of ['a', 'b']) {
    for (const [size, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      await page.goto(`${pathToFileURL(path.join(__dirname, 'prototypes.html'))}?direction=${direction}`)
      await page.screenshot({ path: path.join(__dirname, `prototype-${direction}-${size}.png`), fullPage: true })
      console.log(`${direction} ${size} overflow=${await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`)
      await page.close()
    }
  }
  await browser.close()
})().catch((error) => { console.error(error); process.exitCode = 1 })
