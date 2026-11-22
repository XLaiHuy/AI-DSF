import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class ForensicService {
  pending(): never {
    throw new NotImplementedException()
  }
}
