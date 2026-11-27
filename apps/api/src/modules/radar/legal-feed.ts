import type { Prisma } from '@prisma/client'

const legalSources = ['vnexpress_phapluat', 'dantri_phapluat']
const terms = ['tài chính', 'lừa đảo', 'lừa chiếm đoạt', 'ngân hàng', 'tín dụng', 'tiền ảo', 'tiền số', 'tiền mã hóa',
  'mạo danh', 'chuyển khoản', 'rửa tiền', 'vay nặng lãi', 'cho vay', 'chiếm đoạt tài sản', 'chứng khoán', 'trái phiếu']

export function relevantHeadline(sourceKey: string, title: string) {
  return !legalSources.includes(sourceKey) || terms.some(term => title.toLocaleLowerCase('vi').includes(term))
}

// Apply before pagination so hidden headlines do not consume a page.
export const relevantArticleWhere: Prisma.MarketArticleWhereInput = {
  OR: [
    { sources: { none: { source: { sourceKey: { in: legalSources } } } } },
    { sources: { some: { source: { sourceKey: { notIn: legalSources } } } } },
    ...terms.map(term => ({ title: { contains: term, mode: 'insensitive' as const } })),
  ],
}
