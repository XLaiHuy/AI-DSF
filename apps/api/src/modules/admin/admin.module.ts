import { Module } from '@nestjs/common'
import { AdminGuard } from '../../common/admin.guard'
import { RadarModule } from '../radar/radar.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({ imports: [RadarModule], controllers: [AdminController], providers: [AdminService, AdminGuard] })
export class AdminModule {}
