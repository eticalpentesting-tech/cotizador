// ===== Configuración =====
// TODO: reemplazar por el número real en formato internacional sin '+' ni espacios (ej: 56912345678)
const WHATSAPP_NUMBER = "56929871024";
// Margen de venta: 150% de ganancia SOBRE el costo => venta = costo * (1 + 150/100) = costo * 2.5
// (ej: costo 10.000 -> venta 25.000). precio_pantalla del catálogo = costo proveedor.
// El margen ahora es EDITABLE desde /admin: viene en CATALOGO.margen (global) o por producto (p.margen).
const MARGEN_POR_DEFECTO = 150;
// Video del splash: dejalo en "" para usar la bandera (sin 404). Poné la ruta cuando tengas el video.
const SPLASH_VIDEO_SRC = "";

const money = (n) => n == null ? "Consultar disponibilidad" : "$" + Math.round(n).toLocaleString("es-CL");

// Tiers de venta al cliente (definido con el dueño):
//   mejor = original / gama alta | media = OLED | baja = Incell/Mixta/TFT/SL/CL (alternativa)
function tierDeCalidad(calidad) {
  const c = (calidad || "").toUpperCase();
  if (c.includes("ORIGINAL") || c.includes("GAMA ALTA")) return "mejor";
  if (c.includes("OLED")) return "media";
  return "baja";
}

// "con marco / sin marco" solo está escrito en el modelo (C/M, S/M) para Mixta/Gama alta.
function marcoDeModelo(modelo) {
  const m = (modelo || "").toUpperCase();
  if (/\bC\/M\b/.test(m)) return "con marco";
  if (/\bS\/M\b/.test(m)) return "sin marco";
  return null;
}

// Margen efectivo de un producto: el del producto (si existe), sino el global del catálogo, sino el default.
function margenDe(p) {
  if (p && Number.isFinite(Number(p.margen))) return Number(p.margen);
  if (CATALOGO && Number.isFinite(Number(CATALOGO.margen))) return Number(CATALOGO.margen);
  return MARGEN_POR_DEFECTO;
}
// Precio de venta al cliente = costo * (1 + margen/100)
function precioVentaDe(p) {
  if (!p || !Number.isFinite(Number(p.precio_pantalla))) return null;
  return Math.round(Number(p.precio_pantalla) * (1 + margenDe(p) / 100));
}

// ===== Estado =====
let CATALOGO = null; // { glosario_calidad, productos }
let productosPorMarca = new Map();
let stockPorModelo = new Map(); // marca|modelo -> stock de muestra (1..10, fijo por sesión)

const el = {
  marca: document.getElementById("marca"),
  modelo: document.getElementById("modelo"),
  calidadOptions: document.getElementById("calidad-options"),
  calidadNota: document.getElementById("calidad-nota"),
  resultado: document.getElementById("resultado"),
  precioPantalla: document.getElementById("precio-pantalla"),
  precioInstalacion: document.getElementById("precio-instalacion"),
  precioTotal: document.getElementById("precio-total"),
  precioHoy: document.getElementById("precio-hoy"),
  urgenciaStock: document.getElementById("urgencia-stock"),
  whatsappCta: document.getElementById("whatsapp-cta"),
  sinResultados: document.getElementById("sin-resultados"),
  ultimaCotizacion: document.getElementById("ultima-cotizacion"),
  socialProof: document.getElementById("social-proof"),
};

async function init() {
  try {
    const res = await fetch("/api/productos");
    if (!res.ok) throw new Error("HTTP " + res.status);
    CATALOGO = await res.json();
  } catch (err) {
    el.sinResultados.hidden = false;
    el.sinResultados.textContent = "No pudimos cargar el catálogo de pantallas. Asegurate de abrir el sitio por el servidor (node server.js -> http://localhost:8000) o la versión en línea.";
    console.error("Catálogo no cargó:", err);
    return;
  }

  for (const p of CATALOGO.productos) {
    if (!productosPorMarca.has(p.marca)) productosPorMarca.set(p.marca, []);
    productosPorMarca.get(p.marca).push(p);
  }

  // Stock de muestra: aleatorio 1..10, asignado UNA vez por modelo y fijo durante la sesión.
  // Reemplazar por stock real cuando el dashboard alimente el catálogo.
  for (const [marca, prods] of productosPorMarca) {
    for (const modelo of new Set(prods.map((p) => p.modelo))) {
      stockPorModelo.set(marca + "|" + modelo, 1 + Math.floor(Math.random() * 10));
    }
  }

  const marcas = [...productosPorMarca.keys()].sort((a, b) => a.localeCompare(b, "es"));
  for (const marca of marcas) {
    const opt = document.createElement("option");
    opt.value = marca;
    opt.textContent = marca;
    el.marca.appendChild(opt);
  }

  el.marca.addEventListener("change", onMarcaChange);
  el.modelo.addEventListener("change", onModeloChange);

  initTracking();
}

