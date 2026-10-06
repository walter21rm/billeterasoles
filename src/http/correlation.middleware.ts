import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { correlation, JsonLogger } from '../infrastructure/json-logger';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly logger: JsonLogger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && incoming.trim() !== '' ? incoming : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    correlation.run({ correlationId }, () => {
      res.on('finish', () => {
        this.logger.access({
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
        });
      });
      next();
    });
  }
}
