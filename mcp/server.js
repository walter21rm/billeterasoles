import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from './client.js';

const client = createClient();
const server = new McpServer({
  name: 'billetera-soles',
  version: '1.0.0',
});

const walletId = z.string().uuid();
const amount = z.coerce.number().int().min(1).max(2147483647);
const reference = z.string().max(128).optional();
const idempotencyKey = z.string().min(1).max(200).optional();
const actor = z.enum(['retiros', 'depositos', 'caja']);

server.registerTool(
  'salud',
  {
    title: 'Salud',
    description: 'Comprueba si la billetera en soles esta viva y si PostgreSQL responde. No mueve dinero.',
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => reply(await client.salud()),
);

server.registerTool(
  'buscar_billetera',
  {
    title: 'Buscar billetera',
    description:
      'Devuelve la billetera PEN de un idUsuario y su saldo en centimos. 1500 = S/ 15.00. No descuenta. El id de la respuesta es el walletId que usan cobrar, recargar y movimientos.',
    inputSchema: {
      idUsuario: z.coerce.number().int().min(1).describe('Entero usuario.id_usuario'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ idUsuario }) => reply(await client.buscarBilletera(idUsuario)),
);

server.registerTool(
  'cobrar',
  {
    title: 'Cobrar',
    description:
      'Descuenta soles. La usa el microservicio de retiros. amount va en centimos. Si el saldo no alcanza, la API responde 422 y no crea movimiento. La misma idempotencyKey con el mismo cuerpo no descuenta dos veces.',
    inputSchema: {
      walletId: walletId.describe('UUID devuelto por buscar_billetera'),
      amount: amount.describe('Centimos. 1500 = S/ 15.00'),
      externalReference: reference.describe('Id del retiro en tu servicio. Unico por billetera'),
      idempotencyKey,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async (input) => reply(await client.cobrar(input)),
);

server.registerTool(
  'recargar',
  {
    title: 'Recargar',
    description:
      'Suma soles. La usa el microservicio de depositos. amount va en centimos. La misma idempotencyKey con el mismo cuerpo no acredita dos veces.',
    inputSchema: {
      walletId,
      amount: amount.describe('Centimos. 1500 = S/ 15.00'),
      externalReference: reference.describe('Id del deposito en tu servicio. Unico por billetera'),
      idempotencyKey,
    },
    annotations: { idempotentHint: true, openWorldHint: true },
  },
  async (input) => reply(await client.recargar(input)),
);

server.registerTool(
  'reversar',
  {
    title: 'Reversar',
    description:
      'Devuelve el monto completo de un movimiento. No borra el movimiento original. Un movimiento solo se reversa una vez.',
    inputSchema: {
      movementId: z.string().uuid().describe('id del movimiento devuelto por cobrar o recargar'),
      reason: z.string().min(1).max(500),
      actor: actor.optional().describe('Quien reversa. Por defecto retiros'),
      idempotencyKey,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async (input) => reply(await client.reversar(input)),
);

server.registerTool(
  'movimientos',
  {
    title: 'Movimientos',
    description: 'Lista los movimientos de una billetera, del mas reciente al mas antiguo.',
    inputSchema: {
      walletId,
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => reply(await client.movimientos(input)),
);

function reply(result) {
  const failed = isFailed(result);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: failed,
  };
}

function isFailed(result) {
  if (result.live || result.ready) {
    return isFailed(result.live) || isFailed(result.ready);
  }
  return result.status === 0 || result.status >= 400;
}

const transport = new StdioServerTransport();
await server.connect(transport);