function resetFrom() {
  el.calidadOptions.innerHTML = "";
  el.calidadNota.hidden = true;
  el.resultado.hidden = true;
  el.sinResultados.hidden = true;
}

function onMarcaChange() {
  resetFrom();
  el.modelo.innerHTML = '<option value="">Tu modelo…</option>';
  const marca = el.marca.value;
  if (!marca) return;

  const modelos = [...new Set(productosPorMarca.get(marca).map((p) => p.modelo))]
    .sort((a, b) => a.localeCompare(b, "es"));

  for (const modelo of modelos) {
    const opt = document.createElement("option");
    opt.value = modelo;
    opt.textContent = modelo;
    el.modelo.appendChild(opt);
  }
}

function onModeloChange() {
  resetFrom();
  const marca = el.marca.value;
  const modelo = el.modelo.value;
  if (!modelo) return;

  const alternativas = productosPorMarca.get(marca).filter((p) => p.modelo === modelo);

  if (alternativas.length === 0) {
    el.sinResultados.hidden = false;
    return;
  }

  let notasCalidad = new Set();
  const grupos = { mejor: [], media: [], baja: [] };
  alternativas.forEach((p, i) => {
    grupos[tierDeCalidad(p.calidad)].push({ p, i });
    if (CATALOGO.glosario_calidad[p.calidad]) {
      notasCalidad.add(CATALOGO.glosario_calidad[p.calidad]);
    }
  });

  const ORDEN_TIERS = ["mejor", "media", "baja"];
  const TITULO_TIER = {
    mejor: "Mejor · Original",
    media: "Media · OLED",
    baja: "Baja · Alternativa",
  };
  ORDEN_TIERS.forEach((tier) => {
    const items = grupos[tier];
    if (!items.length) return;
    const grupo = document.createElement("div");
    grupo.className = "pill-group";
    const titulo = document.createElement("div");
    titulo.className = "pill-group-title tier-" + tier;
    titulo.textContent = TITULO_TIER[tier] + (tier === "mejor" ? "  ★ Recomendado" : "");
    grupo.appendChild(titulo);
    items.forEach(({ p, i }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill";
      const etiqueta = p.color ? `${p.calidad} · ${p.color}` : p.calidad;
      const ventaPill = precioVentaDe(p);
      const precioVentaPill = (ventaPill != null) ? money(ventaPill) : "—";
      const marco = marcoDeModelo(p.modelo);
      const tierBadge = `<span class="pill-tier tier-${tier}">${tier}${marco ? " · " + marco : ""}</span>`;
      btn.innerHTML = `${tierBadge}${etiqueta}<span class="pill-price">${precioVentaPill}</span>`;
      btn.dataset.idx = i;
      btn.addEventListener("click", () => selectAlternativa(alternativas, i));
      grupo.appendChild(btn);
    });
    el.calidadOptions.appendChild(grupo);
  });

  if (notasCalidad.size > 0) {
    el.calidadNota.hidden = false;
    el.calidadNota.textContent = [...notasCalidad].join(" ");
  }

  // Por defecto seleccionamos la opción "mejor" (original) como Recomendada;
  // si no hay original, caemos en la más económica.
  let defaultIndex = -1;
  alternativas.forEach((p, i) => {
    if (defaultIndex === -1 && tierDeCalidad(p.calidad) === "mejor" && p.precio_pantalla != null) defaultIndex = i;
  });
  if (defaultIndex === -1) {
    let min = Infinity;
    alternativas.forEach((p, i) => {
      if (p.precio_pantalla != null && p.precio_pantalla < min) { min = p.precio_pantalla; defaultIndex = i; }
    });
  }
  if (defaultIndex === -1) defaultIndex = 0;
  selectAlternativa(alternativas, defaultIndex);
}

