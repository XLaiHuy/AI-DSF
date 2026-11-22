import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class AdminService {
  pending(): never {
    throw new NotImplementedException()
  }
}
