import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxEvent } from '../application/types';

@Injectable()
export class OutboxRepository {
  async append(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    await tx.outbox.create({
      data: {
        id: event.eventId,
        type: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
        occurredAt: new Date(event.occurredAt),
      },
    });
  }
}
