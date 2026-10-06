import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../http/jwt.guard';

@Module({
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class IdentityModule {}
