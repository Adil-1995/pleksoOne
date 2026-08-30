#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  LumaBot — generador del manual
//
//  USO
//    node docs/manual/generar.mjs            regenera desde instantanea.json
//    node docs/manual/generar.mjs --fetch    baja los workflows de n8n antes
//    node docs/manual/generar.mjs --check    no escribe; sale != 0 si hay deriva
//
//  La clave de la API se lee de N8N_API_KEY. Nunca del repo.
//
//  QUÉ HACE QUE ESTO NO MIENTA
//    1. Anclas: cada bloque de la narrativa declara de qué nodos habla.
//       Si un ancla no existe en el workflow vivo -> ERROR, no se escribe.
//    2. Cobertura: cada nodo que se traga errores tiene que estar analizado
//       en la tabla de riesgo. Si aparece uno nuevo -> ERROR.
//    3. Vivos: los IDs declarados tienen que seguir activos -> si no, ERROR.
//    4. Sello: el HTML lleva fecha, versionCounter y número de nodos.
// ─────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from './narrativa.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const INSTANTANEA = path.join(AQUI, 'instantanea.json');
const INVENTARIO = path.join(AQUI, 'inventario.json');
const SALIDA = path.join(AQUI, '..', 'manual.html');
const BASE = process.env.N8N_BASE || 'https://plekso.duckdns.org';
const MERMAID = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FETCH = args.includes('--fetch');

const errores = [];
const avisos = [];

// ── 1. Conseguir los workflows ───────────────────────────────────────────

const PATRONES_SECRETO = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,  // JWT
  /EAA[A-Za-z0-9]{20,}/,                         // token de Meta
  /sk-[A-Za-z0-9]{20,}/,                         // OpenAI
  /\b[0-9]{9,10}:AA[A-Za-z0-9_-]{30,}/,          // bot de Telegram
];

// Quita la clave `credentials` esté donde esté. Hace falta el barrido
// recursivo porque la API devuelve además `activeVersion`, que es una
// COPIA ENTERA del workflow y lleva sus propias credenciales dentro:
// limpiar solo `nodes[]` dejaba 13 bloques colados en la instantánea.
function pelar(x) {
  if (Array.isArray(x)) return x.map(pelar);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === 'credentials') continue;
      o[k] = pelar(v);
    }
    return o;
  }
  return x;
}

function sanear(wf) {
  let copia = JSON.parse(JSON.stringify(wf));
  delete copia.shared;
  delete copia.activeVersion;  // duplicado del propio workflow: ni aporta ni conviene
  delete copia.pinData;        // datos de prueba pegados a mano, pueden ser de un cliente real
  copia = pelar(copia);
  const texto = JSON.stringify(copia);
  for (const p of PATRONES_SECRETO) {
    const m = texto.match(p);
    if (m) {
      console.error(`\n  ABORTADO: parece haber un secreto literal en «${wf.name}».`);
      console.error(`  Coincide con ${p}. No se escribe la instantánea.`);
      process.exit(2);
    }
  }
  return copia;
}

async function bajar() {
  const K = process.env.N8N_API_KEY;
  if (!K) { console.error('  Falta N8N_API_KEY en el entorno.'); process.exit(2); }
  const out = [];
  for (const id of N.VIVOS) {
    const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { 'X-N8N-API-KEY': K } });
    if (!r.ok) { console.error(`  ${id}: HTTP ${r.status}`); process.exit(2); }
    out.push(sanear(await r.json()));
  }
  fs.writeFileSync(INSTANTANEA, JSON.stringify(out, null, 1));

  // Inventario completo: solo id/nombre/estado, para el apéndice.
  const inv = [];
  let cursor = null;
  do {
    const u = new URL(`${BASE}/api/v1/workflows`);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { 'X-N8N-API-KEY': K } });
    if (!r.ok) { console.error(`  inventario: HTTP ${r.status}`); process.exit(2); }
    const j = await r.json();
    for (const w of j.data || []) inv.push({ id: w.id, name: w.name, active: !!w.active, isArchived: !!w.isArchived });
    cursor = j.nextCursor || null;
  } while (cursor);
  fs.writeFileSync(INVENTARIO, JSON.stringify(inv, null, 1));

  console.log(`  Instantánea actualizada (${out.length} vivos, ${inv.length} en el inventario).`);
  return out;
}

