import { Module } from '@nestjs/common';
import { HealthController } from '../http/health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
