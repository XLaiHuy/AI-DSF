import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Prisma, type FinancialProfile } from '@prisma/client'
import {
  AuthProvider, FinancialProfileSchema, UserRole, type AuthLogin, type AuthRegister, type AuthSessionResponse,
  type FinancialProfileDto, type FinancialProfileUpdate, type SessionContext,
} from '@fincopilot/shared-types'
import { PrismaService } from '../../common/prisma.service'
import type { OAuthIdentity } from './oauth.service'
import { hashPassword, verifyPassword } from './password'

const publicUser = { id: true, email: true, fullName: true, authProvider: true, role: true, avatarUpdatedAt: true } satisfies Prisma.UserSelect
type UserDetails = Prisma.UserGetPayload<{ select: typeof publicUser }>
type SessionUser = Extract<AuthSessionResponse, { kind: 'user' }>['user']

const moneyFields = ['monthlyIncomeVnd', 'monthlyExpenseVnd', 'existingDebtPaymentVnd', 'liquidSavingsVnd'] as const

function profileOwner(session: SessionContext) {
  return session.kind === 'user' ? { userId: session.userId } : { guestSessionId: session.guestSessionId }
}

function serializeUser(user: UserDetails): SessionUser {
  return {
    id: user.id, email: user.email, displayName: user.fullName,
    avatarUrl: user.avatarUpdatedAt ? '/api/v1/profile/avatar/' + user.id + '?v=' + user.avatarUpdatedAt.getTime() : null,
    authProvider: AuthProvider.parse(user.authProvider), role: UserRole.parse(user.role),
  }
}

function serializeProfile(profile: FinancialProfile): FinancialProfileDto {
  return FinancialProfileSchema.parse({
    id: profile.id,
    userId: profile.userId,
    monthlyIncomeVnd: profile.monthlyIncomeVnd?.toFixed() ?? null,
    monthlyExpenseVnd: profile.monthlyExpenseVnd?.toFixed() ?? null,
    existingDebtPaymentVnd: profile.existingDebtPaymentVnd?.toFixed() ?? null,
    liquidSavingsVnd: profile.liquidSavingsVnd?.toFixed() ?? null,
    riskAppetite: profile.riskAppetite,
    primaryGoal: profile.primaryGoal,
  })
}

function prismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

@Injectable()
export class ProfileAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveProfile(session: SessionContext): Promise<FinancialProfileDto | null> {
    const profile = await this.prisma.financialProfile.findUnique({ where: profileOwner(session) })
    return profile ? serializeProfile(profile) : null
  }

  async updateProfile(session: SessionContext, data: FinancialProfileUpdate): Promise<FinancialProfileDto> {
    for (const key of moneyFields) {
      const value = data[key]
      if (value == null) continue
      if (value.length > 19 || !/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) {
        throw new BadRequestException({
          errorCode: 'ERR_VALIDATION_FAILED',
          message: 'Giá trị tiền phải có tối đa 16 chữ số nguyên và 2 chữ số thập phân.',
        })
      }
    }
    const owner = profileOwner(session)
    const profile = await this.prisma.financialProfile.upsert({
      where: owner,
      create: { ...data, ...owner, id: randomUUID() },
      update: { ...data, updatedAt: new Date() },
    })
    return serializeProfile(profile)
  }

  async saveAvatar(id: string, input: Buffer) {
    let image: Buffer | undefined
    try {
      const jpeg = input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      const png = input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      const webp = input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP'
      if (!jpeg && !png && !webp) throw new BadRequestException('Ảnh phải là JPEG, PNG hoặc WebP.')
      try {
        image = await sharp(input, { limitInputPixels: 40000000 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer()
      } catch { throw new BadRequestException('Không thể đọc ảnh chân dung.') }
      return await this.setAvatar(id, image.toString('base64'))
    } finally { input.fill(0); image?.fill(0) }
  }

  async setAvatar(id: string, avatarData: string | null) {
    const now = new Date()
    const user = await this.prisma.user.update({ where: { id }, data: { avatarData, avatarUpdatedAt: avatarData ? now : null, updatedAt: now }, select: publicUser })
    return { avatarUrl: serializeUser(user).avatarUrl }
  }

  async avatar(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { avatarData: true } })
    return user?.avatarData ? Buffer.from(user.avatarData, 'base64') : null
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicUser })
    if (!user) throw new UnauthorizedException()
    return serializeUser(user)
  }

  async register(input: AuthRegister, guestSessionId?: string): Promise<SessionUser> {
    const passwordHash = await hashPassword(input.password)
    return this.authenticate(guestSessionId, (tx) => tx.user.create({
      data: {
        id: randomUUID(), email: input.email, fullName: input.displayName,
        authProvider: 'EMAIL', passwordHash, role: 'USER',
      },
      select: publicUser,
    }))
  }

  async login(input: AuthLogin, guestSessionId?: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...publicUser, passwordHash: true },
    })
    const authorized = await verifyPassword(input.password, user?.authProvider === 'EMAIL' ? user.passwordHash : null)
    if (!authorized || !user) {
      throw new UnauthorizedException({ errorCode: 'ERR_UNAUTHORIZED', message: 'Email hoặc mật khẩu không chính xác.' })
    }
    return this.authenticate(guestSessionId, (tx) => tx.user.findUniqueOrThrow({
      where: { id: user.id }, select: publicUser,
    }))
  }

  async oauthLogin(identity: OAuthIdentity, guestSessionId?: string): Promise<SessionUser> {
    return this.authenticate(guestSessionId, async (tx) => {
      const where = { authProvider: identity.provider, providerUserId: identity.subject }
      const account = await tx.user.findFirst({ where, select: publicUser })
      if (account) return account
      // OAuthService only returns email addresses verified by the provider.
      const existing = await tx.user.findUnique({ where: { email: identity.email }, select: publicUser })
      if (existing?.role === 'ADMIN') throw this.accountConflict()
      if (existing) return existing
      return tx.user.create({
        data: { ...where, id: randomUUID(), email: identity.email, fullName: identity.name, role: 'USER' },
        select: publicUser,
      })
    })
  }

  private accountConflict() {
    return new ConflictException({
      errorCode: 'ERR_VALIDATION_FAILED',
      message: 'Email này đã được đăng ký. Hãy đăng nhập bằng phương thức đã sử dụng.',
    })
  }

  private async authenticate(
    guestSessionId: string | undefined,
    getUser: (tx: Prisma.TransactionClient) => Promise<UserDetails>,
  ): Promise<SessionUser> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const user = await getUser(tx)
          if (guestSessionId) await this.mergeGuest(tx, user.id, guestSessionId)
          return serializeUser(user)
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        // Concurrent merges can race on the unique profile owner before either transaction sees it.
        const conflict = prismaError(error, 'P2002')
        if (attempt < 3 && (prismaError(error, 'P2034') || conflict)) continue
        if (conflict) throw this.accountConflict()
        throw error
      }
    }
  }

  private async mergeGuest(tx: Prisma.TransactionClient, userId: string, guestSessionId: string) {
    const where = { guestSessionId, userId: null }
    const existingProfile = await tx.financialProfile.findUnique({ where: { userId }, select: { id: true } })
    // Preserve the old profile for historical calculation references while retiring its guest owner.
    await tx.financialProfile.updateMany({
      where, data: { guestSessionId: null, userId: existingProfile ? null : userId },
    })
    const transfer = { where, data: { userId, guestSessionId: null } }
    await tx.forensicAudit.updateMany(transfer)
    await tx.calculationSession.updateMany(transfer)
  }
}
