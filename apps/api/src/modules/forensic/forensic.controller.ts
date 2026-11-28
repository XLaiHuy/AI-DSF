import { PassThrough, Readable } from 'node:stream'
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpException, Param, PayloadTooLargeException,
  Post, Query, Req, Res, UseGuards,
} from '@nestjs/common'
import {
  ApiErrorCode, ForensicAuditFieldsSchema, ForensicFollowUpRequestSchema, UserAuditFeedbackSchema, type UserAuditFeedback,
  type ForensicAuditStreamEvent, type ForensicFollowUpRequest,
} from '@fincopilot/shared-types'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { RateLimit } from '../../common/rate-limit.guard'
import { GuestSessionGuard } from '../../common/guest-session.guard'
import { ZodValidationPipe } from '../../common/zod-validation.pipe'
import { ForensicService, validateAuditInput } from './forensic.service'
import { buildStix21Bundle } from './stix-exporter'

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

async function parseAuditUpload(request: FastifyRequest, body: unknown) {
  const files: { buffer: Buffer }[] = []
  if (!request.isMultipart()) return { fields: fieldsPipe.transform(body), files }

  try {
    const fields: Record<string, string> = {}
    let invalidField = false
    for await (const part of request.parts({ limits: { fields: fieldNames.size, parts: fieldNames.size + 6, fieldSize: 200_000 } })) {
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
    return { fields: fieldsPipe.transform(fields), files }
  } catch (error) {
    for (const { buffer } of files) buffer.fill(0)
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.code === 'FST_FILES_LIMIT') throw fileLimit()
      if (error.code === 'FST_FIELDS_LIMIT' || error.code === 'FST_PARTS_LIMIT') throw new BadRequestException()
    }
    throw error
  }
}

@Controller('forensic')
@UseGuards(GuestSessionGuard)
export class ForensicController {
  constructor(private readonly service: ForensicService) {}

  @Post(['audit', 'audits'])
  @RateLimit('forensic')
  async audit(@Req() request: FastifyRequest, @Body() body: unknown) {
    const { fields, files } = await parseAuditUpload(request, body)
    try {
      return await this.service.screenAudit(fields, files, request.session) ?? await this.service.audit(request.session, fields, files)
    } finally {
      for (const { buffer } of files) buffer.fill(0)
    }
  }

  @Post('audit/stream')
  @RateLimit('forensic')
  async auditStream(@Req() request: FastifyRequest, @Body() body: unknown, @Res() reply: FastifyReply) {
    const { fields, files } = await parseAuditUpload(request, body)
    const purge = () => {
      for (const { buffer } of files) buffer.fill(0)
    }
    const stream = new PassThrough()
    const emit = (event: ForensicAuditStreamEvent) => {
      if (!reply.raw.destroyed && !stream.destroyed) stream.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    try {
      validateAuditInput(fields, files)
      if (reply.raw.destroyed) return
      reply.raw.once('close', purge)
      reply.code(200)
        .header('Content-Type', 'text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('Connection', 'keep-alive')
        .header('X-Accel-Buffering', 'no')
        .send(stream)
      try {
        const refusal = await this.service.screenAudit(fields, files, request.session)
        if (refusal) emit(refusal)
        else {
          const audit = await this.service.audit(request.session, fields, files, (stage) => emit({ type: 'stage', stage }))
          emit({ type: 'result', audit })
        }
        emit({ type: 'done' })
      } catch (error) {
        const response = error instanceof HttpException ? error.getResponse() : null
        const fields = response && typeof response === 'object' ? response : {}
        const code = ApiErrorCode.safeParse('errorCode' in fields ? fields.errorCode : undefined)
        const message = code.success && 'message' in fields && typeof fields.message === 'string'
          ? fields.message : 'Đã xảy ra lỗi hệ thống.'
        emit({ type: 'error', errorCode: code.success ? code.data : 'ERR_INTERNAL_SERVER', message })
      }
    } finally {
      purge()
      reply.raw.off('close', purge)
      stream.end()
    }
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(@Req() request: FastifyRequest, @Param('id', new ZodValidationPipe(z.uuid())) id: string) {
    await this.service.deleteConversation(request.session, id)
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
    @Query('format') format?: string,
  ) {
    const audit = await this.service.read(request.session, id)
    reply.header('Cache-Control', 'private, no-store')
    if (format === 'stix') {
      reply.header('Content-Disposition', `attachment; filename="fincopilot-${audit.auditId}-stix21.json"`)
      reply.type('application/stix+json; version=2.1')
      return buildStix21Bundle(audit)
    }
    reply.header('Content-Disposition', `attachment; filename="fincopilot-${audit.auditId}.json"`)
    return audit
  }

  @Post('audits/:id/feedback')
  feedback(@Req() request: FastifyRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(UserAuditFeedbackSchema)) body: UserAuditFeedback) {
    return this.service.recordFeedback(request.session, id, body)
  }

  @Post('audits/:id/chat')
  @HttpCode(200)
  chat(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ForensicFollowUpRequestSchema)) body: ForensicFollowUpRequest,
  ) {
    return this.service.followUp(request.session, id, body)
  }

  @Post('audits/:id/chat/stream')
  @HttpCode(200)
  async chatStream(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ForensicFollowUpRequestSchema)) body: ForensicFollowUpRequest,
    @Res() reply: FastifyReply,
  ) {
    const controller = new AbortController()
    reply.raw.once('close', () => controller.abort())
    const events = await this.service.streamFollowUp(request.session, id, body, controller.signal)
    if (reply.raw.destroyed) return
    const frames = async function* () {
      for await (const event of events) yield `data: ${JSON.stringify(event)}\n\n`
    }
    reply.header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('Connection', 'keep-alive')
      .header('X-Accel-Buffering', 'no')
      .send(Readable.from(frames(), { objectMode: false }))
  }
}
