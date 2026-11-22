import { Controller, Post, Get, UseGuards } from '@nestjs/common'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { SurveyCalcService } from './survey-calc.service'

@Controller()
@UseGuards(GuestSessionGuard)
export class SurveyCalcController {
  constructor(private readonly service: SurveyCalcService) {}

  @Post('survey/loan')
  surveyLoan() {
    return this.service.pending()
  }

  @Post('survey/investment')
  surveyInvestment() {
    return this.service.pending()
  }

  @Post('calculator/manual-compare')
  compareManual() {
    return this.service.pending()
  }

  @Get('survey/history')
  history() {
    return this.service.pending()
  }
}
