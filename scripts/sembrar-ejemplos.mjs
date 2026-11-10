import jwt from "jsonwebtoken";

const baseUrl = (process.argv[2] || "http://127.0.0.1:30080").replace(/\/$/, "");
const secret = process.env.JWT_SECRET || "dev-only-change-me";
const issuer = process.env.JWT_ISSUER || "billetera-dev";
const token = jwt.sign({ sub: "retiros" }, secret, { algorithm: "HS256", issuer });

const cuentas = [
  { idUsuario: 15, amount: 25000, nombre: "Ana Prueba" },
  { idUsuario: 16, amount: 1500, nombre: "Luis Prueba" },
  { idUsuario: 18, amount: 500000, nombre: "Caja Prueba" },
];

const resultados = [];
for (const cuenta of cuentas) {
  const wallet = await abrir(cuenta.idUsuario);
  if (!wallet.body?.id) {
    throw new Error(`No se pudo abrir ${cuenta.idUsuario}: ${wallet.status} ${JSON.stringify(wallet.body)}`);
  }
  const movimiento = await recargar(wallet.body.id, cuenta);
  const saldo = await consultar(cuenta.idUsuario);
  resultados.push({
    nombre: cuenta.nombre,
    idUsuario: cuenta.idUsuario,
    estado: true,
    walletId: saldo.id,
    balance: saldo.balance,
    movementId: movimiento.id,
  });
}

const inactivo = await abrir(17);
resultados.push({
  nombre: "Inactivo Prueba",
  idUsuario: 17,
  estado: false,
  apertura: inactivo.status,
  detalle: inactivo.body.detail,
});

console.log(JSON.stringify({ baseUrl, resultados }, null, 2));

async function abrir(idUsuario) {
  return call("POST", "/v1/wallets", `abrir-ejemplo-${idUsuario}`, { idUsuario });
}

async function recargar(walletId, cuenta) {
  const result = await call("POST", `/v1/wallets/${walletId}/top-ups`, `recarga-ejemplo-${cuenta.idUsuario}`, {
    amount: cuenta.amount,
    externalReference: `EJEMPLO-${cuenta.idUsuario}`,
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`No se pudo recargar ${cuenta.idUsuario}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function consultar(idUsuario) {
  const result = await call("GET", `/v1/wallets?idUsuario=${idUsuario}`);
  if (result.status !== 200) {
    throw new Error(`No se pudo consultar ${idUsuario}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function call(method, path, key, body) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = key;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (method === "POST" && path === "/v1/wallets" && response.status !== 201 && response.status !== 200 && response.status !== 422) {
    throw new Error(`No se pudo abrir ${path}: ${response.status} ${text}`);
  }
  return { status: response.status, body: parsed };
}
