import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationError as ClassValidationError } from 'class-validator';
import { InvalidRequestError } from './domain/errors';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './http/correlation.middleware';
import { ProblemFilter } from './http/problem.filter';
import { IdentityModule } from './identity/identity.module';
import { AppConfigModule } from './infrastructure/config';
import { JsonLogger } from './infrastructure/json-logger';
import { PrismaModule } from './infrastructure/prisma.service';
import { MovementsModule } from './movements/movements.module';
import { OutboxModule } from './outbox/outbox.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [AppConfigModule, PrismaModule, IdentityModule, OutboxModule, WalletsModule, MovementsModule, HealthModule],
  providers: [
    JsonLogger,
    CorrelationMiddleware,
    { provide: APP_FILTER, useClass: ProblemFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ClassValidationError[]) => new InvalidRequestError(flatten(errors)),
      }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

function flatten(errors: ClassValidationError[]): string {
  return errors
    .flatMap((error) =>
      error.constraints ? Object.values(error.constraints) : flatten(error.children ?? []),
    )
    .join('; ');
}
