import { Controller } from '@nestjs/common'

// The AI gateway is a dependency-injection contract without a public REST endpoint.
@Controller()
export class AiGatewayController {}