function selectAlternativa(alternativas, index) {
  el.calidadOptions.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
  const selPill = el.calidadOptions.querySelector('.pill[data-idx="' + index + '"]');
  if (selPill) selPill.classList.add("selected");

  const p = alternativas[index];
  const venta = precioVentaDe(p);
  const instal = p.precio_instalacion;
  const instalIncluida = (instal == null);
  el.precioPantalla.textContent = (venta != null) ? money(venta) : "a confirmar";
  el.precioInstalacion.textContent = instalIncluida ? "Incluida" : money(instal);
  el.precioTotal.textContent = (venta != null) ? money(venta + (instalIncluida ? 0 : instal)) : "—";

  const baseHoy = (venta != null ? venta : 0) + (instal != null ? instal : 0);
  el.precioHoy.textContent = baseHoy > 0 ? money(Math.round(baseHoy * 0.95)) : "—";

  // Stock real desde el catálogo (p.stock) si el dashboard lo provee; si no, muestra 1..10 fija por modelo.
  const stock = (p.stock != null) ? p.stock : (stockPorModelo.get(p.marca + "|" + p.modelo) ?? 1);
  const unidad = stock === 1 ? "unidad" : "unidades";
  el.urgenciaStock.textContent = `🪵 ¡Quedan ${stock} ${unidad}!`;

  const etiquetaCalidad = p.color ? `${p.calidad} (${p.color})` : p.calidad;
  const tier = tierDeCalidad(p.calidad);
  const marco = marcoDeModelo(p.modelo);
  const nivelTxt = `Nivel: ${tier}${marco ? " (" + marco + ")" : ""}`;
  let mensaje =     `Hola, quiero reparar mi pantalla (cambio de display).\n\n` +
    `Marca: ${p.marca}\n` +
    `Modelo: ${p.modelo}\n` +
    `Calidad: ${etiquetaCalidad}\n` +
    `${nivelTxt}\n` +
    `Precio pantalla: ${(venta != null) ? money(venta) : "a confirmar"}\n` +
    `Instalación: ${instalIncluida ? "incluida" : (instal != null ? money(instal) : "a confirmar")}\n` +
    `Total: ${(venta != null) ? money(venta + (instalIncluida ? 0 : (instal != null ? instal : 0))) : "a confirmar"}\n` +
    `Promo hoy: 5% dto + lámina de vidrio incluida\n` +
    `🪵 ¡Quedan ${stock} ${unidad} en stock!\n\n` +
    `Quiero coordinar la reparación.`;

  el.whatsappCta.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;
  saveLastQuote(p, venta, el.whatsappCta.href);
  el.resultado.hidden = false;
  el.resultado.classList.remove("just-quoted");
  void el.resultado.offsetWidth; // reinicia la animación del shimmer
  el.resultado.classList.add("just-quoted");
  el.resultado.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

init();

// ===== Splash de bienvenida (paisajes al azar + mensaje corto) =====
// Placeholder local; reemplazá por tus 10 fotos chilenas en build/img/splash/
const SPLASH_IMAGES = [
  "img/splash.svg","img/splash.svg","img/splash.svg","img/splash.svg","img/splash.svg",
  "img/splash.svg","img/splash.svg","img/splash.svg","img/splash.svg","img/splash.svg"
];
const SPLASH_MESSAGES = [
  "¿Cómo está hoy? ¿Aún no confía en alguien para reparar su teléfono?",
  "¿Se le rompió la pantalla y no sabe en quién confiar?",
  "Reparar no debería ser un riesgo. Cotice tranquilo, con precio real."
];
function initSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  const bg = document.getElementById("splash-bg");
  const msg = document.getElementById("splash-msg");
  // Intro: bandera del cliente (bandera.gif). Fallback a la bandera SVG de Chile si falta el archivo.
  bg.style.backgroundImage = `url("img/bandera.svg")`;
  const flagImg = new Image();
  flagImg.onload = () => { bg.style.backgroundImage = `url("img/bandera.gif")`; };
  flagImg.src = "img/bandera.gif";

  // Video del splash: si SPLASH_VIDEO_SRC tiene una ruta, lo reproduce; si no, lo quitamos
  // del DOM y queda la bandera de fondo (sin hacer requests 404).
  const sv = document.getElementById("splash-video");
  if (sv) {
    if (SPLASH_VIDEO_SRC) {
      sv.src = SPLASH_VIDEO_SRC;
      sv.play && sv.play().catch(() => {});
    } else {
      sv.remove();
    }
  }
  let autoTimer = null;
  let typeTimer = null;
  const mensaje = SPLASH_MESSAGES[Math.floor(Math.random() * SPLASH_MESSAGES.length)];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    msg.textContent = mensaje;
  } else {
    // Efecto "alguien te está escribiendo": tipeo letra por letra + cursor
    msg.textContent = "";
    msg.classList.add("typing");
    typeTimer = setTimeout(() => {
      let i = 0;
      const tick = () => {
        msg.textContent = mensaje.slice(0, i);
        if (i < mensaje.length) { i++; typeTimer = setTimeout(tick, 38); }
        else msg.classList.remove("typing");
      };
      tick();
    }, 500);
  }
  const close = () => {
    if (autoTimer) clearTimeout(autoTimer);
    if (typeTimer) clearTimeout(typeTimer);
    msg.classList.remove("typing");
    splash.classList.add("hidden");
  };
  autoTimer = setTimeout(close, 7000); // pasa solo al home luego de 7s
  document.getElementById("splash-start").addEventListener("click", () => {
    close();
    document.getElementById("cotizador").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("splash-skip").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
initSplash();

// ===== Paralaje del fondo al mover el mouse (sutil, no molesta) =====
function initParallax(){
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bg = document.getElementById('bg-layer');
  const layers = [
    { el: document.querySelector('.orb-1'), depth: 26 },
    { el: document.querySelector('.orb-2'), depth: -34 },
    { el: document.querySelector('.orb-3'), depth: 16 },
  ].filter((l) => l.el);
  let tx = 0, ty = 0, cx = 0, cy = 0;
  window.addEventListener('pointermove', (e) => {
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  (function loop(){
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    if (bg) bg.style.transform = `translate3d(${(cx * -14).toFixed(2)}px, ${(cy * -14).toFixed(2)}px, 0)`;
    for (const l of layers) l.el.style.transform = `translate3d(${(cx * l.depth).toFixed(2)}px, ${(cy * l.depth).toFixed(2)}px, 0)`;
    requestAnimationFrame(loop);
  })();
}
initParallax();

// ===== Botón flotante de WhatsApp (siempre visible) =====
function initFab(){
  const fab = document.getElementById("whatsapp-fab");
  if (fab) fab.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hola, quiero reparar mi pantalla (cambio de display).")}`;
}
initFab();

// ===== Mascote del logo: camina, te mira y sale corriendo =====
function initMascota(){
  const m = document.getElementById("mascota");
  if (!m) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { m.style.display = "none"; return; }
  const splash = document.getElementById("splash");
  const ready = () => !splash || splash.classList.contains("hidden") || getComputedStyle(splash).display === "none";
  const rand = (a, b) => a + Math.random() * (b - a);
  function walk(){
    if (!ready()) { setTimeout(walk, 300); return; }
    const max = Math.max(40, window.innerWidth - 150);
    const x = rand(20, max);
    m.style.transition = "transform 1.8s cubic-bezier(.22,.61,.36,1)";
    m.style.transform = "translateX(" + x + "px)";
    setTimeout(() => {
      m.classList.add("look");                                   // te mira
      setTimeout(() => {
        m.classList.remove("look");
        m.style.transition = "transform .6s ease-in";            // sale corriendo
        const dir = (Math.random() < 0.5) ? -200 : (window.innerWidth + 200);
        m.style.transform = "translateX(" + dir + "px)";
        setTimeout(() => {
          m.style.opacity = "0";
          setTimeout(() => {
            m.style.transition = "none";
            m.style.transform = "translateX(" + (dir > 0 ? 20 : window.innerWidth - 80) + "px)";
            m.style.opacity = "1";
            setTimeout(walk, 700);
          }, 450);
        }, 700);
      }, 950);
    }, 1900);
  }
  walk();
}

// ===== Pista de scroll: mano abajo si no deslizás en 2s =====
function initScrollHint(){
  const h = document.getElementById("scroll-hint");
  if (!h) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const splash = document.getElementById("splash");
  const listo = () => !splash || splash.classList.contains("hidden") || getComputedStyle(splash).display === "none";
  let mostrado = false;
  function mostrarSiQuieto(){
    if (mostrado) return;
    if (window.scrollY > 10) return;
    mostrado = true;
    h.classList.add("show");
  }
  function ocultar(){ h.classList.remove("show"); }
  const arrancar = () => setTimeout(() => { if (window.scrollY <= 10) mostrarSiQuieto(); }, 2000);
  if (listo()) arrancar();
  else { const iv = setInterval(() => { if (listo()) { clearInterval(iv); arrancar(); } }, 300); }
  window.addEventListener("scroll", () => { if (window.scrollY > 10) ocultar(); }, { passive: true });
  ["click", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, ocultar, { passive: true, once: true }));
}

initMascota();
initScrollHint();

// ===== Conversión: recordar última cotización + medir clicks =====
const STORE_KEY = "techlion_cotizador_v1";
function storeGet(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
  catch { return {}; }
}
function storeSet(obj){
  try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch {}
}
function hoy(){
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function trackClick(){
  const s = storeGet();
  const fecha = hoy();
  if (s.clicksFecha !== fecha) { s.clicksFecha = fecha; s.clicksHoy = 0; }
  s.clicksHoy = (s.clicksHoy || 0) + 1;
  storeSet(s);
  renderSocialProof(s.clicksHoy);
}
function renderSocialProof(n){
  if (!el.socialProof) return;
  el.socialProof.textContent = (!n) ? "" :
    (n === 1 ? "💬 1 cotización enviada hoy" : `💬 ${n} cotizaciones enviadas hoy`);
}
function saveLastQuote(p, venta, waHref){
  const s = storeGet();
  const marco = marcoDeModelo(p.modelo);
  s.ultima = {
    marca: p.marca, modelo: p.modelo, calidad: p.calidad, color: p.color,
    nivel: `Nivel: ${tierDeCalidad(p.calidad)}${marco ? " (" + marco + ")" : ""}`,
    venta: (venta != null) ? money(venta) : "a confirmar",
    waHref, ts: Date.now(),
  };
  storeSet(s);
  renderUltimaCotizacion(s.ultima);
}
function renderUltimaCotizacion(u){
  if (!el.ultimaCotizacion) return;
  if (!u) { el.ultimaCotizacion.hidden = true; return; }
  const dias = Math.floor((Date.now() - (u.ts || 0)) / 86400000);
  if (dias > 7) { el.ultimaCotizacion.hidden = true; return; }
  const texto = `${u.marca} ${u.modelo} · ${u.calidad}${u.color ? " (" + u.color + ")" : ""} — ${u.venta}`;
  el.ultimaCotizacion.hidden = false;
  el.ultimaCotizacion.innerHTML =
    `📋 Tu última cotización: <strong>${texto}</strong> ` +
    `<a href="${u.waHref}" target="_blank" rel="noopener" class="ultima-reenviar">Reenviar ↺</a>` +
    `<button type="button" class="ultima-cerrar" aria-label="Cerrar">✕</button>`;
  const cerrar = el.ultimaCotizacion.querySelector(".ultima-cerrar");
  if (cerrar) cerrar.addEventListener("click", () => {
    const s = storeGet(); delete s.ultima; storeSet(s);
    el.ultimaCotizacion.hidden = true;
  });
}
function initTracking(){
  if (el.whatsappCta) el.whatsappCta.addEventListener("click", trackClick);
  const s = storeGet();
  renderSocialProof(s.clicksHoy && s.clicksFecha === hoy() ? s.clicksHoy : 0);
  renderUltimaCotizacion(s.ultima);
}
