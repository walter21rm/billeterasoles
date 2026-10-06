# Billetera en soles

Microservicio que abre una billetera por titular y mueve saldo solo en soles peruanos (PEN). El monto es un entero de céntimos: `1500` equivale a S/ 15.00. El saldo es la suma de movimientos y no baja de cero.

## Qué hace

- Abre una billetera por `ownerId`.
- Recarga, debita y transfiere entre dos billeteras.
- Reversa un movimiento completo con un asiento compensatorio.
- Consulta el saldo y el historial.

No guarda nombre, DNI ni teléfono. El titular lo representa el `ownerId` que envía el servicio que llama.

## Integración con otros microservicios

Los canales (caja, app, core) llaman a esta API. Esta billetera no hace llamadas salientes.

```text
Caja, app o core --REST + JWT--> billetera-api --> PostgreSQL
                                                      |
                                                      +--> tabla outbox
```

### Entrada síncrona

Cada `POST`, `GET` de negocio exige:

```http
Authorization: Bearer <JWT>
```

El JWT es HS256. Debe incluir el emisor `JWT_ISSUER` y el claim `sub`. Ese `sub` se guarda como `createdBy`.

`X-Correlation-Id` se devuelve en la respuesta. Si no viene, el servicio genera uno.

Los errores usan el formato RFC 7807 (`type`, `title`, `status`, `detail`, `instance`).

| Código | Cuándo |
| --- | --- |
| 400 | Cuerpo o encabezado inválido |
| 401 | Falta el token o no es válido |
| 404 | Billetera o movimiento inexistente |
| 409 | Idempotencia, titular que ya tiene billetera o referencia externa duplicada |
| 422 | Saldo insuficiente o reversa imposible |

Todo `POST` exige el encabezado `Idempotency-Key`. La misma clave con el mismo cuerpo devuelve el recurso original. La misma clave con otro cuerpo responde `409`.

### Salida asíncrona

Cada operación confirmada inserta un evento en la tabla `outbox`, en la misma transacción que el movimiento. `published_at` queda vacío: en esta versión no hay broker. Un publicador futuro puede leer las filas pendientes, enviarlas y marcar `published_at`.

| Evento | Cuándo |
| --- | --- |
| `wallet.opened` | Se abre la billetera |
| `wallet.credited` | Recarga |
| `wallet.debited` | Pago |
| `wallet.transferred` | Transferencia. Incluye `sourceWalletId`, `targetWalletId` y `transferId` |
| `wallet.movement_reversed` | Reversa |

El payload lleva `eventId`, `type`, `occurredAt`, `walletId`, `amount` y `currency` (`PEN`). Cuando hay movimiento, también `movementId`.

## Arranque

Requiere Docker.

```powershell
copy .env.example .env
docker compose up --build
```

La API escucha en `http://localhost:3000`. OpenAPI y Swagger UI están en `http://localhost:3000/docs`. PostgreSQL queda en `localhost:5432` para pruebas locales. Dentro de Compose la API usa el host `postgres`.

Al arrancar, el proceso espera a PostgreSQL, aplica las migraciones y después escucha.

Variables obligatorias:

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP. En Compose es `3000` |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Secreto HS256 |
| `JWT_ISSUER` | Emisor exigido en el token |
| `LOG_LEVEL` | `error`, `warn`, `info` o `debug` |

Los valores de `.env.example` sirven para desarrollo. El secreto de ejemplo es `dev-only-change-me` y el emisor `billetera-dev`.

## Probar la API

Token de desarrollo:

```powershell
node -e "console.log(require('jsonwebtoken').sign({sub:'canal-caja'}, 'dev-only-change-me', {algorithm:'HS256', issuer:'billetera-dev'}))"
```

Abrir una billetera (`OWNER` es un UUID):

```powershell
curl -X POST http://localhost:3000/v1/wallets ^
  -H "Authorization: Bearer TOKEN" ^
  -H "Idempotency-Key: abrir-1" ^
  -H "Content-Type: application/json" ^
  -d "{\"ownerId\":\"OWNER\"}"
```

Recargar S/ 15.00:

```powershell
curl -X POST http://localhost:3000/v1/wallets/WALLET_ID/top-ups ^
  -H "Authorization: Bearer TOKEN" ^
  -H "Idempotency-Key: recarga-1" ^
  -H "Content-Type: application/json" ^
  -d "{\"amount\":1500}"
```

## Endpoints

| Método | Ruta | Efecto |
| --- | --- | --- |
| `POST` | `/v1/wallets` | Abre la billetera. Cuerpo: `{ "ownerId" }` |
| `GET` | `/v1/wallets?ownerId=` | Billetera y saldo del titular |
| `GET` | `/v1/wallets/{walletId}` | Billetera y saldo |
| `POST` | `/v1/wallets/{walletId}/top-ups` | Recarga |
| `POST` | `/v1/wallets/{walletId}/payments` | Débito |
| `POST` | `/v1/transfers` | Transferencia interna |
| `GET` | `/v1/wallets/{walletId}/movements` | Historial. `limit` por defecto 20, máximo 100 |
| `POST` | `/v1/movements/{movementId}/reverse` | Reversa total. Cuerpo: `{ "reason" }` |
| `GET` | `/health` | El proceso está arriba |
| `GET` | `/health/ready` | PostgreSQL responde |

Recarga, débito y transferencia aceptan `amount` en céntimos. `currency`, si viene, debe ser `PEN`. `externalReference` es opcional y única por billetera.

Transferencia:

```json
{
  "sourceWalletId": "uuid",
  "targetWalletId": "uuid",
  "amount": 1500
}
```

## Desarrollo sin Docker para la API

Con Postgres de Compose ya levantado:

```powershell
npm install
npx prisma migrate deploy
npm test
npm run test:e2e
npm run start:dev
```

`npm test` cubre el dinero y el saldo no negativo. `npm run test:e2e` usa la base de `.env` y cubre apertura idempotente, recarga, débito sin fondos, transferencia atómica, reversa única y saldo igual a la suma de movimientos.

## Fuera de esta versión

Identidad y KYC, Yape, Plin, retiros, comisiones, otras monedas, bloqueo de billetera, interfaz, publicación del outbox a un broker y despliegue en la nube.
