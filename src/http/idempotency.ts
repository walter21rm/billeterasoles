import { InvalidRequestError } from '../domain/errors';

export function requireIdempotencyKey(key?: string): string {
  if (!key || key.trim() === '' || key.length > 200) {
    throw new InvalidRequestError('El encabezado Idempotency-Key es obligatorio');
  }
  return key.trim();
}
