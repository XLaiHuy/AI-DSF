import { Module } from '@nestjs/common'
import { SurveyCalcController } from './survey-calc.controller'
import { SurveyCalcService } from './survey-calc.service'
import { PrismaModule } from '../../common/prisma.module'

@Module({ imports: [PrismaModule], controllers: [SurveyCalcController], providers: [SurveyCalcService] })
export class SurveyCalcModule {}
