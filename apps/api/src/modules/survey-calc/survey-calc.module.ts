import { Module } from '@nestjs/common'
import { SurveyCalcController } from './survey-calc.controller'
import { SurveyCalcService } from './survey-calc.service'

@Module({ controllers: [SurveyCalcController], providers: [SurveyCalcService] })
export class SurveyCalcModule {}
