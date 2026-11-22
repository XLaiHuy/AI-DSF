import { Injectable, NotImplementedException } from '@nestjs/common'
import type { FinancialProfileDto, SessionContext } from '@fincopilot/shared-types'

@Injectable()
export class ProfileAuthService {
  async getActiveProfile(_sessionCtx: SessionContext): Promise<FinancialProfileDto | null> {
    return null
  }

  pending(): never {
    throw new NotImplementedException()
  }
}
