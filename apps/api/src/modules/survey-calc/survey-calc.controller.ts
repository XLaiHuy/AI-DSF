import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import {
  ManualCompareRequestSchema, SurveyInvestRequestSchema, SurveyLoanRequestSchema,
  type ManualCompareRequest, type SurveyInvestRequest, type SurveyLoanRequest,
} from '@fincopilot/shared-types'
import type { FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { SurveyCalcService } from './survey-calc.service'

@Controller()
@UseGuards(GuestSessionGuard)
export class SurveyCalcController {
  constructor(private readonly service: SurveyCalcService) {}

  @Post('survey/loan')
  surveyLoan(@Body(new ZodValidationPipe(SurveyLoanRequestSchema)) body: SurveyLoanRequest, @Req() request: FastifyRequest) {
    return this.service.loan(body, request.session)
  }

  @Post('survey/investment')
  surveyInvestment(@Body(new ZodValidationPipe(SurveyInvestRequestSchema)) body: SurveyInvestRequest, @Req() request: FastifyRequest) {
    return this.service.investment(body, request.session)
  }

  @Post('calculator/manual-compare')
  compareManual(@Body(new ZodValidationPipe(ManualCompareRequestSchema)) body: ManualCompareRequest, @Req() request: FastifyRequest) {
    return this.service.manualCompare(body, request.session)
  }

  @Get('survey/history')
  history(@Req() request: FastifyRequest) { return this.service.history(request.session) }

  @Get('survey/sessions/:id')
  sessionDetail(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.service.sessionDetail(request.session, id)
  }
}
