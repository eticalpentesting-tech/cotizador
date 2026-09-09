// Servidor del cotizador Techlion: sirve el sitio estático Y un /admin protegido
// para que el dueño edite costos y margen % de las pantallas. Sin dependencias externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Carga .env local (solo dev). En producción Render inyecta las env vars reales;
// NO commiteamos .env (está en .gitignore). Sin dependencias externas.
try {
  const envSrc = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envSrc.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
} catch (e) { /* sin .env local: ok */ }

const ROOT = path.join(__dirname, 'build');
const DATA = path.join(ROOT, 'data', 'pantallas.json');
const ADMIN_PASS = process.env.ADMIN_PASS || 'techlion123';
const PORT = process.env.PORT || 8000;
// Seguridad: en Render (producción) NUNCA arrancamos con la contraseña por defecto.
// Si no seteás ADMIN_PASS en Environment, el server se niega a iniciar.
const IS_RENDER = !!process.env.RENDER;
if (IS_RENDER && !process.env.ADMIN_PASS) {
  console.error('Falta ADMIN_PASS. En Render: Environment > Environment Variables, seteá ADMIN_PASS y redeployá.');
  process.exit(1);
}
// Persistencia externa: Render free tiene disco EFÍMERO, así que los cambios del dueño
// en /admin se pierden al reiniciar/redeployar. Si seteás estas env vars, el catálogo se
// espeja en Upstash Redis (free tier) y sobrevive. Sin ellas, usa solo el archivo local (dev).
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = 'techlion:catalog';

const sessions = new Set();
let CATALOG = null; // catálogo en memoria (fuente para GET)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  if (Buffer.isBuffer(body)) return res.end(body); // archivos estáticos y catálogo crudo
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (h) h.split(';').forEach((c) => { const [k, v] = c.trim().split('='); out[k] = v; });
  return out;
}
function isAuthed(req) {
  const c = parseCookies(req);
  return !!(c.admin && sessions.has(c.admin));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 20 * 1024 * 1024) reject(new Error('too big')); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
function safeJoin(urlPath) {
  const p = path.normalize(path.join(ROOT, urlPath));
  if (!p.startsWith(ROOT)) return null;
  return p;
}

