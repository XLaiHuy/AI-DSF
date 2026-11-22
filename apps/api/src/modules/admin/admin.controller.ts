import { Controller, Post, Get, Patch, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../../common/admin.guard'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Post('radar/fetch')
  fetchRadar() {
    return this.service.pending()
  }

  @Get('products')
  listProducts() {
    return this.service.pending()
  }

  @Post('products')
  createProduct() {
    return this.service.pending()
  }

  @Patch('products/:id')
  updateProduct() {
    return this.service.pending()
  }
}
