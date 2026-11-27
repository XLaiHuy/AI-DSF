import type { Prisma } from '@prisma/client'
import { classifyVnScamTaxonomy } from './vn-scam-taxonomy'

type TaxonomyInput = { threatCategory: string; tacticSummary: string; sourceExcerpt?: string | null }

export function threatTaxonomyFields({ tacticSummary, sourceExcerpt, threatCategory }: TaxonomyInput) {
  const match = classifyVnScamTaxonomy({ text: [tacticSummary, sourceExcerpt].filter(Boolean).join('\n'), threatCategory })[0]
  return {
    vnAisCode: match?.vnAisCode ?? null, gasaCategory: match?.gasaCategory ?? null, targetAudience: match?.targetAudience ?? null,
  }
}

export async function backfillThreatTaxonomy(prisma: Pick<Prisma.TransactionClient, 'threatAlert'>) {
  const missing = { OR: [{ vnAisCode: null }, { gasaCategory: null }, { targetAudience: null }] }
  let after: string | undefined
  let updated = 0
  for (;;) {
    const rows = await prisma.threatAlert.findMany({
      where: { ...missing, id: after ? { gt: after } : undefined },
      orderBy: { id: 'asc' }, take: 200,
      select: { id: true, threatCategory: true, tacticSummary: true, sourceExcerpt: true, updatedAt: true },
    })
    if (!rows.length) return updated
    for (const row of rows) {
      const fields = threatTaxonomyFields(row)
      if (fields.vnAisCode) {
        // A concurrent review can replace the summary after this batch was read.
        const { count } = await prisma.threatAlert.updateMany({
          where: { ...missing, id: row.id, updatedAt: row.updatedAt }, data: fields,
        })
        updated += count
      }
    }
    after = rows.at(-1)?.id
  }
}
