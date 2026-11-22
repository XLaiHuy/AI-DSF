import { Module } from '@nestjs/common'
import { ForensicController } from './forensic.controller'
import { ForensicService } from './forensic.service'

@Module({ controllers: [ForensicController], providers: [ForensicService] })
export class ForensicModule {}
