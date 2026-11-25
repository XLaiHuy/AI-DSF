import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { AdminGuard } from './admin.guard'
import type { PrismaService } from './prisma.service'

const userId = '40fdbec9-0450-4b88-a58b-42c8568fe823'
const jwt = new JwtService({ secret: 'admin-guard-test-signing-secret' })
const token = jwt.sign({ sub: userId })

function fixture(role = 'USER', apiKey = 'test-admin-key') {
  const findUnique = vi.fn(async () => ({ role }))
  const prisma = { user: { findUnique } } as unknown as PrismaService
  const guard = new AdminGuard(new ConfigService({ ADMIN_API_KEY: apiKey, NODE_ENV: 'development' }), jwt, prisma)
  return { guard, findUnique }
}

function context(headers: FastifyRequest['headers'] = {}, cookie?: { value: string; valid: boolean }) {
  const request = {
    headers, cookies: cookie ? { auth_token: 'signed-cookie' } : {},
    unsignCookie: () => cookie,
  }
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
}

describe('AdminGuard', () => {
  it('rejects a guest with 403', async () => {
    await expect(fixture().guard.canActivate(context())).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a USER even if their JWT claims ADMIN', async () => {
    const claimedAdmin = jwt.sign({ sub: userId, role: 'ADMIN' })
    const { guard, findUnique } = fixture()
    await expect(guard.canActivate(context({ authorization: `Bearer ${claimedAdmin}` }))).rejects.toBeInstanceOf(ForbiddenException)
    expect(findUnique).toHaveBeenCalledWith({ where: { id: userId }, select: { role: true } })
  })

  it('accepts an ADMIN with a signed session cookie', async () => {
    await expect(fixture('ADMIN').guard.canActivate(context({}, { valid: true, value: token }))).resolves.toBe(true)
  })

  it('accepts an ADMIN bearer token without an API key', async () => {
    await expect(fixture('ADMIN', '').guard.canActivate(context({ authorization: `Bearer ${token}` }))).resolves.toBe(true)
  })

  it('accepts a configured matching API key', async () => {
    const { guard, findUnique } = fixture()
    await expect(guard.canActivate(context({ 'x-admin-key': 'test-admin-key' }))).resolves.toBe(true)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('rejects an invalid API key with 403', async () => {
    await expect(fixture().guard.canActivate(context({ 'x-admin-key': 'wrong-key' }))).rejects.toMatchObject({ status: 403 })
  })

  it('rejects a blank configuration in development with 403', async () => {
    await expect(fixture('USER', ' ').guard.canActivate(context({ 'x-admin-key': '' }))).rejects.toMatchObject({ status: 403 })
  })

  it('rejects unsigned cookies and JWTs with an invalid subject before querying the database', async () => {
    const { guard, findUnique } = fixture('ADMIN')
    const malformed = jwt.sign({ sub: 'not-a-uuid' })
    await expect(guard.canActivate(context({ authorization: `Bearer ${malformed}` }, { valid: false, value: token })))
      .rejects.toMatchObject({ status: 403 })
    expect(findUnique).not.toHaveBeenCalled()
  })
})
