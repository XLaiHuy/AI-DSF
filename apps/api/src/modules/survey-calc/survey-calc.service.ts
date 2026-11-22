import { Injectable, NotImplementedException } from '@nestjs/common'

@Injectable()
export class SurveyCalcService {
  pending(): never {
    throw new NotImplementedException()
  }
}
