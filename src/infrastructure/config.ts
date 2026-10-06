import { Global, Module } from '@nestjs/common';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  logLevel: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const REQUIRED = ['PORT', 'DATABASE_URL', 'JWT_SECRET', 'JWT_ISSUER', 'LOG_LEVEL'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  for (const key of REQUIRED) {
    if (!env[key] || env[key]?.trim() === '') {
      throw new Error(`Falta la variable de entorno ${key}`);
    }
  }
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT inválido');
  }
  return {
    port,
    databaseUrl: env.DATABASE_URL as string,
    jwtSecret: env.JWT_SECRET as string,
    jwtIssuer: env.JWT_ISSUER as string,
    logLevel: env.LOG_LEVEL as string,
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
