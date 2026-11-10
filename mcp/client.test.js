import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createClient } from './client.js';

const SECRET = 'dev-only-change-me';
const ISSUER = 'billetera-dev';

test('cobrar firma como retiros y manda la clave de idempotencia', async () => {
  const seen = [];
  const api = await listen((req, res) => {
    seen.push(read(req));
    res.writeHead(201, { 'Content-Type': 'application/json', 'X-Correlation-Id': 'corr-1' });
    res.end(JSON.stringify({ id: 'mov-1', direction: 'DEBIT', type: 'PAYMENT', amount: 1500 }));
  });
  try {
    const client = createClient({ baseUrl: api.url, secret: SECRET, issuer: ISSUER });
    const result = await client.cobrar({
      walletId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      amount: 1500,
      externalReference: 'RET-2026-0001',
      idempotencyKey: 'clave-1',
    });
    const request = await seen[0];
    const payload = jwt.verify(request.authorization.replace('Bearer ', ''), SECRET, { issuer: ISSUER });
    assert.equal(payload.sub, 'retiros');
    assert.equal(request.url, '/v1/wallets/3fa85f64-5717-4562-b3fc-2c963f66afa6/payments');
    assert.equal(request.idempotencyKey, 'clave-1');
    assert.deepEqual(request.body, { amount: 1500, externalReference: 'RET-2026-0001' });
    assert.equal(result.status, 201);
    assert.equal(result.body.type, 'PAYMENT');
  } finally {
    await api.close();
  }
});

test('recargar firma como depositos y buscar no escribe', async () => {
  const seen = [];
  const api = await listen((req, res) => {
    seen.push(read(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'wallet-1', balance: 0 }));
  });
  try {
    const client = createClient({ baseUrl: api.url, secret: SECRET, issuer: ISSUER });
    await client.recargar({ walletId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', amount: 500 });
    await client.buscarBilletera(15);
    const topUp = await seen[0];
    const lookup = await seen[1];
    assert.equal(jwt.verify(topUp.authorization.replace('Bearer ', ''), SECRET, { issuer: ISSUER }).sub, 'depositos');
    assert.equal(topUp.url, '/v1/wallets/3fa85f64-5717-4562-b3fc-2c963f66afa6/top-ups');
    assert.equal(lookup.url, '/v1/wallets?idUsuario=15');
    assert.equal(lookup.idempotencyKey, undefined);
  } finally {
    await api.close();
  }
});

test('el servidor MCP lista las herramientas y cobra contra la API', async () => {
  const seen = [];
  const api = await listen((req, res) => {
    seen.push(read(req));
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 422, detail: 'Saldo insuficiente' }));
  });
  const mcp = startMcp({ BILLETERA_URL: api.url, JWT_SECRET: SECRET, JWT_ISSUER: ISSUER });
  try {
    mcp.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    });
    const initialized = await mcp.next();
    assert.equal(initialized.id, 1);
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listed = await mcp.next();
    const names = listed.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['buscar_billetera', 'cobrar', 'movimientos', 'recargar', 'reversar', 'salud']);
    mcp.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'cobrar',
        arguments: {
          walletId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          amount: '1500',
          idempotencyKey: 'clave-mcp',
        },
      },
    });
    const called = await mcp.next();
    const body = JSON.parse(called.result.content[0].text);
    assert.equal(called.result.isError, true);
    assert.equal(body.status, 422);
    assert.equal(body.idempotencyKey, 'clave-mcp');
    const request = await seen[0];
    assert.equal(request.url, '/v1/wallets/3fa85f64-5717-4562-b3fc-2c963f66afa6/payments');
    assert.equal(jwt.verify(request.authorization.replace('Bearer ', ''), SECRET, { issuer: ISSUER }).sub, 'retiros');
  } finally {
    mcp.child.kill();
    await api.close();
  }
});

function listen(handler) {
  const server = createServer((req, res) => {
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function read(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({
        url: req.url,
        authorization: req.headers.authorization,
        idempotencyKey: req.headers['idempotency-key'],
        body: raw ? JSON.parse(raw) : undefined,
      });
    });
  });
}

function startMcp(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: import.meta.dirname,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const queue = [];
  const waiters = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) deliver(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
  });
  function deliver(message) {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  }
  return {
    child,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}
