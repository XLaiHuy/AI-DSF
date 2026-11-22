import { Controller, Post, Get, Patch } from '@nestjs/common'
import { AdminService } from './admin.service'

@Controller('admin')
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

  @Patch('products')
  updateProduct() {
    return this.service.pending()
  }
}
