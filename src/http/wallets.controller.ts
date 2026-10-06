import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WalletApplication } from '../application/wallet.application';
import { AmountDto, ListMovementsQueryDto, OpenWalletDto, OwnerQueryDto } from './dto';
import { requireIdempotencyKey } from './idempotency';
import { AuthedRequest, JwtAuthGuard } from './jwt.guard';

@ApiTags('wallets')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: false })
@UseGuards(JwtAuthGuard)
@Controller('v1/wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletApplication) {}

  @Post()
  open(
    @Body() dto: OpenWalletDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.wallets
      .open({
        ownerId: dto.ownerId,
        idempotencyKey: requireIdempotencyKey(key),
        body: dto,
        createdBy: request.user.createdBy,
      })
      .then((result) => {
        response.status(result.status);
        return result.body;
      });
  }

  @Get()
  @ApiOkResponse()
  byOwner(@Query() query: OwnerQueryDto) {
    return this.wallets.getByOwner(query.ownerId);
  }

  @Get(':walletId')
  byId(@Param('walletId', ParseUUIDPipe) walletId: string) {
    return this.wallets.getById(walletId);
  }

  @Post(':walletId/top-ups')
  topUp(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: AmountDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.send(response, () =>
      this.wallets.topUp(walletId, {
        amount: dto.amount,
        currency: dto.currency,
        externalReference: dto.externalReference,
        idempotencyKey: requireIdempotencyKey(key),
        body: dto,
        createdBy: request.user.createdBy,
      }),
    );
  }

  @Post(':walletId/payments')
  pay(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() dto: AmountDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.send(response, () =>
      this.wallets.pay(walletId, {
        amount: dto.amount,
        currency: dto.currency,
        externalReference: dto.externalReference,
        idempotencyKey: requireIdempotencyKey(key),
        body: dto,
        createdBy: request.user.createdBy,
      }),
    );
  }

  @Get(':walletId/movements')
  movements(@Param('walletId', ParseUUIDPipe) walletId: string, @Query() query: ListMovementsQueryDto) {
    return this.wallets.listMovements(walletId, query);
  }

  private async send<T>(
    response: Response,
    work: () => Promise<{ status: number; body: T }>,
  ): Promise<T> {
    const result = await work();
    response.status(result.status);
    return result.body;
  }
}
