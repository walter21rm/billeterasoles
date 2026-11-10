# Billetera en soles

Microservicio que abre una billetera por titular y mueve saldo solo en soles peruanos (PEN). El monto es un entero de céntimos: `1500` equivale a S/ 15.00. El saldo es la suma de movimientos y no baja de cero.

## Qué hace

- Abre una billetera para un `idUsuario` del microservicio de usuarios.
- Recarga, debita y transfiere entre dos billeteras.
- Reversa un movimiento completo con un asiento compensatorio.
- Consulta el saldo y el historial.

No guarda nombre, correo, contraseña ni rol. El titular es `usuario.id_usuario`, un entero. Esos datos viven en el otro servicio.

## Arquitectura

Tres procesos. La pantalla habla solo con la billetera. La billetera habla con PostgreSQL y, antes de mover dinero, con el servicio de usuarios.

```text
Pantalla --REST + JWT--> billetera-api --GET /usuarios/{idUsuario}--> servicio de usuarios
                              |
                              +--> PostgreSQL (billeteras, movimientos, outbox)
```

Por dentro, la API sigue en capas. HTTP recibe `idUsuario`. La aplicación pide al directorio de usuarios que esa persona exista y tenga `estado` verdadero. El dominio aplica el saldo. La infraestructura guarda el entero en `wallets.id_usuario` y llama por HTTP al otro servicio.

La billetera no copia la tabla `usuario` ni la tabla `rol`. No hay clave foránea entre las dos bases: cada servicio tiene su PostgreSQL. El vínculo es el número `id_usuario`.

Si el usuario no existe, la respuesta es `404`. Si `estado` es falso, `422` y no se mueve saldo. Si el servicio de usuarios no responde en dos segundos, `503`. Consultar una billetera ya abierta no exige esa llamada. Abrir, recargar, cobrar, transferir y reversar sí. En una transferencia se comprueban los dos titulares.

## Integración con el servicio de usuarios

Contrato que esta billetera espera. Los nombres salen del diagrama de `usuario` y `rol`.

```http
GET /usuarios/{idUsuario}
Authorization: Bearer <JWT HS256>
Accept: application/json
```

El JWT lo firma esta API con `JWT_SECRET` y `JWT_ISSUER`, claim `sub` = `billetera-service`, y dura un minuto. El servicio de usuarios debe aceptar ese mismo secreto y emisor.

Respuesta mínima:

```json
{ "idUsuario": 15, "estado": true, "idRol": 1 }
```

También acepta `id_usuario` en vez de `idUsuario`. El resto de columnas (nombre, apellido, email, `password_hash`, teléfono, dirección, biografía, fecha de nacimiento) puede venir en el JSON y se ignoran. No se escriben en esta base.

`USERS_SERVICE_URL` es obligatoria. En la máquina, `http://localhost:3001`. Dentro de Docker, `http://host.docker.internal:3001`, porque `localhost` ahí sería el propio contenedor.

Los canales siguen entrando a esta API con su propio JWT. `createdBy` es el `sub` de ese canal, no el usuario final.

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
| 404 | Billetera, movimiento o usuario inexistente |
| 409 | Idempotencia, usuario que ya tiene billetera o referencia externa duplicada |
| 422 | Saldo insuficiente, usuario inactivo o reversa imposible |
| 503 | El servicio de usuarios no responde |

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

El payload lleva `eventId`, `type`, `occurredAt`, `walletId`, `idUsuario`, `amount` y `currency` (`PEN`). Cuando hay movimiento, también `movementId`.

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
| `USERS_SERVICE_URL` | Base del servicio de usuarios, sin barra final |

Los valores de `.env.example` sirven para desarrollo. El secreto de ejemplo es `dev-only-change-me` y el emisor `billetera-dev`.

## Probar la API

Token de desarrollo:

```powershell
node -e "console.log(require('jsonwebtoken').sign({sub:'canal-caja'}, 'dev-only-change-me', {algorithm:'HS256', issuer:'billetera-dev'}))"
```

Abrir una billetera. `15` es `usuario.id_usuario` y ese usuario tiene que existir y estar activo:

```powershell
curl -X POST http://localhost:3000/v1/wallets ^
  -H "Authorization: Bearer TOKEN" ^
  -H "Idempotency-Key: abrir-1" ^
  -H "Content-Type: application/json" ^
  -d "{\"idUsuario\":15}"
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
| `POST` | `/v1/wallets` | Abre la billetera. Cuerpo: `{ "idUsuario": 15 }` |
| `GET` | `/v1/wallets?idUsuario=` | Billetera y saldo de ese usuario |
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

## Frontend

La interfaz está en `web/`. El scroll mueve una cámara por el toldo, el mostrador y la transferencia. Debajo está el escritorio, conectado a esta API.

Con la API en el puerto 3000:

```powershell
cd web
npm install
npm run dev
```

Abre `http://localhost:5173`. Vite firma un JWT de desarrollo y reenvía `/v1` a la API de Kubernetes en `http://127.0.0.1:30080`. El secreto no llega al navegador. La página se ve sin el servicio de usuarios. Ese servicio solo hace falta al abrir una billetera o mover saldo.

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

## Arranque rápido

Un solo comando levanta Docker si hace falta, reutiliza el clúster `billetera` y abre la pantalla. Si la API ya responde, no vuelve a construir la imagen.

```powershell
.\levantar.ps1
```

Para reconstruir la imagen después de un cambio de código: `.\levantar.ps1 -Rebuild`.

## AWS, la próxima vez

Esto crea costo mientras la instancia siga encendida. Un comando entra a AWS, reutiliza el repositorio ECR `billetera-api` y la instancia `billetera-soles` si todavía existen, y solo vuelve a subir la imagen cuando hace falta.

```powershell
aws login
.\desplegar-aws.ps1
```

Si cambiaste el código: `.\desplegar-aws.ps1 -Rebuild`. Si la dirección pública ya responde, el comando no crea otra instancia ni otra imagen. La región es `sa-east-1`.

La pantalla queda en `http://localhost:5173/` y la API en `http://127.0.0.1:30080/`.

## Para otros equipos

La dirección, el JWT y qué debe llamar depósitos, retiros y usuarios están en [CONTRATO.md](CONTRATO.md).

## Fuera de esta versión

Yape, Plin, comisiones, la billetera en dólares, el tipo de cambio, bloqueo de billetera, publicación del outbox a un broker y un servidor en internet. Depósitos y retiros son otros servicios: cuando estén desplegados, llaman a esta API.
