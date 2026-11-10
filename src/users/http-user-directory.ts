import { createHmac } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, UnavailableError, UnprocessableError } from '../domain/errors';
import { APP_CONFIG, AppConfig } from '../infrastructure/config';
import { UserDirectory } from './user-directory';

@Injectable()
export class HttpUserDirectory extends UserDirectory {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async requireActive(userId: number): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.config.usersServiceUrl}/usuarios/${userId}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.serviceToken()}`,
        },
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      throw new UnavailableError('El servicio de usuarios no responde');
    }

    if (response.status === 404) {
      throw new NotFoundError('El usuario no existe');
    }
    if (!response.ok) {
      throw new UnavailableError('El servicio de usuarios no responde');
    }

    const body = (await response.json()) as { idUsuario?: number; id_usuario?: number; estado?: boolean };
    const id = body.idUsuario ?? body.id_usuario;
    if (id !== userId) {
      throw new NotFoundError('El usuario no existe');
    }
    if (body.estado !== true) {
      throw new UnprocessableError('El usuario no está activo');
    }
  }

  private serviceToken(): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'billetera-service',
        iss: this.config.jwtIssuer,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.config.jwtSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }
}
