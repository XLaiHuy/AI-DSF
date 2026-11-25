import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import { expect, it, vi } from 'vitest'
import type { PrismaService } from '../../common/prisma.service'
import { attachThreatDraft } from './threat-draft'
import { ThreatMemoryService } from './threat-memory.service'

it('serializes concurrent cross-source drafts and stores fingerprints, with one evidence attachment', async () => {
  const memory = new ThreatMemoryService({} as PrismaService, new ConfigService({ JWT_SECRET: 'test-draft-fingerprint-key' }))
  const identifier = '0912345678'
  const articleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let alertId: string | undefined
  let tail = Promise.resolve()
  const insert = vi.fn(({ data }: { data: { id: string } }) => { alertId = data.id })
  const attach = vi.fn().mockResolvedValue({ count: 0 })
  const locks: string[] = []
  async function ingest(origin: 'RADAR_AUTO' | 'ADMIN_INGEST') {
    let release: () => void = () => {}
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray) => {
        locks.push(sql.join(''))
        const previous = tail
        tail = new Promise<void>((resolve) => { release = resolve })
        await previous
      },
      threatAlert: { findFirst: async () => alertId ? { id: alertId } : null, findMany: async () => [], create: insert },
      threatEvidence: { createMany: attach },
    } as unknown as Prisma.TransactionClient
    try {
      return await attachThreatDraft(tx, memory, {
        source: { articleId, sourceId, title: 'Tin cảnh báo giả mạo', url: 'https://example.test/news', publishedAt: new Date() },
        draft: { threatCategory: 'PHISHING', tacticSummary: 'Tin cảnh báo giả mạo', preventionGuidance: 'Kiểm tra với ngân hàng.',
          indicators: [{ indicatorType: 'PHONE', indicatorText: identifier }, { indicatorType: 'PHONE', indicatorText: '+84912345678' }] },
        origin, trusted: [],
      })
    } finally {
      release()
    }
  }

  expect(await Promise.all([ingest('RADAR_AUTO'), ingest('ADMIN_INGEST')])).toEqual([
    { proposal: 1, attached: 1 }, { proposal: 0, attached: 0 },
  ])
  expect(locks).toHaveLength(2)
  expect(locks[0]).toContain('pg_advisory_xact_lock')
  expect(insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    data: expect.objectContaining({
      publishedAt: null, verificationStatus: 'UNVERIFIED',
      evidence: { create: { articleId, sourceId } },
      indicators: { create: [{ id: expect.any(String), indicatorType: 'PHONE', indicatorText: memory.fingerprint('PHONE', identifier) }] },
    }),
  }))
  expect(attach).toHaveBeenCalledExactlyOnceWith({ data: { threatAlertId: alertId, articleId, sourceId }, skipDuplicates: true })
})
