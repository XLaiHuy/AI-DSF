import {
  BadRequestException, Body, Controller, Get, Param, PayloadTooLargeException,
  Post, Req, Res, UseGuards,
} from '@nestjs/common'
import { ForensicAuditFieldsSchema } from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { ForensicService } from './forensic.service'

const fieldsPipe = new ZodValidationPipe(ForensicAuditFieldsSchema)
const fieldNames = new Set(Object.keys(ForensicAuditFieldsSchema.shape))

function fileLimit() {
  return new PayloadTooLargeException({
    errorCode: 'ERR_FILE_TOO_LARGE',
    message: 'Tệp vượt quá giới hạn tải lên.',
  })
}

async function readFile(part: AsyncIterable<Buffer> & { truncated: boolean }): Promise<Buffer> {
  const chunks: Buffer[] = []
  try {
    for await (const chunk of part) chunks.push(chunk)
    if (part.truncated) throw fileLimit()
    return Buffer.concat(chunks)
  } finally {
    for (const chunk of chunks) chunk.fill(0)
  }
}

@Controller('forensic')
@UseGuards(GuestSessionGuard)
export class ForensicController {
  constructor(private readonly service: ForensicService) {}

  @Post('audit')
  async audit(@Req() request: FastifyRequest, @Body() body: unknown) {
    const files: { buffer: Buffer }[] = []
    try {
      if (!request.isMultipart()) return await this.service.audit(request.session, fieldsPipe.transform(body), files)

      const fields: Record<string, string> = {}
      let invalidField = false
      for await (const part of request.parts({
        limits: { fields: 3, parts: 10, fieldSize: 200_000 },
      })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'files') invalidField = true
          files.push({ buffer: await readFile(part.file) })
        } else if (part.valueTruncated || !fieldNames.has(part.fieldname) ||
          typeof part.value !== 'string' || Object.hasOwn(fields, part.fieldname)) {
          invalidField = true
        } else {
          fields[part.fieldname] = part.value
        }
      }
      if (invalidField) throw new BadRequestException()
      return await this.service.audit(request.session, fieldsPipe.transform(fields), files)
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'FST_REQ_FILE_TOO_LARGE') throw fileLimit()
        if (error.code === 'FST_FILES_LIMIT' || error.code === 'FST_FIELDS_LIMIT' ||
          error.code === 'FST_PARTS_LIMIT') throw new BadRequestException()
      }
      throw error
    } finally {
      for (const { buffer } of files) buffer.fill(0)
    }
  }

  @Get('audits')
  listAudits(@Req() request: FastifyRequest) {
    return this.service.list(request.session)
  }

  @Get('audits/:id')
  readAudit(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.service.read(request.session, id)
  }

  @Get('audits/:id/export')
  async exportAudit(
    @Req() request: FastifyRequest, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const audit = await this.service.read(request.session, id)
    reply.header('Content-Disposition', `attachment; filename="fincopilot-${audit.auditId}.json"`)
    reply.header('Cache-Control', 'private, no-store')
    return audit
  }
}
