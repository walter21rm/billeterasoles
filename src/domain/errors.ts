export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly title: string;
}

export class InvalidRequestError extends DomainError {
  readonly status = 400;
  readonly title = 'Solicitud inválida';
}

export class UnauthorizedError extends DomainError {
  readonly status = 401;
  readonly title = 'No autorizado';
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly title = 'No encontrado';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly title = 'Conflicto';
}

export class UnprocessableError extends DomainError {
  readonly status = 422;
  readonly title = 'Regla de negocio';
}

export class IdempotencyRaceError extends Error {
  constructor() {
    super('La clave de idempotencia se está resolviendo');
  }
}
