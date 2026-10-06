import { Body, Controller, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WalletApplication } from '../application/wallet.application';
import { TransferDto } from './dto';
import { requireIdempotencyKey } from './idempotency';
import { AuthedRequest, JwtAuthGuard } from './jwt.guard';

@ApiTags('transfers')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: true })
@UseGuards(JwtAuthGuard)
@Controller('v1/transfers')
export class TransfersController {
  constructor(private readonly wallets: WalletApplication) {}

  @Post()
  async create(
    @Body() dto: TransferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wallets.transfer({
      sourceWalletId: dto.sourceWalletId,
      targetWalletId: dto.targetWalletId,
      amount: dto.amount,
      currency: dto.currency,
      externalReference: dto.externalReference,
      idempotencyKey: requireIdempotencyKey(key),
      body: dto,
      createdBy: request.user.createdBy,
    });
    response.status(result.status);
    return result.body;
  }
}