const wfs = FETCH ? await bajar() : JSON.parse(fs.readFileSync(INSTANTANEA, 'utf8'));
const porId = Object.fromEntries(wfs.map(w => [w.id, w]));
const inventario = fs.existsSync(INVENTARIO) ? JSON.parse(fs.readFileSync(INVENTARIO, 'utf8')) : [];

// ── 2. Hechos derivados del JSON ─────────────────────────────────────────

const esSticky = n => n.type === 'n8n-nodes-base.stickyNote';

function destino(n) {
  const p = n.parameters || {};
  const u = typeof p.url === 'string' ? p.url : '';
  if (/api\.telegram\.org/.test(u)) return { clase: 'telegram', etiqueta: 'Telegram' };
  if (/graph\.facebook\.com/.test(u)) return { clase: 'meta', etiqueta: 'Meta Graph' };
  let m;
  if ((m = u.match(/\/rest\/v1\/rpc\/([a-z_]+)/))) return { clase: 'supabase', etiqueta: `RPC ${m[1]}`, tabla: `rpc/${m[1]}` };
  if ((m = u.match(/\/rest\/v1\/([a-z_]+)/)))     return { clase: 'supabase', etiqueta: m[1], tabla: m[1] };
  if (/\/storage\/v1\//.test(u))  return { clase: 'supabase', etiqueta: 'Storage', tabla: 'storage' };
  if (/\/auth\/v1\//.test(u))     return { clase: 'supabase', etiqueta: 'auth', tabla: 'auth' };
  if (/openai/.test(u))           return { clase: 'openai', etiqueta: 'OpenAI' };
  if (/docs\.google/.test(u))     return { clase: 'google', etiqueta: 'Google Docs' };
  if (n.type.includes('googleSheets')) return { clase: 'google', etiqueta: 'Google Sheets' };
  if (n.type.includes('postgres') || n.type.includes('memoryPostgresChat'))
    return { clase: 'postgres', etiqueta: 'Postgres (bot-postgres-1)' };
  if (n.type.includes('executeWorkflow') && !n.type.includes('Trigger'))
    return { clase: 'subflujo', etiqueta: 'subflujo', destinoId: p.workflowId?.value || p.workflowId };
  return { clase: 'otro', etiqueta: n.type.split('.').pop() };
}

function grafo(w) {
  const abajo = {};
  for (const [src, c] of Object.entries(w.connections || {})) {
    abajo[src] = [];
    for (const salida of (c.main || [])) for (const x of (salida || [])) abajo[src].push(x.node);
  }
  return abajo;
}

const hechos = {};
for (const w of wfs) {
  const nodos = (w.nodes || []).filter(n => !esSticky(n));
  const abajo = grafo(w);
  const rutas = nodos
    .filter(n => n.type === 'n8n-nodes-base.webhook')
    .map(n => ({ metodo: (n.parameters?.httpMethod || 'GET'), path: n.parameters?.path }));
  const tablas = new Map();
  for (const n of nodos) {
    const d = destino(n);
    if (d.clase === 'supabase') {
      const metodo = n.parameters?.method || 'GET';
      const k = `${d.tabla}`;
      if (!tablas.has(k)) tablas.set(k, new Set());
      tablas.get(k).add(metodo);
    }
  }
  const postgres = nodos.filter(n => destino(n).clase === 'postgres').map(n => n.name);
  const telegram = nodos.filter(n => destino(n).clase === 'telegram').map(n => n.name);
  const llama = [...new Set(nodos.map(destino).filter(d => d.clase === 'subflujo').map(d => d.destinoId))];
  hechos[w.id] = {
    nombre: w.name, activo: w.active, total: (w.nodes || []).length, reales: nodos.length,
    rutas, tablas, postgres, telegram, llama, abajo,
    nombres: new Set(nodos.map(n => n.name)),
    tragan: nodos.filter(n => n.onError === 'continueRegularOutput'),
    ramaError: nodos.filter(n => n.onError === 'continueErrorOutput'),
    paran: nodos.filter(n => !n.onError && /httpRequest|postgres|googleSheets|executeWorkflow/.test(n.type)),
    reintentan: nodos.filter(n => n.retryOnFail),
    neverError: nodos.filter(n => n.parameters?.options?.neverError === true),
  };
}

// ── 3. Validaciones (aquí es donde el manual se niega a mentir) ──────────

for (const id of N.VIVOS) {
  if (!porId[id]) errores.push(`El workflow ${id} está declarado como vivo y no aparece en la instantánea.`);
  else if (!porId[id].active) errores.push(`El workflow ${id} («${porId[id].name}») está declarado como vivo pero active=false.`);
}

for (const [id, doc] of Object.entries(N.workflows)) {
  const h = hechos[id];
  if (!h) { errores.push(`La narrativa documenta ${id}, que no está en la instantánea.`); continue; }
  for (const b of doc.bloques) {
    for (const a of b.ancla) {
      if (!h.nombres.has(a)) errores.push(`Ancla muerta en «${doc ? b.titulo : ''}» (${id}): no existe el nodo «${a}».`);
    }
  }
  // los avisos de Telegram documentados tienen que existir, y al revés
  for (const nodo of Object.keys(doc.telegram || {}))
    if (!h.nombres.has(nodo)) errores.push(`Aviso de Telegram documentado que ya no existe: «${nodo}» (${id}).`);
  for (const nodo of h.telegram)
    if (!(doc.telegram || {})[nodo]) avisos.push(`Aviso de Telegram SIN DOCUMENTAR: «${nodo}» en ${h.nombre}.`);
}

for (const d of N.discrepancias)
  for (const a of (d.ancla || [])) {
    const existe = Object.values(hechos).some(h => h.nombres.has(a));
    if (!existe) errores.push(`Ancla muerta en la discrepancia «${d.titulo}»: no existe el nodo «${a}» en ningún workflow vivo.`);
  }

// cobertura de la tabla de riesgo
const clavesVivas = [];
for (const [id, h] of Object.entries(hechos))
  for (const n of h.tragan) clavesVivas.push(`${id}::${n.name}`);
for (const k of clavesVivas)
  if (!N.riesgos[k]) errores.push(`Nodo que se traga errores SIN ANALIZAR en la tabla de riesgo: ${k}`);
for (const k of Object.keys(N.riesgos))
  if (!clavesVivas.includes(k)) avisos.push(`La tabla de riesgo analiza ${k}, que ya no se traga errores (¿arreglado?). Quítalo de narrativa.mjs.`);

// vigilancia de neverError, que fue una lección cara
for (const [id, h] of Object.entries(hechos))
  for (const n of h.neverError) avisos.push(`neverError=true reaparecido en «${n.name}» (${h.nombre}). Es apagar la alarma de incendios.`);

if (errores.length) {
  console.error('\n  EL MANUAL NO SE GENERA. Hay ' + errores.length + ' problema(s):\n');
  for (const e of errores) console.error('   · ' + e);
  console.error('\n  Arregla docs/manual/narrativa.mjs y vuelve a lanzarlo.\n');
  process.exit(1);
}
if (avisos.length) { console.warn('\n  Avisos:'); for (const a of avisos) console.warn('   · ' + a); }
if (CHECK) { console.log('\n  --check: sin deriva. El manual está al día.\n'); process.exit(0); }

// ── 4. Diagramas Mermaid ────────────────────────────────────────────────

const mm = s => s.replace(/"/g, "'");

function diagramaMapa() {
  const L = ['graph LR'];
  L.push('  META["Meta / WhatsApp Cloud API"]:::ext');
  L.push('  INBOX["Inbox (navegador)"]:::ext');
  for (const id of N.VIVOS) {
    const h = hechos[id];
    const r = h.rutas.map(x => x.metodo + ' /' + x.path);
    const sub = r.length ? r.join('<br/>') : 'subflujo (executeWorkflowTrigger)';
    L.push(`  ${id}["${mm(h.nombre)}<br/><small>${sub}</small>"]:::wf`);
  }
  L.push(`  META -->|"POST mensajes<br/>GET verificación"| qx1O54zpuyxzfW8V`);
  L.push(`  INBOX -->|"POST /inbox-enviar"| YGqvrxFadgtdS7Lo`);
  L.push(`  INBOX -->|"POST /capi-purchase"| qXCipdF2Blm0v6HI`);
  for (const [id, h] of Object.entries(hechos))
    for (const d of h.llama) if (hechos[d]) L.push(`  ${id} ==>|llama como subflujo| ${d}`);
  L.push(`  CYgKApb26ARGlhVZ -->|"POST /messages"| META`);
  L.push(`  qXCipdF2Blm0v6HI -->|"Purchase al CAPI"| META`);
  L.push('  classDef wf fill:#1d4ed8,stroke:#1e3a8a,color:#fff');
  L.push('  classDef ext fill:#374151,stroke:#111827,color:#fff');
  return L.join('\n');
}

function diagramaRecorrido() {
  return `sequenceDiagram
  autonumber
  participant C as Cliente
  participant M as Meta
  participant R as Receptor
  participant S as Supabase
  participant O as Subflujo salida
  C->>M: escribe por WhatsApp
  M->>R: POST /wa-cloud-multi
  R-->>M: 200 (antes de procesar)
  R->>R: valida X-Hub-Signature-256
  R->>S: resuelve canal por phone_number_id
  R->>S: guarda el mensaje (regla 1)
  R->>S: ¿bot_activo para este cliente?
  Note over R: buffer de 6 s: junta mensajes seguidos
  R->>R: compone prompt + lee catálogo
  R->>R: Decidir ficha (el flujo, no el modelo)
  alt toca ficha
    R->>O: ENVIAR ficha directa
  else contesta el modelo
    R->>R: AI Agent + Filtro Seguridad
    R->>O: ENVIAR respuesta
  end
  O->>S: ¿por qué número sale?
  O->>M: POST /messages
  O->>S: registra la fila saliente
  O-->>R: {ok, wamid, error}
  M->>C: María contesta`;
}

function diagramaBloques(id) {
  const doc = N.workflows[id];
  const L = ['graph TD'];
  doc.bloques.forEach((b, i) => L.push(`  B${i}["${mm(b.titulo)}"]`));
  for (let i = 0; i < doc.bloques.length - 1; i++) L.push(`  B${i} --> B${i + 1}`);
  return L.join('\n');
}

// ── 5. HTML ─────────────────────────────────────────────────────────────

const GRAV = { critico: 0, alto: 1, medio: 2, bajo: 3 };
const ETIQ = { critico: 'CRÍTICO', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };

const filasRiesgo = clavesVivas
  .map(k => {
    const [id, nodo] = k.split('::');
    const h = hechos[id];
    const n = h.tragan.find(x => x.name === nodo);
    const d = destino(n);
    const ab = h.abajo[nodo] || [];
    return { k, id, nodo, wf: h.nombre, destino: d.etiqueta, metodo: n.parameters?.method || '',
             abajo: ab.length ? ab.join(', ') : '(terminal)', ...N.riesgos[k] };
  })
  .sort((a, b) => GRAV[a.gravedad] - GRAV[b.gravedad] || a.wf.localeCompare(b.wf));

const cuenta = g => filasRiesgo.filter(f => f.gravedad === g).length;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sello = wfs.map(w => `${w.name} — ${(w.nodes || []).length} nodos`).join(' · ');

// Apéndice: todo lo que no está vivo.
const inactivos = inventario.filter(w => !w.active).sort((a, b) => a.name.localeCompare(b.name));
const tablaInactivos = inventario.length
  ? `<table><tr><th>ID</th><th>Nombre</th><th>Estado</th></tr>
     ${inactivos.map(w => `<tr><td class="id">${esc(w.id)}</td><td>${esc(w.name)}</td>
       <td>${w.isArchived ? 'archivado' : 'inactivo'}</td></tr>`).join('')}</table>`
  : '<p class="id">No hay inventario. Lánzalo con <code>--fetch</code> para rellenarlo.</p>';

const html = `<title>Manual LumaBot</title>
<style>
  :root{
    --fondo:#fbfaf8; --papel:#fff; --tinta:#1a1a1a; --suave:#5c5c5c; --borde:#e3e0da;
    --azul:#1d4ed8; --rojo:#b91c1c; --rojoF:#fef2f2; --naranja:#b45309; --naranjaF:#fffbeb;
    --amarillo:#7c6f1a; --amarilloF:#fefce8; --verde:#15803d; --verdeF:#f0fdf4; --codigoF:#f4f2ee;
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --fondo:#16161a; --papel:#1d1d22; --tinta:#e9e7e3; --suave:#a3a09a; --borde:#33333c;
    --azul:#7fa5ff; --rojo:#fca5a5; --rojoF:#3b1a1a; --naranja:#fcd34d; --naranjaF:#3a2c10;
    --amarillo:#fde68a; --amarilloF:#33300f; --verde:#86efac; --verdeF:#12301c; --codigoF:#26262d;
  }}
  :root[data-theme="dark"]{
    --fondo:#16161a; --papel:#1d1d22; --tinta:#e9e7e3; --suave:#a3a09a; --borde:#33333c;
    --azul:#7fa5ff; --rojo:#fca5a5; --rojoF:#3b1a1a; --naranja:#fcd34d; --naranjaF:#3a2c10;
    --amarillo:#fde68a; --amarilloF:#33300f; --verde:#86efac; --verdeF:#12301c; --codigoF:#26262d;
  }
  *{box-sizing:border-box}
  body{background:var(--fondo);color:var(--tinta);
    font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
    margin:0;padding:0 20px 80px}
  .marco{max-width:1000px;margin:0 auto}
  header{padding:48px 0 28px;border-bottom:2px solid var(--borde);margin-bottom:36px}
  h1{font-size:2.1rem;margin:0 0 6px;letter-spacing:-.02em}
  .sub{color:var(--suave);font-size:1.05rem;margin:0 0 18px}
  .sello{background:var(--papel);border:1px solid var(--borde);border-left:3px solid var(--azul);
    border-radius:0 6px 6px 0;padding:10px 14px;font-size:.82rem;color:var(--suave)}
  .sello b{color:var(--tinta)}
  h2{font-size:1.5rem;margin:52px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--borde);letter-spacing:-.01em}
  h3{font-size:1.12rem;margin:30px 0 8px}
  h4{font-size:1rem;margin:22px 0 6px;color:var(--suave);text-transform:uppercase;letter-spacing:.06em}
  code{background:var(--codigoF);padding:1px 5px;border-radius:4px;font-size:.87em;
    font-family:"SF Mono",Menlo,Consolas,monospace}
  pre{background:var(--codigoF);border:1px solid var(--borde);border-radius:7px;
    padding:12px 14px;overflow-x:auto}
  pre code{background:none;padding:0;font-size:.83rem;line-height:1.5}
  .tarjeta{background:var(--papel);border:1px solid var(--borde);border-radius:9px;padding:20px 24px;margin:18px 0}
  .wf{border-left:3px solid var(--azul)}
  .id{font-family:"SF Mono",Menlo,monospace;font-size:.78rem;color:var(--suave)}
  table{width:100%;border-collapse:collapse;font-size:.87rem;margin:12px 0}
  th{text-align:left;padding:9px 10px;border-bottom:2px solid var(--borde);
    font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--suave)}
  td{padding:10px;border-bottom:1px solid var(--borde);vertical-align:top}
  .envoltorio{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.7rem;
    font-weight:700;letter-spacing:.04em;white-space:nowrap}
  .critico{background:var(--rojoF);color:var(--rojo);border:1px solid var(--rojo)}
  .alto{background:var(--naranjaF);color:var(--naranja);border:1px solid var(--naranja)}
  .medio{background:var(--amarilloF);color:var(--amarillo);border:1px solid var(--amarillo)}
  .bajo{background:var(--verdeF);color:var(--verde);border:1px solid var(--verde)}
  tr.f-critico{background:var(--rojoF)}
  .no{color:var(--rojo);font-weight:700}
  .si{color:var(--verde);font-weight:700}
  .resumen{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
  .cuenta{background:var(--papel);border:1px solid var(--borde);border-radius:8px;
    padding:10px 16px;text-align:center;min-width:96px}
  .cuenta b{display:block;font-size:1.5rem;line-height:1.2}
  .mermaid{background:var(--papel);border:1px solid var(--borde);border-radius:9px;
    padding:18px;margin:16px 0;overflow-x:auto;text-align:center}
  .aviso{background:var(--naranjaF);border:1px solid var(--naranja);border-left:3px solid var(--naranja);
    border-radius:0 7px 7px 0;padding:12px 16px;margin:16px 0;font-size:.92rem}
  ol,ul{padding-left:22px} li{margin:5px 0}
  footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--borde);
    font-size:.82rem;color:var(--suave)}
  .indice{columns:2;column-gap:30px;font-size:.92rem}
  @media(max-width:640px){.indice{columns:1}}
  a{color:var(--azul)}
</style>

<div class="marco">
<header>
  <h1>${esc(N.meta.titulo)}</h1>
  <p class="sub">${esc(N.meta.subtitulo)}</p>
  <div class="sello">
    <b>Generado el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</b>
    leyendo los workflows vivos por la API de n8n.<br>
    ${esc(sello)}<br>
    El mapa, las rutas, las tablas, los avisos y la tabla de riesgo salen del JSON.
    Las explicaciones están en <code>docs/manual/narrativa.mjs</code>.
  </div>
</header>

<div class="tarjeta">
  <h4 style="margin-top:0">Índice</h4>
  <div class="indice">
    <a href="#mapa">1. Mapa general</a><br>
    <a href="#recorrido">2. Recorrido de un mensaje</a><br>
    <a href="#muerde">3. Lo que me muerde</a><br>
    <a href="#riesgo">4. Tabla de riesgo</a><br>
    ${N.VIVOS.map((id, i) => `<a href="#w${i}">${5 + i}. ${esc(hechos[id].nombre)}</a><br>`).join('')}
    <a href="#discrepancias">9. Discrepancias</a><br>
    <a href="#apendice">10. Apéndice: los inactivos</a>
  </div>
</div>

<h2 id="mapa">1. Mapa general</h2>
${N.mapa.intro}
<pre class="mermaid">${diagramaMapa()}</pre>

<h2 id="recorrido">2. Recorrido de un mensaje</h2>
${N.mapa.recorrido}
<pre class="mermaid">${diagramaRecorrido()}</pre>

<h2 id="muerde">3. Lo que me muerde</h2>
${N.muerde}

<h2 id="riesgo">4. Tabla de riesgo: los ${filasRiesgo.length} nodos que se tragan un error</h2>
<p>Estos nodos llevan <code>onError: continueRegularOutput</code>. Cuando fallan,
<strong>la ejecución sale verde</strong> y algo no ha pasado. Ordenados por gravedad,
no por workflow. La columna «¿me entero?» es la que importa: en rojo, los que pueden
fallar sin que nadie se entere.</p>

<div class="resumen">
  <div class="cuenta"><b class="no">${cuenta('critico')}</b>críticos</div>
  <div class="cuenta"><b style="color:var(--naranja)">${cuenta('alto')}</b>altos</div>
  <div class="cuenta"><b style="color:var(--amarillo)">${cuenta('medio')}</b>medios</div>
  <div class="cuenta"><b class="si">${cuenta('bajo')}</b>bajos</div>
</div>

<div class="aviso">
  <strong>El patrón que más se repite:</strong> de los ${cuenta('critico')} críticos,
  ${filasRiesgo.filter(f => f.gravedad === 'critico' && /Avisar/.test(f.nodo)).length}
  son <em>nodos de aviso</em> que se tragan su propio fallo, y
  ${filasRiesgo.filter(f => f.gravedad === 'critico' && /Check|Sigue activo|Leer estado/.test(f.nodo)).length}
  son comprobaciones de la pausa manual que fallan <em>abiertas</em>. Es decir: la red
  de seguridad y el interruptor de emergencia son las dos cosas más frágiles del sistema.
</div>

<div class="envoltorio">
<table>
  <tr><th>Gravedad</th><th>Nodo</th><th>Workflow</th><th>Destino</th>
      <th>Qué deja de ocurrir</th><th>¿Me entero?</th></tr>
  ${filasRiesgo.map(f => `<tr class="${f.gravedad === 'critico' ? 'f-critico' : ''}">
    <td><span class="pill ${f.gravedad}">${ETIQ[f.gravedad]}</span></td>
    <td><code>${esc(f.nodo)}</code><br><span class="id">→ ${esc(f.abajo)}</span></td>
    <td style="font-size:.8rem">${esc(f.wf.replace(' — PROD', ''))}</td>
    <td style="font-size:.8rem">${esc(f.destino)} ${esc(f.metodo)}</td>
    <td>${esc(f.pierde)}</td>
    <td class="${/^S[ÍI]/.test(f.entero) ? 'si' : 'no'}">${esc(f.entero)}</td>
  </tr>`).join('')}
</table>
</div>

${N.VIVOS.map((id, i) => {
  const h = hechos[id], doc = N.workflows[id];
  const tablas = [...h.tablas.entries()].map(([t, ms]) => `<code>${t}</code> <span class="id">(${[...ms].join(', ')})</span>`).join(' · ');
  return `
<h2 id="w${i}">${5 + i}. ${esc(h.nombre)}</h2>
<div class="tarjeta wf">
  <div class="id">${id} · ${h.reales} nodos · ${h.rutas.map(r => r.metodo + ' /' + r.path).join(', ') || 'sin webhook'}</div>
  <h4>Para qué sirve</h4>${doc.proposito}
  <h4>Qué lo dispara</h4>${doc.disparador}
</div>

<h3>Bloques, en orden</h3>
<pre class="mermaid">${diagramaBloques(id)}</pre>
${doc.bloques.map(b => `<div class="tarjeta">
  <strong>${esc(b.titulo)}</strong>
  <div class="id" style="margin:4px 0 8px">${b.ancla.map(a => esc(a)).join(' · ')}</div>
  ${b.texto}</div>`).join('')}

<h3>Qué escribe, y dónde</h3>
<div class="tarjeta">
  <p><strong>Tablas detectadas en el JSON:</strong> ${tablas || '—'}</p>
  ${h.postgres.length ? `<p><strong>Nodos que van al Postgres viejo (no Supabase):</strong> ${h.postgres.map(x => `<code>${esc(x)}</code>`).join(' · ')}</p>` : ''}
  ${doc.supabase}
</div>

<h3>Qué avisa a Telegram, y cuándo</h3>
${Object.keys(doc.telegram).length ? `<div class="envoltorio"><table>
  <tr><th>Nodo</th><th>Cuándo salta</th></tr>
  ${Object.entries(doc.telegram).map(([n, c]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(c)}</td></tr>`).join('')}
</table></div>` : '<div class="tarjeta">No manda ningún aviso a Telegram.</div>'}

<h3>Qué pasa si falla</h3>
<div class="tarjeta">
  ${doc.fallo}
  <p class="id">Contado del JSON: ${h.tragan.length} nodos siguen en silencio ·
  ${h.ramaError.length} tienen rama de error · ${h.reintentan.length} reintentan ·
  ${h.paran.length} nodos externos sin marca (paran la ejecución).</p>
</div>`;
}).join('')}

