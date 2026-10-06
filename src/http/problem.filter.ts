import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../domain/errors';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const mapped = mapException(exception);
    response.status(mapped.status).json({
      type: 'about:blank',
      title: mapped.title,
      status: mapped.status,
      detail: mapped.detail,
      instance: request.originalUrl,
    });
  }
}

function mapException(exception: unknown): { status: number; title: string; detail: string } {
  if (exception instanceof DomainError) {
    return { status: exception.status, title: exception.title, detail: exception.message };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const detail = typeof body === 'string' ? body : messageOf(body);
    return { status, title: titleFor(status), detail };
  }
  return { status: 500, title: 'Error interno', detail: 'Error interno' };
}

function messageOf(body: object): string {
  const message = 'message' in body ? body.message : body;
  return Array.isArray(message) ? message.join('; ') : String(message);
}

function titleFor(status: number): string {
  if (status === 400) return 'Solicitud inválida';
  if (status === 401) return 'No autorizado';
  if (status === 404) return 'No encontrado';
  if (status === 409) return 'Conflicto';
  if (status === 422) return 'Regla de negocio';
  if (status === 503) return 'No disponible';
  return 'Error';
}
