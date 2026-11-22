import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { ApiErrorCode, type ApiErrorBody } from '@fincopilot/shared-types'
import type { FastifyReply } from 'fastify'

const defaultErrors: Record<number, { errorCode: ApiErrorCode; message: string }> = {
  400: { errorCode: 'ERR_VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ.' },
  401: { errorCode: 'ERR_UNAUTHORIZED', message: 'Phiên xác thực không hợp lệ.' },
  403: { errorCode: 'ERR_FORBIDDEN', message: 'Bạn không có quyền truy cập.' },
  404: { errorCode: 'ERR_NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
  413: { errorCode: 'ERR_FILE_TOO_LARGE', message: 'Tệp vượt quá giới hạn.' },
  422: { errorCode: 'ERR_VALIDATION_FAILED', message: 'Không thể xử lý dữ liệu.' },
  500: { errorCode: 'ERR_INTERNAL_SERVER', message: 'Đã xảy ra lỗi hệ thống.' },
  501: { errorCode: 'ERR_NOT_IMPLEMENTED', message: 'Chức năng sẽ có trong giai đoạn tiếp theo.' },
  503: { errorCode: 'ERR_SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời chưa sẵn sàng.' },
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500
    const response = exception instanceof HttpException ? exception.getResponse() : undefined
    const fields = response && typeof response === 'object' ? response : {}
    const fallback = defaultErrors[statusCode] ?? (statusCode >= 500 ? defaultErrors[500] : defaultErrors[400])
    const code = ApiErrorCode.safeParse('errorCode' in fields ? fields.errorCode : undefined)

    const body: ApiErrorBody = { statusCode, ...fallback }
    if (code.success) {
      body.errorCode = code.data
      if ('message' in fields && typeof fields.message === 'string') body.message = fields.message
      if ('details' in fields) body.details = fields.details
    }

    host.switchToHttp().getResponse<FastifyReply>().status(statusCode).send(body)
  }
}
