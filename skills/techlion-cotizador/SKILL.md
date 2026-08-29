---
name: techlion-cotizador
description: >
  Playbook del cotizador online de Techlion, tratado como canal de ventas y fidelización
  para la reparación de pantallas de celular en Chile (Coronel + Colina). Cubre el modelo de
  precios (costo × 2.5), la estructura del catálogo, el lenguaje de diseño patriota y el tracking
  de conversión.
  Trigger: Cuando se trabaje en el cotizador de Techlion, se mejore la conversión o fidelización,
  o se mantenga la coherencia de precios/UI de este proyecto.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Mantener o mejorar el cotizador online de Techlion (`build/` en `cotizador_online_pantallas`).
- Ajustar precios, tiers o el mensaje de conversión/fidelización.
- Agregar features sin romper el modelo de precios ni el lenguaje visual patriota.

## Critical Patterns

### Modelo de precios (NO inventar números sin el dueño)

- `precio_pantalla` en `data/pantallas.json` = **COSTO** del proveedor (tercero).
  La venta mostrada al cliente = `costo * (1 + margen/100)`. El margen es **EDITABLE** desde
  `/admin` (dueño): `CATALOGO.margen` es el margen global (default **150** => venta = costo × 2.5,
  o sea 150% de ganancia SOBRE el costo: costo 10k → venta 25k). Cada producto puede tener su propio
  `margen` que prevalece sobre el global. En `build/js/app.js` se calcula con `precioVentaDe(p)` /
  `margenDe(p)` (ya NO existe `FACTOR_MARGEN`).
- `precio_instalacion` está en `null` en todos los productos: la instalación/mano de obra YA está
  cubierta por el margen del 150%, por eso se muestra "Incluida" (no "a confirmar").
- Tiers de cliente: **mejor** = Original / Gama alta · **media** = OLED* · **baja** = Incell /
  Mixta / TFT / SL / CL. "con/sin marco" (`C/M`, `S/M`) solo sale en el `modelo` para Mixta/Gama alta.
- La opción "Mejor" es la **recomendada** y se selecciona por defecto.

### Estructura del catálogo

- `data/pantallas.json`: `{ glosario_calidad, margen, productos:[{id,marca,modelo,calidad,color,
  precio_pantalla,precio_instalacion,observaciones,margen?}] }` (~1158 productos). `margen` (top) =
  margen global; `margen` por producto es opcional.
- El catálogo se sirve por la API del backend, NO por `file://`. Siempre correr `node server.js`
  (raíz del proyecto) que sirve `build/` y expone `/api/productos`. El frontend hace
  `fetch("/api/productos")`.

### Backend y Admin (dueño edita precios)

- `server.js` (raíz, **Node sin dependencias**): sirve `build/` estáticos y la API.
  - `GET /api/productos` → catálogo JSON (público, lo usa el cotizador).
  - `POST /api/productos` → escribe el catálogo (body `{margen, productos:[{id,precio_pantalla,margen}]}`).
    **Requiere auth** (cookie `admin`); si no, devuelve 401.
  - `POST /api/login` → valida `ADMIN_PASS` (env var; default `techlion123`) con `timingSafeEqual` y
    setea cookie `HttpOnly`. `GET /api/whoami` → 200 solo si la cookie es válida (el admin lo usa para
    saber si ya está logueado; SIN esto el panel se mostraría desbloqueado para cualquiera). `GET /admin` →
    `build/admin.html` (UI de edición, exige login).
- `build/admin.html`: login + tabla por producto (costo, margen %, venta en vivo). Guarda vía POST.
  Recalcula la venta en el cliente con `costo * (1 + margen/100)`.
- Para editar precios: correr `node server.js`, abrir `/admin`, loguearse, cambiar costo/margen, Guardar.
  El cambio afecta a TODOS los visitantes (persiste en `pantallas.json`).
