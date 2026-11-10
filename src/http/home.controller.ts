import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sign } from 'jsonwebtoken';
import { APP_CONFIG, AppConfig } from '../infrastructure/config';

@ApiTags('web')
@Controller()
export class HomeController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('session')
  session(): { token: string } {
    return {
      token: sign({ sub: 'canal-web' }, this.config.jwtSecret, {
        algorithm: 'HS256',
        issuer: this.config.jwtIssuer,
        expiresIn: '1h',
      }),
    };
  }
}