<h2 id="discrepancias">9. Discrepancias</h2>
<p>Sitios donde el código no cuadra con lo que se supone que hace. Salen de leer
los nodos, no de la documentación.</p>
${N.discrepancias.map(d => `<div class="tarjeta" style="border-left:3px solid var(--${d.gravedad === 'critico' ? 'rojo' : d.gravedad === 'alto' ? 'naranja' : 'amarillo'})">
  <span class="pill ${d.gravedad}">${ETIQ[d.gravedad]}</span>
  <strong style="margin-left:8px">${esc(d.titulo)}</strong>
  ${d.ancla.length ? `<div class="id" style="margin:6px 0">${d.ancla.map(esc).join(' · ')}</div>` : ''}
  ${d.texto}</div>`).join('')}

<h2 id="apendice">10. Apéndice: los ${inactivos.length} workflows inactivos</h2>
<p>No se ha borrado ninguno. Están desactivados: sin webhook registrado, sin
ejecuciones y sin que ningún workflow vivo los llame.</p>
<div class="envoltorio">${tablaInactivos}</div>

<footer>
  Generado por <code>docs/manual/generar.mjs</code> desde
  <code>docs/manual/instantanea.json</code>.<br>
  Para regenerarlo: <code>N8N_API_KEY=… node docs/manual/generar.mjs --fetch</code>.
  Para comprobar si se ha quedado viejo sin escribir nada:
  <code>node docs/manual/generar.mjs --check</code>.
</footer>
</div>

<script src="${MERMAID}"></script>
<script>
  (function(){
    var oscuro = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (window.mermaid) mermaid.initialize({
      startOnLoad: true, securityLevel: 'loose',
      theme: oscuro ? 'dark' : 'default'
    });
  })();
</script>`;

fs.writeFileSync(SALIDA, html);
console.log(`\n  Manual escrito en ${path.relative(process.cwd(), SALIDA)}`);
console.log(`  ${filasRiesgo.length} nodos en la tabla de riesgo (${cuenta('critico')} críticos).`);
console.log(`  ${N.discrepancias.length} discrepancias documentadas.\n`);
