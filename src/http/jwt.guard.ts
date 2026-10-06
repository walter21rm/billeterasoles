import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { verify } from 'jsonwebtoken';
import { UnauthorizedError } from '../domain/errors';
import { APP_CONFIG, AppConfig } from '../infrastructure/config';

export interface AuthedRequest extends Request {
  user: { createdBy: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    request.user = this.verify(request.header('authorization'));
    return true;
  }

  private verify(header?: string): { createdBy: string } {
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Falta el token de servicio');
    }
    try {
      const payload = verify(header.slice('Bearer '.length), this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
        throw new UnauthorizedError('El token no identifica al cliente');
      }
      return { createdBy: payload.sub };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      throw new UnauthorizedError('Token inválido');
    }
  }
}
