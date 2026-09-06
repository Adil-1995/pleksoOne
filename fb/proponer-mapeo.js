#!/usr/bin/env node
/**
 * Propone el mapeo anuncio -> producto para SEMBRAR el Sheet la primera vez.
 *
 *   node fb/proponer-mapeo.js <anuncios.json> <export-del-sheet.json>
 *
 * ⚠️ Esto empareja por TEXTO, y el agente NO lo hace: en marcha, el producto
 * sale del `ad_id` leyendo el Sheet, que es determinista. Aquí se empareja una
 * sola vez, y con una persona revisando, para no teclear 198 filas a mano.
 *
 * Cuando dos productos empatan, o ninguno encaja, la fila sale VACÍA y marcada
 * para que la rellenes tú. Un empate es una duda, y una duda no se rellena.
 */
'use strict';
const fs = require('fs');
const { normalizar } = require('./logica-comentarios.js');

const [, , fAnuncios, fSheet] = process.argv;
const anuncios = JSON.parse(fs.readFileSync(fAnuncios, 'utf8'));

// ── Catálogo: id -> palabras_clave, del export del Sheet ────────────────────
const texto = JSON.parse(fs.readFileSync(fSheet, 'utf8')).fileContent;
const lineas = texto.split('\n');
const iCab = lineas.findIndex((l) => l.includes('palabras\\_clave'));
if (iCab < 0) throw new Error('No encuentro la cabecera del catálogo en el export');

const productos = [];
for (let i = iCab + 1; i < lineas.length; i++) {
  const c = lineas[i].split('|').map((s) => s.trim());
  if (c.length < 5 || !c[1] || c[1] === ':-:' || c[1].includes('\\_')) break;
  const claves = c[4].split(',').map((s) => s.replace(/\\/g, '').trim()).filter(Boolean);
  if (!claves.length) continue;
  productos.push({ id: c[1], activo: c[2], nombre: c[3], claves });
}

// ── Emparejar. Gana el que sume más caracteres de palabra clave encontrada:
//    "filtro de agua" pesa más que "filtro", que aparece en varios sitios.
function emparejar(cuerpo) {
  const t = ' ' + normalizar(cuerpo) + ' ';
  const marcador = [];
  for (const p of productos) {
    let peso = 0, cuales = [];
    for (const k of p.claves) {
      const n = normalizar(k);
      if (n.length < 4) continue;                 // "luz", "kit": demasiado corto, empata con todo
      if (t.includes(' ' + n + ' ') || t.includes(' ' + n + ',') || t.includes(' ' + n + '.')) {
        peso += n.length; cuales.push(k);
      }
    }
    if (peso) marcador.push({ id: p.id, peso, cuales });
  }
  marcador.sort((a, b) => b.peso - a.peso);
  if (!marcador.length) return { id: '', motivo: 'ninguna palabra clave en el cuerpo' };
  if (marcador.length > 1 && marcador[0].peso === marcador[1].peso) {
    return { id: '', motivo: 'EMPATE entre ' + marcador.slice(0, 2).map((m) => m.id).join(' y ') };
  }
  return { id: marcador[0].id, motivo: '', pistas: marcador[0].cuales.join(', ') };
}

const filas = anuncios.map((a) => {
  const r = a.cuerpo && a.cuerpo !== '<<no se pudo leer>>'
    ? emparejar(a.cuerpo)
    : { id: '', motivo: 'sin cuerpo legible' };
  return { ...a, producto_id: r.id, revisar: r.motivo, pistas: r.pistas || '' };
});

// ── Salidas ─────────────────────────────────────────────────────────────────
const conProd = filas.filter((f) => f.producto_id);
const sinProd = filas.filter((f) => !f.producto_id);
const conCom  = filas.filter((f) => (f.comentarios || 0) > 0);

const tsv = ['ad_id\tpage_id\tstory_id\tproducto_id\twa_destino\tactivo\tnota'];
for (const f of filas.sort((a, b) => (b.comentarios || 0) - (a.comentarios || 0))) {
  tsv.push([f.ad_id, f.page_id, f.story_id, f.producto_id, '', 'no',
    (f.revisar ? '⚠ ' + f.revisar + ' — ' : '') + (f.comentarios || 0) + ' comentarios · ' + (f.nombre || '')].join('\t'));
}
fs.writeFileSync('fb/FB_Anuncios.tsv', tsv.join('\n'));

// Para el ensayo: solo los que tienen producto Y comentarios. Sin wa_destino
// real todavía: se pasa uno de prueba, que el ensayo no publica nada.
const paraEnsayo = conProd.filter((f) => (f.comentarios || 0) > 0)
  .map((f) => ({ ad_id: f.ad_id, page_id: f.page_id, story_id: f.story_id,
                 producto_id: f.producto_id, wa_destino: '5215591937975' }));
fs.writeFileSync('fb/ensayo-anuncios.json', JSON.stringify(paraEnsayo, null, 1));

console.log('Anuncios totales ................ ' + filas.length);
console.log('  con comentarios ............... ' + conCom.length + '  (' + conCom.reduce((s, f) => s + (f.comentarios || 0), 0) + ' comentarios)');
console.log('  producto propuesto ............ ' + conProd.length);
console.log('  SIN producto, los revisas tú .. ' + sinProd.length);
console.log('');
const porMotivo = {};
for (const f of sinProd) porMotivo[f.revisar] = (porMotivo[f.revisar] || 0) + 1;
for (const [k, v] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) console.log('    ' + String(v).padStart(4) + '  ' + k);
console.log('');
const porProd = {};
for (const f of conProd) porProd[f.producto_id] = (porProd[f.producto_id] || 0) + 1;
for (const [k, v] of Object.entries(porProd).sort((a, b) => b[1] - a[1])) console.log('    ' + String(v).padStart(4) + '  ' + k);
console.log('');
console.log('Escritos: fb/FB_Anuncios.tsv  y  fb/ensayo-anuncios.json (' + paraEnsayo.length + ' anuncios)');
