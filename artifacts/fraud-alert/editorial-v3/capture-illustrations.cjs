const { chromium } = require('@playwright/test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 720 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(path.join(__dirname, 'illustrations.html')).href)
  await page.locator('img').first().evaluate(async (img) => img.decode())
  await page.screenshot({ path: path.join(__dirname, 'illustrations.png') })
  await browser.close()
})().catch((error) => { console.error(error); process.exitCode = 1 })
