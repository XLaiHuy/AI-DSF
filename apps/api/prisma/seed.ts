import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function seed() {
  try {
    await prisma.$connect()
    // Tài: add Radar sources, licensed institutions and products here.
  } finally {
    await prisma.$disconnect()
  }
}

void seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed')
  process.exitCode = 1
})
