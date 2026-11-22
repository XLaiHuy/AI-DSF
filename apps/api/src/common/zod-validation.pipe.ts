import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        errorCode: 'ERR_VALIDATION_FAILED',
        message: 'Dữ liệu đầu vào không hợp lệ.',
        details: result.error.issues,
      })
    }
    return result.data
  }
}
