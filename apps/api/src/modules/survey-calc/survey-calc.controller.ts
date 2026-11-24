import { Body, Controller, Get, Post, Req, UseGuards, UsePipes } from '@nestjs/common'
import { ManualCompareRequestSchema, SurveyInvestRequestSchema, SurveyLoanRequestSchema } from '@fincopilot/shared-types'
import type { FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { SurveyCalcService } from './survey-calc.service'

@Controller()
@UseGuards(GuestSessionGuard)
export class SurveyCalcController {
  constructor(private readonly service: SurveyCalcService) {}

  @Post('survey/loan')
  @UsePipes(new ZodValidationPipe(SurveyLoanRequestSchema))
  surveyLoan(@Body() body: unknown, @Req() request: FastifyRequest) { return this.service.loan(body as never, request.session) }

  @Post('survey/investment')
  @UsePipes(new ZodValidationPipe(SurveyInvestRequestSchema))
  surveyInvestment(@Body() body: unknown, @Req() request: FastifyRequest) { return this.service.investment(body as never, request.session) }

  @Post('calculator/manual-compare')
  @UsePipes(new ZodValidationPipe(ManualCompareRequestSchema))
  compareManual(@Body() body: unknown, @Req() request: FastifyRequest) { return this.service.manualCompare(body as never, request.session) }

  @Get('survey/history')
  history(@Req() request: FastifyRequest) { return this.service.history(request.session) }
}
