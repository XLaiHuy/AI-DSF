import { Injectable, NotImplementedException } from '@nestjs/common'
import type { AI_TASK_SCHEMAS, AiTaskOutput, AiTaskType, IAiGatewayService } from '@fincopilot/shared-types'

@Injectable()
export class AiGatewayService implements IAiGatewayService {
  async generateStructured<T extends AiTaskType>(
    _taskType: T,
    _schema: (typeof AI_TASK_SCHEMAS)[T],
    _payload: unknown,
  ): Promise<AiTaskOutput<T>> {
    throw new NotImplementedException()
  }
}