// ---- Persistencia del catálogo (archivo local + Redis opcional) ----
async function redisGet() {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${REDIS_KEY}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const j = await r.json();
    if (j.result == null) return null;
    return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
  } catch (e) { console.error('redisGet falló:', e.message); return null; }
}
async function redisSet(catalog) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  try {
    const r = await fetch(`${REDIS_URL}/set/${REDIS_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(catalog),
    });
    return r.ok;
  } catch (e) { console.error('redisSet falló:', e.message); return false; }
}
async function loadCatalog() {
  // En producción con Redis: el catálogo vivo está ahí (sobrevive redeploys).
  const fromRedis = (REDIS_URL && REDIS_TOKEN) ? await redisGet() : null;
  if (fromRedis && Array.isArray(fromRedis.productos)) {
    CATALOG = fromRedis;
    console.log('Catálogo cargado desde Redis.');
  } else {
    // Fallback: archivo local (dev, o primera vez en producción).
    CATALOG = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
    if (REDIS_URL && REDIS_TOKEN) await redisSet(CATALOG); // sembramos Redis
    console.log('Catálogo cargado desde archivo local.');
  }
  // Si el catálogo vivo aún no tiene la comisión "solo pantalla" (catálogo viejo),
  // le ponemos el default y lo persistimos para que el público ya la use.
  if (!Number.isFinite(Number(CATALOG.comision_sola))) {
    CATALOG.comision_sola = 15000;
    await persistCatalog(CATALOG);
    console.log('Catálogo: comision_sola inicializada en 15000.');
  }
}
async function persistCatalog(catalog) {
  CATALOG = catalog;
  try { fs.writeFileSync(DATA, JSON.stringify(catalog, null, 2)); } catch (e) { /* disco efímero: ignorable */ }
  if (REDIS_URL && REDIS_TOKEN) {
    const ok = await redisSet(catalog);
    if (!ok) console.error('No se pudo persistir en Redis (los cambios no sobrevivirán al redeploy).');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // ---- API ----
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { pass } = await readBody(req);
      const a = Buffer.from(String(pass || ''));
      const b = Buffer.from(ADMIN_PASS);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const token = crypto.randomBytes(16).toString('hex');
        sessions.add(token);
        res.writeHead(200, { 'Set-Cookie': `admin=${token}; HttpOnly; Path=/; SameSite=Lax`, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        send(res, 401, { ok: false, error: 'contraseña incorrecta' });
      }
    } catch (e) { send(res, 400, { error: 'bad request' }); }
    return;
  }

  if (pathname === '/api/whoami' && req.method === 'GET') {
    const ok = isAuthed(req);
    return send(res, ok ? 200 : 401, { ok });
  }

  if (pathname === '/api/productos' && req.method === 'GET') {
    // Público: lo usa el cotizador. CATALOG queda en memoria tras loadCatalog().
    if (!CATALOG) { try { CATALOG = JSON.parse(fs.readFileSync(DATA, 'utf-8')); } catch (e) { return send(res, 500, { error: 'catalogo no encontrado' }); } }
    send(res, 200, CATALOG, 'application/json; charset=utf-8');
    return;
  }

  if (pathname === '/api/productos' && req.method === 'POST') {
    if (!isAuthed(req)) return send(res, 401, { error: 'no autenticado' });
    try {
      const body = await readBody(req);
      if (!body || !Array.isArray(body.productos)) return send(res, 400, { error: 'formato inválido' });
      if (!CATALOG) CATALOG = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
      const byId = new Map(CATALOG.productos.map((p) => [p.id, p]));
      for (const np of body.productos) {
        const p = byId.get(np.id);
        if (!p) continue;
        if (Number.isFinite(Number(np.precio_pantalla))) p.precio_pantalla = Number(np.precio_pantalla);
        if (np.margen != null && Number.isFinite(Number(np.margen))) p.margen = Number(np.margen);
      }
      if (Number.isFinite(Number(body.margen))) CATALOG.margen = Number(body.margen);
      if (Number.isFinite(Number(body.comision_sola))) CATALOG.comision_sola = Number(body.comision_sola);
      await persistCatalog(CATALOG);
      send(res, 200, { ok: true, margen: CATALOG.margen, comision_sola: CATALOG.comision_sola, total: CATALOG.productos.length, persisted: !!(REDIS_URL && REDIS_TOKEN) });
    } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    return;
  }

  if (pathname === '/admin' && req.method === 'GET') {
    const f = safeJoin('/admin.html');
    if (!f) return send(res, 403, 'forbidden');
    fs.readFile(f, (err, data) => {
      if (err) return send(res, 404, 'no encontrado');
      send(res, 200, data, 'text/html; charset=utf-8');
    });
    return;
  }

  // ---- Archivos estáticos ----
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const full = safeJoin(filePath);
  if (!full) return send(res, 403, 'forbidden');
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA-ish fallback al index para rutas desconocidas sin extensión
      if (!path.extname(pathname)) return serveIndex(res);
      return send(res, 404, 'no encontrado');
    }
    const ext = path.extname(full).toLowerCase();
    send(res, 200, data, TYPES[ext] || 'application/octet-stream');
  });
});

function serveIndex(res) {
  fs.readFile(path.join(ROOT, 'index.html'), (err, data) => {
    if (err) return send(res, 404, 'no encontrado');
    send(res, 200, data, 'text/html; charset=utf-8');
  });
}

loadCatalog().then(() => {
  server.listen(PORT, () => console.log(
    `Techlion server en http://localhost:${PORT} (admin: /admin)` +
    (REDIS_URL && REDIS_TOKEN ? ' [persistencia: Redis]' : ' [persistencia: archivo local]')
  ));
}).catch((e) => {
  console.error('No se pudo cargar el catálogo:', e);
  process.exit(1);
});
