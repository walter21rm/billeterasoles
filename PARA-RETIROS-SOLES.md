# Billetera en soles — datos para el microservicio de retiros

Este archivo es lo que el equipo de retiros en soles necesita para descontar saldo. El retiro llama a esta billetera. Esta billetera no llama al retiro, así que no hace falta pasarnos la URL del retiro.

## Dirección

| Dato | Valor |
| --- | --- |
| Base | `http://52.67.162.209` |
| También | `https://52.67.162.209` y `http://52.67.162.209:30080` |
| Salud | `GET http://52.67.162.209/health` |
| Documentación | `http://52.67.162.209/docs` |
| Región AWS | `sa-east-1` |
| Instancia | `i-062bb5d86277453ae` |
| Moneda | `PEN` |
| Montos | enteros en céntimos. `1500` = S/ 15.00 |

`https://` usa el certificado por defecto del servidor. El navegador puede avisar. Para las llamadas de servicio usa `http://52.67.162.209`.

## Token

El microservicio de retiros entra con el mismo JWT que el resto de clientes de esta billetera. `X-User-Id` no sirve para estas rutas. Todas las rutas de negocio llevan:

```http
Authorization: Bearer <jwt>
Content-Type: application/json
```

| Dato | Valor |
| --- | --- |
| Algoritmo | HS256 |
| Emisor (`iss`) | `billetera-dev` |
| Secreto | `dev-only-change-me` |
| Sujeto (`sub`) | `retiros` |

El secreto es el de desarrollo. No abre la base de datos.

Comando para generar el token:

```powershell
node -e "console.log(require('jsonwebtoken').sign({sub:'retiros'}, 'dev-only-change-me', {algorithm:'HS256', issuer:'billetera-dev'}))"
```

Si no tienen el paquete: `npm install jsonwebtoken`.

`sub` queda guardado como autor del movimiento. Usen `retiros` y no otro nombre.

## Encabezado de cada POST

```http
Idempotency-Key: <unico-por-intento>
```

Una clave por operación de retiro, por ejemplo un UUID. Si la llamada se corta y la repiten con la misma clave y el mismo cuerpo, la billetera devuelve el movimiento ya creado (`200`) y no descuenta otra vez. La misma clave con otro cuerpo responde `409`.

## Flujo

1. Buscar la billetera del usuario.
2. Leer `balance`. Si es menor que el monto, no llamar al cobro.
3. Cobrar con `POST /payments`.
4. Si la respuesta es `201` o `200`, el saldo ya bajó. Guardar `id` del movimiento por si hay que reversarlo.

`idUsuario` es el entero `usuario.id_usuario` del microservicio de usuarios. El `id` de la billetera es un UUID distinto.

### 1. Buscar la billetera

```http
GET /v1/wallets?idUsuario=15
Authorization: Bearer <jwt>
```

Respuesta `200`:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "idUsuario": 15,
  "currency": "PEN",
  "balance": 1500,
  "createdAt": "2026-10-30T15:00:00.000Z"
}
```

`balance` está en céntimos. Si no existe billetera para ese usuario, responde `404`. Esta consulta no vuelve a llamar al servicio de usuarios.

### 2. Descontar el retiro

```http
POST /v1/wallets/3fa85f64-5717-4562-b3fc-2c963f66afa6/payments
Authorization: Bearer <jwt>
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "amount": 1500,
  "externalReference": "RET-2026-0001"
}
```

| Campo | Regla |
| --- | --- |
| `amount` | Entero, mínimo `1`, máximo `2147483647`. Céntimos. |
| `currency` | Opcional. Si se envía, tiene que ser `PEN`. |
| `externalReference` | Opcional, máximo 128 caracteres. Única por billetera. Sirve para cruzar con el id del retiro. |

Respuesta `201` (cobro nuevo) o `200` (la misma clave ya se procesó):

```json
{
  "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "walletId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "amount": 1500,
  "currency": "PEN",
  "direction": "DEBIT",
  "type": "PAYMENT",
  "counterpartyWalletId": null,
  "externalReference": "RET-2026-0001",
  "reversalOf": null,
  "createdAt": "2026-10-30T15:05:00.000Z"
}
```

Antes de descontar, la billetera vuelve a consultar al servicio de usuarios. El usuario tiene que existir y tener `estado: true`. Si no existe, `404`. Si está inactivo, `422` y el saldo no cambia. Si el saldo no alcanza, `422` y no se crea movimiento.

Ejemplo con curl:

```bash
curl -sS -X POST "http://52.67.162.209/v1/wallets/WALLET_ID/payments" \
  -H "Authorization: Bearer TOKEN" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":1500,\"externalReference\":\"RET-2026-0001\"}"
```

### 3. Reversar, solo si el retiro se cobró y hay que devolverlo

No borra el movimiento. Crea uno nuevo de signo contrario por el monto completo.

```http
POST /v1/movements/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/reverse
Authorization: Bearer <jwt>
Idempotency-Key: <otra-clave>
Content-Type: application/json

{ "reason": "retiro anulado" }
```

`reason` es obligatorio, de 1 a 500 caracteres. Un movimiento solo se reversa una vez.

## Errores

Cuerpo RFC 7807: `type`, `title`, `status`, `detail`, `instance`.

| Código | Cuándo |
| --- | --- |
| 400 | Falta `Idempotency-Key`, el monto no es entero, o el cuerpo no es válido |
| 401 | Falta el token, el emisor no es `billetera-dev` o el secreto no coincide |
| 404 | No hay billetera para ese usuario, o el usuario no existe en el servicio de usuarios |
| 409 | La misma `Idempotency-Key` con otro cuerpo, o `externalReference` repetida en esa billetera |
| 422 | Saldo insuficiente, usuario inactivo, o el movimiento ya fue reversado |
| 503 | El servicio de usuarios no respondió. El saldo no cambió. Se puede reintentar con la misma clave |

## Qué no hace esta API

No registra el retiro de negocio (banco, cajero, motivo, comisión). Eso vive en el microservicio de retiros. Aquí solo baja el saldo en soles cuando el retiro ya está confirmado de su lado.
