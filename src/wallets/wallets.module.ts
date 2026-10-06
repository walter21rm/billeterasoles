import { Module } from '@nestjs/common';
import { WalletApplication } from '../application/wallet.application';
import { WalletStore } from '../application/store';
import { TransfersController } from '../http/transfers.controller';
import { WalletsController } from '../http/wallets.controller';
import { IdentityModule } from '../identity/identity.module';
import { PrismaWalletStore } from '../infrastructure/prisma-wallet-store';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [IdentityModule, OutboxModule],
  controllers: [WalletsController, TransfersController],
  providers: [WalletApplication, { provide: WalletStore, useClass: PrismaWalletStore }],
  exports: [WalletApplication],
})
export class WalletsModule {}
