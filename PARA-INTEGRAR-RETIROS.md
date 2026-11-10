# Billetera en soles — lo que falta para integrar el retiro

Los endpoints ya están en el OpenAPI. Con este archivo se cierra lo que ese contrato no dice: cómo respondemos al servicio de usuarios, qué billetera de prueba hay hoy y cómo se debita y se reversa.

Base: `http://52.67.162.209`
OpenAPI: `openapi.yaml`
Documentación publicada: `http://52.67.162.209/docs`
Moneda: `PEN`. `amount` es un entero en céntimos. `1500` = S/ 15.00.

El microservicio de retiros usa la misma autenticación que esta billetera. En cada llamada a la API va:

```http
Authorization: Bearer <jwt>
```

HS256, emisor `billetera-dev`, secreto `dev-only-change-me`, `sub` = `retiros`. El encabezado `X-User-Id` no reemplaza ese token. Sin el JWT, la billetera responde `401`. Todo `POST` lleva además `Idempotency-Key`.

## Endpoints que usa retiros

| Acción | Llamada |
| --- | --- |
| Buscar la billetera y el saldo | `GET /v1/wallets?idUsuario=15` |
| Descontar el retiro | `POST /v1/wallets/{walletId}/payments` |
| Devolver el retiro completo | `POST /v1/movements/{movementId}/reverse` |
| Ver el historial | `GET /v1/wallets/{walletId}/movements` |

`idUsuario` es el entero `usuario.id_usuario`. No es un UUID y no va en una tabla de configuración. El `walletId` sale de la respuesta del `GET`. El `movementId` que deben guardar como `wallet_movement_id` es el `id` del movimiento que devuelve el cobro.

Según el acuerdo, un retiro de `"250.00"` se cobra así. La `Idempotency-Key` y `externalReference` son el UUID del retiro:

```http
POST /v1/wallets/{walletId}/payments
Authorization: Bearer <jwt>
Idempotency-Key: 14544b68-9c70-4365-bd40-6ba0824bba15
Content-Type: application/json

{ "amount": 25000, "externalReference": "14544b68-9c70-4365-bd40-6ba0824bba15" }
```

`25000` son S/ 250.00. `externalReference` es única por billetera. Si se repite, `409`. El reverso usa la clave `<withdrawal-id>:reverse`.

## 1. Contrato con el servicio de usuarios

Retiros no llama a usuarios para descontar. Lo llama esta billetera, antes de abrir, recargar, cobrar, transferir o reversar. Consultar una billetera que ya existe no llama a usuarios.

Llamada que hacemos:

```http
GET {USERS_SERVICE_URL}/usuarios/{idUsuario}
Authorization: Bearer <jwt>
Accept: application/json
```

El JWT lo firmamos nosotros, dura 60 segundos y lleva `sub` = `billetera-service`, emisor `billetera-dev` y el secreto `dev-only-change-me`.

`idUsuario` de la ruta es un entero. La respuesta mínima que aceptamos:

```json
{ "idUsuario": 15, "estado": true }
```

También aceptamos `id_usuario` en lugar de `idUsuario`. El id del cuerpo tiene que ser el mismo entero de la ruta. `estado` tiene que ser el booleano `true`. Cualquier otro valor cuenta como usuario inactivo.

| Respuesta de usuarios | Qué ve retiros |
| --- | --- |
| `200` y `estado: true` | Seguimos con el cobro o la reversa |
| `404`, o el id no coincide | `404` `El usuario no existe`. No hay movimiento |
| `200` y `estado` distinto de `true` | `422` `El usuario no está activo`. No hay movimiento |
| Timeout de 2 segundos, o cualquier otro estado | `503` `El servicio de usuarios no responde`. No hay movimiento. Se reintenta con la misma `Idempotency-Key` |

En la EC2, `USERS_SERVICE_URL` sigue en `http://host.docker.internal:3001`. Por eso hoy un cobro responde `503` hasta que el equipo de usuarios publique su URL y se cambie esa variable.

## 2. Usuarios de ejemplo

En la EC2 hay cuatro usuarios de ejemplo. No son el servicio real de usuarios: responden solo dentro del clúster para poder probar el cobro.

| Nombre | idUsuario | Estado | Saldo | walletId |
| --- | --- | --- | --- | --- |
| Ana Prueba | 15 | activo | 25000 (S/ 250.00) | `b0414364-5b65-4881-89ad-6ecbf2e99bb4` |
| Luis Prueba | 16 | activo | 1500 (S/ 15.00) | `2c2171ab-0253-4d46-bfed-49b5a7ecbc79` |
| Inactivo Prueba | 17 | inactivo | sin billetera | — |
| Caja Prueba | 18 | activo | 500000 (S/ 5000.00) | `d3cd14be-bee7-4cce-9738-a6b4af9abf5a` |

