#!/usr/bin/env node
/**
 * Extrae las pestañas FB_Paginas y FB_Anuncios del export del Sheet.
 *
 *   node fb/leer-sheet.js <export.json>
 *
 * El export viene como markdown de tablas pegadas una detrás de otra, así que
 * las pestañas se localizan por su fila de cabecera, no por posición.
 */
'use strict';
const fs = require('fs');

const texto = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).fileContent;
const lineas = texto.split('\n');
const limpiar = (s) => String(s || '').replace(/\\/g, '').trim();

/** Lee una tabla a partir de la fila de cabecera que contenga `marca`. */
function tabla(marca, columnas) {
  // Dos cosas que hacen falta a la vez:
  //  - El export ESCAPA los guiones bajos: la cabecera llega como `page\_id`.
  //    Buscar el literal sin escapar no encuentra nada y parece que la pestaña
  //    no existe. Mismo tropiezo que con `palabras\_clave` del catálogo.
  //  - `page_id` está en las DOS pestañas, así que buscar una sola columna
  //    engancha la tabla equivocada. Se exige que la cabecera tenga TODAS.
  const i = lineas.findIndex((l) => {
    const cols = l.replace(/\\/g, '').split('|').map((s) => s.trim());
    return columnas.every((c) => cols.includes(c));
  });
  if (i < 0) return null;
  const cab = lineas[i].split('|').map(limpiar);
  const idx = {};
  for (const c of columnas) idx[c] = cab.indexOf(c);
  const faltan = columnas.filter((c) => idx[c] < 0);
  if (faltan.length) return { error: 'faltan columnas: ' + faltan.join(', ') + ' — cabecera leída: ' + cab.filter(Boolean).join(', ') };

  const filas = [];
  for (let j = i + 1; j < lineas.length; j++) {
    const c = lineas[j].split('|').map(limpiar);
    if (c.length < 3) break;
    if (c.every((x) => !x || x === ':-:')) continue;
    const fila = {};
    for (const k of columnas) fila[k] = c[idx[k]] || '';
    if (!fila[columnas[0]]) break;                  // primera columna vacía = fin de la tabla
    if (fila[columnas[0]] === columnas[0]) continue; // cabecera repetida
    filas.push(fila);
  }
  return { filas };
}

const paginas  = tabla('page_id', ['page_id', 'nombre', 'activo']);
const anuncios = tabla('ad_id',   ['ad_id', 'page_id', 'story_id', 'producto_id', 'wa_destino', 'activo', 'nota']);

// FB_Anuncios SÍ es imprescindible. FB_Paginas no lo es para el ensayo (el
// ensayo recibe los anuncios en la petición y NO publica), así que su
// ausencia se avisa y se sigue, en vez de parar el ensayo entero por ella.
if (!anuncios || anuncios.error) { console.error('FB_Anuncios: ' + (anuncios ? anuncios.error : 'no encontrada')); process.exit(1); }

const si = (v) => String(v).trim().toUpperCase() === 'SI';

// El wa_destino real, para que el ensayo enseñe el enlace de verdad. Solo se
// usa donde la columna del Sheet está VACÍA, y se cuenta cuántas veces, que
// una caída a un valor por defecto tiene que avisar.
const WA_POR_DEFECTO = process.argv[3] || '';

if (!paginas || paginas.error) {
  console.log('⚠ FB_Paginas: ' + (paginas ? paginas.error : 'no aparece en el export') +
              '  (el ensayo no la necesita; PROD sí)');
} else {
  console.log('FB_Paginas: ' + paginas.filas.length + ' filas');
  for (const p of paginas.filas) console.log('   ' + (si(p.activo) ? 'SI ' : 'no ') + p.page_id + '  ' + p.nombre);
}

const a = anuncios.filas;
const conProd = a.filter((x) => x.producto_id);
const conWa   = a.filter((x) => x.wa_destino);
const listos  = a.filter((x) => x.producto_id && x.story_id && (x.wa_destino || WA_POR_DEFECTO));
const sinProducto = a.filter((x) => !x.producto_id);
console.log('');
console.log('FB_Anuncios: ' + a.length + ' filas');
console.log('   con producto_id .. ' + conProd.length);
console.log('   con wa_destino ... ' + conWa.length);
console.log('   activo=SI ........ ' + a.filter((x) => si(x.activo)).length);
console.log('   LISTOS para el ensayo (producto + wa + story) ... ' + listos.length);

const dest = {};
for (const x of conWa) dest[x.wa_destino] = (dest[x.wa_destino] || 0) + 1;
console.log('   destinos de WhatsApp usados:');
for (const [k, v] of Object.entries(dest)) console.log('      ' + k + '  ->  ' + v + ' anuncios');

fs.writeFileSync('fb/sheet-paginas.json', JSON.stringify((paginas && paginas.filas) || [], null, 1));
fs.writeFileSync('fb/sheet-anuncios.json', JSON.stringify(a, null, 1));

// Payload del ensayo: TODO lo que esté listo, encendido o no. El ensayo no
// publica, y el objetivo es justo ver qué diría antes de encender nada.
let puestosPorDefecto = 0;
fs.writeFileSync('fb/ensayo-payload.json', JSON.stringify({
  ventana_horas: 100000,
  anuncios: listos.map((x) => {
    if (!x.wa_destino) puestosPorDefecto++;
    return { ad_id: x.ad_id, page_id: x.page_id, story_id: x.story_id,
             producto_id: x.producto_id, wa_destino: x.wa_destino || WA_POR_DEFECTO };
  }),
}));
console.log('');
if (puestosPorDefecto) {
  console.log('⚠ ' + puestosPorDefecto + ' anuncios SIN wa_destino en el Sheet. Para el ENSAYO se ha');
  console.log('  usado ' + WA_POR_DEFECTO + '. En PROD esos anuncios NO se contestarían: avisarían.');
}
console.log('Escrito fb/ensayo-payload.json con ' + listos.length + ' anuncios.');

// La lista de los que no tienen producto: es una regla para quien redacta.
const csv = ['ad_id,page_id,comentarios,nombre_del_anuncio,motivo,primeras_palabras_del_cuerpo'];
const meta = new Map();
try {
  for (const x of JSON.parse(fs.readFileSync('fb/anuncios.json', 'utf8'))) meta.set(x.ad_id, x);
} catch (e) { /* sin metadatos, se listan igual */ }
for (const x of sinProducto.sort((p, q) => (meta.get(q.ad_id)?.comentarios || 0) - (meta.get(p.ad_id)?.comentarios || 0))) {
  const m = meta.get(x.ad_id) || {};
  const cuerpo = String(m.cuerpo || '').replace(/\s+/g, ' ').slice(0, 120);
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  csv.push([x.ad_id, x.page_id, m.comentarios || 0, m.nombre || '', x.nota || '', cuerpo].map(q).join(','));
}
fs.writeFileSync('fb/anuncios-sin-producto.csv', csv.join('\n'));
console.log('Escrito fb/anuncios-sin-producto.csv con ' + sinProducto.length + ' anuncios.');
