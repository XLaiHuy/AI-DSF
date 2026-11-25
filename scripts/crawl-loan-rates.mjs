import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const { parse } = require(resolve('apps/api/node_modules/yaml'))
const root = process.cwd()
const config = parse(await readFile(resolve(root, 'config/loan-rate-sources.yaml'), 'utf8'))
const crawledAt = new Date().toISOString()
const ratePattern = /(?:lãi\s*(?:suất|vay)|lãi\s*suất\s*(?:ưu đãi|từ)|interest rate)[^\n%]{0,180}?([0-9]{1,2}(?:[.,][0-9]{1,4})?)\s*%/giu
const linkKeywords = /vay|vốn|tiêu dùng|tín dụng|mua nhà|nhà ở|bất động sản|mua xe|ô tô|kinh doanh|thế chấp|cầm cố/iu
const categoryKeywords = [
  ['HOME_LOAN', /mua nhà|nhà ở|bất động sản|xây dựng|sửa chữa nhà/iu],
  ['AUTO_LOAN', /mua ô tô|mua xe|ô tô/iu],
  ['BUSINESS_LOAN', /sản xuất kinh doanh|kinh doanh|hộ kinh doanh/iu],
  ['UNSECURED_LOAN', /tín chấp|không tài sản bảo đảm|tiêu dùng/iu],
  ['SECURED_LOAN', /thế chấp|tài sản bảo đảm|cầm cố/iu],
]

function categories(text) { return categoryKeywords.filter(([, pattern]) => pattern.test(text)).map(([category]) => category) }
function evidence(text, sourceUrl) {
  const results = []
  for (const match of text.matchAll(ratePattern)) {
    const rate = Number(match[1].replace(',', '.'))
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) continue
    const start = Math.max(0, match.index - 120)
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 120)
    const quote = text.slice(start, end).replace(/\s+/g, ' ').trim()
    results.push({ ratePct: String(rate), quote, sourceUrl, categories: categories(quote) })
  }
  return results.filter((item, index, all) => all.findIndex((candidate) => candidate.ratePct === item.ratePct && candidate.quote === item.quote) === index).slice(0, 30)
}
async function openPage(page, url) {
  let response
  try { response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }) } catch (firstError) {
    if (!String(firstError).includes('HTTP2') && !String(firstError).includes('ERR_')) throw firstError
    response = await page.goto(url, { waitUntil: 'commit', timeout: 20_000 })
  }
  await page.waitForTimeout(1_000)
  const status = response?.status() ?? null
  if (!response || status >= 400) throw new Error(`HTTP ${status ?? 'NO_RESPONSE'}`)
  return { status, title: await page.title(), text: await page.locator('body').innerText({ timeout: 5_000 }) }
}
async function discoverLinks(page, baseUrl) {
  const base = new URL(baseUrl)
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({ href: anchor.href, text: anchor.textContent ?? '' })))
  return links.map((link) => ({ ...link, href: new URL(link.href, base).toString() }))
    .filter((link) => { try { return new URL(link.href).hostname === base.hostname && linkKeywords.test(`${link.text} ${link.href}`) } catch { return false } })
    .filter((link, index, all) => all.findIndex((candidate) => candidate.href.split('#')[0] === link.href.split('#')[0]) === index)
    .filter((link) => link.href.split('#')[0] !== baseUrl.split('#')[0])
    .slice(0, 8)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: 'FinCopilotLoanRateCrawler/1.0 (+project review; no anti-bot bypass)', locale: 'vi-VN' })
const results = []
try {
  for (const source of config.sources ?? []) {
    const startedAt = Date.now(); const page = await context.newPage()
    try {
      const landing = await openPage(page, source.endpointUrl)
      const links = await discoverLinks(page, source.endpointUrl)
      const pages = [{ url: source.endpointUrl, title: landing.title, text: landing.text, httpStatus: landing.status }]
      for (const link of links) {
        const detail = await context.newPage()
        try { const opened = await openPage(detail, link.href); pages.push({ url: link.href, title: opened.title, text: opened.text, httpStatus: opened.status }) } catch { /* keep the landing page result */ } finally { await detail.close() }
        await new Promise((delay) => setTimeout(delay, 700))
      }
      const candidates = pages.flatMap((item) => evidence(item.text, item.url))
      results.push({ sourceKey: source.sourceKey, institutionCode: source.institutionCode, institutionName: source.institutionName, sourceUrl: source.endpointUrl, crawledAt, status: 'PENDING_REVIEW', httpStatus: landing.status, title: landing.title, discoveredLinks: links.map((link) => ({ text: link.text.trim(), url: link.href })), categories: categories(pages.map((item) => item.text).join(' ')), candidates: candidates.slice(0, 50), pagesCrawled: pages.length, durationMs: Date.now() - startedAt })
    } catch (error) {
      results.push({ sourceKey: source.sourceKey, institutionCode: source.institutionCode, institutionName: source.institutionName, sourceUrl: source.endpointUrl, crawledAt, status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error), candidates: [], pagesCrawled: 0, durationMs: Date.now() - startedAt })
    } finally { await page.close(); await new Promise((delay) => setTimeout(delay, 1_000)) }
  }
} finally { await context.close(); await browser.close() }

console.error(`Loan-rate detail crawl complete: ${results.length} sources`)
for (const result of results) console.error(`${result.institutionName}: ${result.status}${result.candidates?.length ? `, ${result.candidates.length} candidates` : ''}`)
process.stdout.write(JSON.stringify({ crawledAt, status: 'PENDING_REVIEW', results }, null, 2) + '\n')