Ana alcanza para el retiro de `"250.00"`. Luis no alcanza para ese monto. El 17 hace fallar el cobro con `422` si se intenta abrir o mover su billetera. Caja alcanza el máximo de una operación de retiro.

Consulta:

```http
GET /v1/wallets?idUsuario=15
```

Cuando el servicio real de usuarios reemplace a estos ejemplos, la billetera se abre así:

```http
POST /v1/wallets
Idempotency-Key: abrir-usuario-15
{ "idUsuario": 15 }
```

El saldo inicial es `0`. Para dejar saldo hace falta una recarga, que también exige usuario activo:

```http
POST /v1/wallets/{walletId}/top-ups
Idempotency-Key: recarga-prueba-1
{ "amount": 25000, "externalReference": "DEP-PRUEBA-1" }
```

`25000` céntimos son S/ 250.00, el monto del criterio de aceptación del acuerdo. Una recarga de `1500` solo alcanza para S/ 15.00 y el cobro de `"250.00"` respondería `422`. Esa recarga la hace depósitos. Después, `GET /v1/wallets?idUsuario=15` devuelve `balance` y el `id` que retiros usa para cobrar.

## 3. Política de débito y reverso

El saldo es la suma de créditos menos la suma de débitos. Nunca queda negativo. No hay débito parcial ni reverso parcial: entra o sale el `amount` completo, o no se escribe nada.

### Débito

`POST /v1/wallets/{walletId}/payments` crea un solo movimiento:

- `direction`: `DEBIT`
- `type`: `PAYMENT`
- `amount`: el mismo entero enviado

Orden interno:

1. El monto tiene que ser un entero de céntimos entre `1` y `2147483647`. Si viene `currency`, tiene que ser `PEN`.
2. La billetera tiene que existir. Si no, `404`.
3. El usuario dueño tiene que existir y estar activo. Si no, `404`, `422` o `503`, y no se crea movimiento.
4. Se bloquea la fila de la billetera.
5. Si `balance < amount`, responde `422` `Saldo insuficiente` y no se crea movimiento.
6. Si alcanza, se inserta el débito y responde `201` con el movimiento.

La misma `Idempotency-Key` y el mismo cuerpo responden `200` con ese mismo movimiento y no descuentan otra vez. La misma clave con otro cuerpo responde `409`.

El `id` de esa respuesta es el `wallet_movement_id` que retiros debe guardar.

### Reverso

`POST /v1/movements/{movementId}/reverse` no borra el movimiento original. Crea otro, por el monto completo:

```json
{ "reason": "retiro anulado" }
```

`reason` es obligatorio, de 1 a 500 caracteres.

Para un cobro, el original es `DEBIT` y el reverso queda así:

- `direction`: `CREDIT`
- `type`: `REVERSAL`
- `amount`: el mismo del cobro
- `reversalOf`: el `id` del cobro

Ese reverso devuelve el dinero a la billetera. No falla por saldo insuficiente, porque está sumando. Falla en estos casos:

| Código | Cuándo |
| --- | --- |
| `404` | No existe ese movimiento, o el usuario ya no existe |
| `422` | El usuario está inactivo, o ese movimiento ya fue reversado |
| `409` | La misma `Idempotency-Key` se usó con otro cuerpo |
| `503` | Usuarios no respondió. No se escribió el reverso. Se reintenta con la misma clave |

Un movimiento se reversa una sola vez. La segunda llamada responde `422` `El movimiento ya fue reversado`.

Si el movimiento era una transferencia, se reversan las dos patas en la misma transacción. Si quien recibió el dinero ya no lo tiene, no se reversa ninguna de las dos.

### Qué hace retiros con eso

1. Usuarios le devuelve `id_usuario`. Con eso hace `GET /v1/wallets?idUsuario={idUsuario}`.
2. Si no hay billetera, `404` `Billetera no encontrada`. Si `balance` es menor que el monto en céntimos, no llama al cobro.
3. `POST /payments` con `Idempotency-Key` y `externalReference` iguales al UUID del retiro, y `amount` en céntimos.
4. Si responde `201` o `200`, guarda `id` como `wallet_movement_id`. El saldo ya bajó.
5. Si responde `422` `Saldo insuficiente` o `El usuario no está activo`, el saldo no cambió.
6. Si responde `503`, repite el mismo `POST` con la misma clave y el mismo cuerpo.
7. Un cobro confirmado se queda. No se llama a `/reverse` en una prueba ni justo después del `201`. La reversa solo ocurre cuando el retiro se anula de verdad, con la clave `<withdrawal-id>:reverse`. No existe un reverso por un monto menor. Si el reporte a transacciones falla y el retiro sigue válido, no se reversa.
