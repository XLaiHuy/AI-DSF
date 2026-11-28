import { readFile } from 'node:fs/promises'

const source = new URL('../apps/api/src/modules/forensic/data/trusted-institutions.ts', import.meta.url)
const endpoint = 'https://api.vietqr.io/v2/banks'
const matchCode = /^\d{6}$/u
const normalize = (label) => label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/gu, '')

async function localBins() {
  const text = await readFile(source, 'utf8')
  const tables = [...text.matchAll(/^const (?:banks|additionalBins) = \[([\s\S]*?)^\] as const/gm)]
  if (tables.length !== 2) throw new Error('Could not read the local BIN table')
  return new Map(tables.flatMap(([, body]) => [...body.matchAll(/\['(\d{6})', '([^']+)'/gu)].map(([, bin, name]) => [bin, name])))
}

async function remoteBins() {
  try {
    const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(3500) })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const body = await response.json()
    if (body.code !== '00' || !Array.isArray(body.data) || !body.data.length) return null
    return new Map(body.data.flatMap(({ bin, shortName }) =>
      typeof bin === 'string' && matchCode.test(bin) && typeof shortName === 'string' ? [[bin, shortName]] : [],
    ))
  } catch {
    return null
  }
}

function printList(title, rows) {
  console.log(title + ' (' + rows.length + ')')
  for (const [bin, name] of rows.sort(([left], [right]) => left.localeCompare(right))) console.log('  ' + bin + '  ' + name)
}

const local = await localBins()
const remote = await remoteBins()
if (!remote?.size) {
  console.log('VietQR unavailable. Local table has ' + local.size + ' BINs. Comparison skipped.')
} else {
  console.log('Local BINs: ' + local.size + ' | VietQR BINs: ' + remote.size)
  printList('Only in VietQR', [...remote].filter(([bin]) => !local.has(bin)))
  printList('Only in local table', [...local].filter(([bin]) => !remote.has(bin)))
  printList('Different display names', [...local].flatMap(([bin, name]) => {
    const current = remote.get(bin)
    return current && normalize(current) !== normalize(name) ? [[bin, name + ' → ' + current]] : []
  }))
}
