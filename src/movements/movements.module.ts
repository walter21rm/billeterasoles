import { Module } from '@nestjs/common';
import { MovementsController } from '../http/movements.controller';
import { IdentityModule } from '../identity/identity.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [IdentityModule, WalletsModule],
  controllers: [MovementsController],
})
export class MovementsModule {}
