import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class RadarService {
  pending(): never {
    throw new NotImplementedException()
  }
}
