import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { AuthLoginSchema } from '@fincopilot/shared-types'
import { parse } from 'yaml'
import { hashPassword } from '../src/modules/profile-auth/password'
import { stableUuid } from '../src/common/stable-uuid'
import { seedProducts } from './seed-products'
import { seedRadarAlerts } from './seed-radar-alerts'

const prisma = new PrismaClient()
const sourceConfig = parse(readFileSync(resolve(__dirname, '../../../config/sources.yaml'), 'utf8')) as {
  sources: Array<{ sourceKey: string; name: string; sourceType: string; endpointUrl: string; isTrustedForAlerts: boolean; isActive?: boolean }>
}

async function seedAdmin() {
  const configuredPassword = process.env.ADMIN_SEED_PASSWORD
  const { email, password } = AuthLoginSchema.parse({
    email: (process.env.ADMIN_SEED_EMAIL ?? 'admin@fincopilot.vn').trim().toLowerCase(),
    password: configuredPassword ?? 'Admin@FinCopilot2026!',
  })
  const id = stableUuid('user:admin')
  const existing = await prisma.user.findUnique({
    where: { email }, select: { id: true, authProvider: true, passwordHash: true, role: true },
  })
  if (existing && (existing.authProvider !== 'EMAIL' || (existing.id !== id && existing.role !== 'ADMIN'))) {
    throw new Error('ADMIN_SEED_EMAIL is already used by an account outside the admin seed.')
  }
  const passwordHash = configuredPassword !== undefined || !existing?.passwordHash
    ? await hashPassword(password) : existing.passwordHash
  await prisma.user.upsert({
    where: { email, authProvider: 'EMAIL', OR: [{ id }, { role: 'ADMIN' }] },
    create: { id, email, passwordHash, fullName: 'Quản trị viên FinCopilot', authProvider: 'EMAIL', role: 'ADMIN' },
    update: { role: 'ADMIN', ...(configuredPassword !== undefined || !existing?.passwordHash ? { passwordHash } : {}) },
  })
}

async function seed() {
  try {
    await prisma.$connect()
    await seedAdmin()

    for (const source of sourceConfig.sources) {
      const isActive = source.isActive ?? true
      const fields = {
        sourceKey: source.sourceKey,
        name: source.name,
        sourceType: source.sourceType,
        endpointUrl: source.endpointUrl,
        isTrustedForAlerts: source.isTrustedForAlerts,
        isActive,
      }
      await prisma.marketSource.upsert({
        where: { sourceKey: source.sourceKey },
        create: { id: stableUuid(`source:${source.sourceKey}`), ...fields },
        update: { ...fields, ...(isActive ? {} : { lastFetchStatus: null }) },
      })
    }

    await seedProducts(prisma)
    await seedRadarAlerts(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed')
  process.exitCode = 1
})
