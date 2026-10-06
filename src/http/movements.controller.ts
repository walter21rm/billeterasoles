import { Body, Controller, Headers, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WalletApplication } from '../application/wallet.application';
import { ReverseDto } from './dto';
import { requireIdempotencyKey } from './idempotency';
import { AuthedRequest, JwtAuthGuard } from './jwt.guard';

@ApiTags('movements')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: true })
@UseGuards(JwtAuthGuard)
@Controller('v1/movements')
export class MovementsController {
  constructor(private readonly wallets: WalletApplication) {}

  @Post(':movementId/reverse')
  async reverse(
    @Param('movementId', ParseUUIDPipe) movementId: string,
    @Body() dto: ReverseDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wallets.reverse(movementId, {
      reason: dto.reason,
      idempotencyKey: requireIdempotencyKey(key),
      body: dto,
      createdBy: request.user.createdBy,
    });
    response.status(result.status);
    return result.body;
  }
}
