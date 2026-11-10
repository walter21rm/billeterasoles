# Contrato para integrar la billetera en soles

Servicio publicado en AWS, región `sa-east-1`, instancia `i-062bb5d86277453ae` (`t3.small`) con k3s.

| Dato | Valor |
| --- | --- |
| Interfaz | `http://52.67.162.209` |
| También | `https://52.67.162.209` y `http://52.67.162.209:30080` |
| Base de la API | `http://52.67.162.209` |
| Salud | `GET /health` |
| Listo | `GET /health/ready` |
| Documentación | `http://52.67.162.209/docs` |
| Clúster | k3s en la EC2, namespace `billetera` |
| Moneda | `PEN`. Los montos van en céntimos: `1500` = S/ 15.00 |
| Emisor JWT | `billetera-dev` |
| Secreto JWT | `dev-only-change-me` |
| Algoritmo | HS256 |

El secreto es el de desarrollo. No abre la base de datos. PostgreSQL solo existe dentro del clúster de esa instancia.

## Pase

Todo `GET` y `POST` de negocio lleva:

```http
Authorization: Bearer <jwt>
Idempotency-Key: <unico-por-operacion>
Content-Type: application/json
```

El JWT incluye `iss` = `billetera-dev` y `sub` = nombre del servicio que llama (`depositos`, `retiros`, `caja`). `sub` queda guardado como autor de la operación. `Idempotency-Key` es obligatorio en cada `POST`. La misma clave y el mismo cuerpo devuelven el mismo resultado. Otra clave u otro cuerpo con la misma clave responde `409`.

Ejemplo para firmar el pase, con el secreto de arriba:

```powershell
node -e "console.log(require('jsonwebtoken').sign({sub:'depositos'}, 'dev-only-change-me', {algorithm:'HS256', issuer:'billetera-dev'}))"
```

## Qué llama cada equipo

La billetera en dólares no entra aquí. Un monto en dólares se rechaza: esta API solo acepta soles.

**Depósitos en soles.** Cuando el depósito queda confirmado, suman el saldo. Entran con el mismo JWT, con `sub` = `depositos`. El detalle, los usuarios de prueba y el comando para firmar el token están en [PARA-DEPOSITOS-SOLES.md](PARA-DEPOSITOS-SOLES.md).

```http
POST /v1/wallets/{walletId}/top-ups
Authorization: Bearer <jwt>
Idempotency-Key: <id-del-deposito>
{ "amount": 1500, "externalReference": "<id-del-deposito>" }
```

Si el usuario todavía no tiene billetera:

```http
POST /v1/wallets
{ "idUsuario": 15 }
```

`idUsuario` es el entero `usuario.id_usuario`. Esta billetera pregunta `GET /usuarios/15` al servicio de usuarios. Si no existe, responde `404`. Si `estado` no es `true`, responde `422` y no suma.

**Retiros en soles.** Descuentan el saldo. Si no alcanza, `422` y no hay movimiento:

```http
POST /v1/wallets/{walletId}/payments
{ "amount": 1500, "externalReference": "RET-2026-0001" }
```

**Consulta.** Para saber el saldo antes de un retiro:

```http
GET /v1/wallets?idUsuario=15
```

```json
{
  "id": "uuid-de-la-billetera",
  "idUsuario": 15,
  "currency": "PEN",
  "balance": 1500,
  "createdAt": "2026-10-09T20:00:00.000Z"
}
```

## Servicio de usuarios

Esta billetera llama a la dirección `USERS_SERVICE_URL`. En la EC2 sigue el valor de desarrollo `http://host.docker.internal:3001`. Cuando el servicio de usuarios esté desplegado, se cambia esa variable y se reinicia el pod.

```http
GET /usuarios/{idUsuario}
Authorization: Bearer <jwt de billetera-service>
```

Respuesta mínima:

```json
{ "idUsuario": 15, "estado": true, "idRol": 1 }
```

Ese pase lo firma esta API: `sub` = `billetera-service`, mismo secreto y mismo emisor, un minuto de vida. El servicio de usuarios debe aceptar ese JWT.

## Errores

Cuerpo RFC 7807: `type`, `title`, `status`, `detail`, `instance`.

| Código | Cuándo |
| --- | --- |
| 400 | Cuerpo o encabezado inválido |
| 401 | Falta el JWT o no coincide emisor o secreto |
| 404 | No hay billetera, movimiento o usuario |
| 409 | Repetir la clave con otro cuerpo, o el usuario ya tiene billetera |
| 422 | Saldo insuficiente, usuario inactivo o reversa imposible |
| 503 | El servicio de usuarios no respondió |
