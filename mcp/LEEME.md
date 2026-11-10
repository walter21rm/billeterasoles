# MCP de la billetera en soles

Este proceso lo arranca Cursor. El agente llama las herramientas y el proceso pega a `http://52.67.162.209`. El microservicio de retiros, cuando corre en AWS, sigue usando la API HTTP. Esta MCP no reemplaza esa llamada.

Herramientas: `salud`, `buscar_billetera`, `cobrar`, `recargar`, `reversar`, `movimientos`.

`cobrar` firma el JWT con `sub` = `retiros`. `recargar` lo firma con `sub` = `depositos`. Los montos van en céntimos.

## En este repo

Ya está declarado en `.cursor/mcp.json`. En la carpeta `mcp` hace falta instalar una vez:

```powershell
npm install
```

Después, en Cursor, recarga las MCP. El agente de este proyecto ya puede pedir "consulta el saldo del usuario 15" o "cobra 1500 céntimos".

## En el repo del compañero

Copia la carpeta `mcp`, entra en ella y ejecuta `npm install`. En la configuración MCP de Cursor agrega:

```json
{
  "mcpServers": {
    "billetera-soles": {
      "command": "node",
      "args": ["C:\\ruta\\mcp\\server.js"],
      "env": {
        "BILLETERA_URL": "http://52.67.162.209",
        "JWT_SECRET": "dev-only-change-me",
        "JWT_ISSUER": "billetera-dev"
      }
    }
  }
}
```

`args` tiene que ser la ruta real de `server.js` en su máquina. Si no pone `env`, el servidor usa esos mismos valores de desarrollo.
