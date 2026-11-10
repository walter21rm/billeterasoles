import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './infrastructure/config';
import { JsonLogger } from './infrastructure/json-logger';
import { PrismaService } from './infrastructure/prisma.service';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(JsonLogger));
  const webRoot = join(__dirname, '..', 'public');
  if (existsSync(webRoot)) {
    app.useStaticAssets(webRoot, { index: 'index.html' });
  }
  app.enableShutdownHooks();
  await app.get(PrismaService).$queryRaw`SELECT 1`;
  migrate();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Billetera en soles')
      .setDescription(
        'Billetera en PEN. El titular es id_usuario del servicio de usuarios. Los montos están en céntimos. Ver README.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  await app.listen(config.port);
}

function migrate(): void {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

void bootstrap();
