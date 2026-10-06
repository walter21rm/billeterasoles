import { AsyncLocalStorage } from 'async_hooks';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from './config';

export const correlation = new AsyncLocalStorage<{ correlationId: string }>();

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

@Injectable()
export class JsonLogger implements LoggerService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  access(entry: { method: string; path: string; status: number }): void {
    this.write('info', entry);
  }

  private write(level: (typeof LEVELS)[number], message: unknown, context?: string, trace?: string): void {
    if (!this.enabled(level)) {
      return;
    }
    const line: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      message,
      correlationId: correlation.getStore()?.correlationId,
    };
    if (context) {
      line.context = context;
    }
    if (trace) {
      line.trace = trace;
    }
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  private enabled(level: (typeof LEVELS)[number]): boolean {
    const configured = LEVELS.indexOf(this.config.logLevel as (typeof LEVELS)[number]);
    const current = LEVELS.indexOf(level);
    if (configured < 0) {
      return level !== 'debug';
    }
    return current <= configured;
  }
}
