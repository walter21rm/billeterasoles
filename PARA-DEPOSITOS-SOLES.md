# Billetera en soles — datos para el microservicio de depósitos

Depósitos suma el saldo. Esta billetera no llama al servicio de depósitos: cuando el depósito queda confirmado, depósitos llama a esta API.

## Dirección

| Dato | Valor |
| --- | --- |
| Base | `http://52.67.162.209` |
| Salud | `GET http://52.67.162.209/health` |
| Documentación | `http://52.67.162.209/docs` |
| OpenAPI | `openapi.yaml` |
| Región AWS | `sa-east-1` |
| Instancia | `i-062bb5d86277453ae` |
| Moneda | `PEN` |
| Montos | enteros en céntimos. `1500` = S/ 15.00 |

## Autenticación

La misma que usa retiros. En cada llamada:

```http
Authorization: Bearer <jwt>
Content-Type: application/json
```

| Dato | Valor |
| --- | --- |
| Algoritmo | HS256 |
| Emisor (`iss`) | `billetera-dev` |
| Secreto | `dev-only-change-me` |
| Sujeto (`sub`) | `depositos` |

`X-User-Id` no sirve en estas rutas. Sin el JWT, la API responde `401`.

```powershell
node -e "console.log(require('jsonwebtoken').sign({sub:'depositos'}, 'dev-only-change-me', {algorithm:'HS256', issuer:'billetera-dev'}))"
```

Todo `POST` lleva `Idempotency-Key`. La misma clave y el mismo cuerpo devuelven el movimiento original (`200`) y no acreditan otra vez. La misma clave con otro cuerpo responde `409`.

## Usuarios de prueba

| Nombre | idUsuario | Estado | Saldo actual | walletId |
| --- | --- | --- | --- | --- |
| Ana Prueba | 15 | activo | 25000 (S/ 250.00) | `b0414364-5b65-4881-89ad-6ecbf2e99bb4` |
| Luis Prueba | 16 | activo | 1500 (S/ 15.00) | `2c2171ab-0253-4d46-bfed-49b5a7ecbc79` |
| Inactivo Prueba | 17 | inactivo | sin billetera | — |
| Caja Prueba | 18 | activo | 500000 (S/ 5000.00) | `d3cd14be-bee7-4cce-9738-a6b4af9abf5a` |

Esas billeteras ya existen. No hay que abrirlas otra vez: un `POST /v1/wallets` con el mismo `idUsuario` responde `409`.

## Flujo

1. Buscar la billetera:

```http
GET /v1/wallets?idUsuario=15
Authorization: Bearer <jwt>
```

2. Acreditar el depósito. Si el monto en el servicio de depósitos es un decimal `"15.00"`, aquí se envía `1500`. La `Idempotency-Key` y `externalReference` son el id del depósito.

```http
POST /v1/wallets/b0414364-5b65-4881-89ad-6ecbf2e99bb4/top-ups
Authorization: Bearer <jwt>
Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7
Content-Type: application/json

{ "amount": 1500, "externalReference": "7c9e6679-7425-40de-944b-e07fc1f90ae7" }
```

Respuesta `201` (o `200` si se repite la misma clave):

```json
{
  "id": "uuid-del-movimiento",
  "walletId": "b0414364-5b65-4881-89ad-6ecbf2e99bb4",
  "amount": 1500,
  "currency": "PEN",
  "direction": "CREDIT",
  "type": "TOP_UP",
  "externalReference": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

Ese `id` es el que depósitos guarda si después necesita devolver el dinero.

3. La reversa solo se usa si el depósito se anula de verdad, no en una prueba automática:

```http
POST /v1/movements/{movementId}/reverse
Authorization: Bearer <jwt>
Idempotency-Key: <id-del-deposito>:reverse

{ "reason": "deposito anulado" }
```

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | Falta `Idempotency-Key` o el monto no es un entero de céntimos |
| 401 | Falta el JWT o no coincide emisor o secreto |
| 404 | No hay billetera para ese `idUsuario`, o el usuario no existe |
| 409 | La misma clave con otro cuerpo, la referencia ya existe, o el usuario ya tiene billetera |
| 422 | El usuario está inactivo |
| 503 | El servicio de usuarios no respondió. El saldo no cambió. Se reintenta con la misma clave |

El usuario 17 responde `422` y no se acredita nada.