- **Deploy**: `render.yaml` + `package.json` listos. En Render: conectar repo, plan free.
  Env vars a setear (todas `sync: false`):
  - `ADMIN_PASS` — **obligatoria**, clave del dueño para `/admin` (NO dejar el default `techlion123`).
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — **para que los precios del dueño
    sobrevivan a reinicios/redeploys** (el disco de Render free es EFÍMERO). Crear DB gratis en
    Upstash y copiar URL + token. Sin estas vars, el catálogo solo vive en el archivo local y se
    pierde al redeployar. `PORT` lo inyecta Render.

### Lenguaje de diseño (identidad patriota Chile — NO el default crema+terracota de IA)

- Paleta: crema `#fbf6ec` + azul `#2563EB` + rojo Chile `#E4002B` + turquesa `#12b5c4`.
  Franja patriota arriba (`.flag-stripe`).
- **Firma** (un solo momento orquestado): shimmer de luz al revelar la cotización
  (`.resultado.just-quoted`). El CTA principal ya pulsa (`ctaPulse`).
- Microinteracciones: mascote del logo (`#mascota`) que camina/mira/corre; pista de scroll
  (`#scroll-hint`) a los 2s sin scroll. Ambas `pointer-events:none`, z-index < splash, off si
  `prefers-reduced-motion`.
- Animar siempre solo con `transform`/`opacity` (GPU).

### Conversión y fidelización (el corazón del "canal")

- Tracking en `localStorage` (`techlion_cotizador_v1`): contador de clicks diario en el CTA de
  WhatsApp (social proof `"💬 N cotizaciones enviadas hoy"`) + recuerdo de última cotización con
  banner "Reenviar".
- Copy de gancho: "¿Pantalla rota? **La reparamos** y te la dejamos como nueva" + cinta de 3 pasos
  (Cotizás → Reparamos → Te lo dejamos funcionando 🇨🇱).

## Code Examples

Ver archivos reales en el proyecto (references/):

- `build/js/app.js` — `MARGEN_POR_DEFECTO`, `margenDe(p)`, `precioVentaDe(p)`, `tierDeCalidad()`,
  `marcoDeModelo()`, `initMascota()`, `initScrollHint()`, `initTracking()`, `saveLastQuote()`.
- `build/css/style.css` — tokens en `:root`, `.resultado.just-quoted`, `.mascota`, `.scroll-hint`.
- `build/index.html` — estructura hero / cotizador / `#mascota` / `#scroll-hint`.

## Commands

```bash
# Servir localmente (OBLIGATORIO: el catálogo va por la API, no file://)
# Desde la raíz del proyecto (donde está server.js):
ADMIN_PASS=tu_clave node server.js
# abrir http://localhost:8000  (cotizador) y http://localhost:8000/admin  (dueño)

# Deploy en Render (plan free): conectar repo, setear ADMIN_PASS en env vars.
# render.yaml ya declara build/start. El PORT lo inyecta Render.

# Verificar en navegador (Playwright con channel msedge)
cd C:/Users/vixo/Downloads/playwright-test && node verify_smoke.js
```

## Backlog de crecimiento (para que la IA siga mejorando el canal)

- Programa de fidelización: 2ª reparación con descuento; seguimiento por WhatsApp post-reparación.
- Re-engagement: recordatorio de revisión a los X días.
- Captura de leads (nombre/teléfono) antes del WhatsApp para seguimiento real.
- Reviews/referidos: pedir calificación tras la reparación.
- Expansión de catálogo: baterías, cámaras, flex (ya en `LISTA COMPLETA.xlsx`, 16 hojas).
- A/B del gancho y del orden de tiers.

## Resources

- **Catálogo**: `build/data/pantallas.json` (editado por el dueño vía `/admin`)
- **Backend**: `server.js` (API + estáticos), `build/admin.html` (UI dueño)
- **Deploy**: `render.yaml`, `package.json` (raíz del proyecto)
- **Costos proveedor**: `LISTA COMPLETA.xlsx` (padre de `build`) — 16 hojas (PANTALLAS, BATERÍAS, etc.)
- **Verificación**: `C:/Users/vixo/Downloads/playwright-test/*.js`
