/**
 * Pruebas de la lógica del agente de comentarios.  node fb/pruebas-logica.mjs
 *
 * Los casos NO son inventados: casi todos salen de comentarios reales leídos
 * de los anuncios el 6/9/2026.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('./logica-comentarios.js');

let ok = 0, mal = 0;
const grupo = (t) => console.log('\n' + t);
function es(nombre, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log('  ok    ' + nombre); }
  else { mal++; console.log('  FALLA ' + nombre + '\n        esperado ' + b + '\n        recibido ' + a); }
}

const PAGE = '604752319885731';
const AHORA = Date.parse('2026-09-06T12:00:00Z');
const hace = (h) => new Date(AHORA - h * 3600000).toISOString();
const com = (o) => ({ id: 'c1', created_time: hace(1), ...o });
const entra = (o) => L.filtroEntrada(com(o), { ahora: AHORA, pageId: PAGE }).motivo;

grupo('filtro de entrada: lo que NO debe pasar');
es('comentario vacío (el sticker real)', entra({ message: '' }), 'vacio');
es('solo espacios',                      entra({ message: '   ' }), 'vacio');
es('solo emojis',                        entra({ message: '🔥🔥🔥' }), 'sin_texto');
es('una sola letra',                     entra({ message: 'k' }), 'demasiado_corto');
es('signos sueltos',                     entra({ message: '?!' }), 'demasiado_corto');
es('más viejo que la ventana',           entra({ message: 'Que precio tiene', created_time: hace(49) }), 'anterior_al_corte');
es('lo escribió una Página (spam)',      entra({ message: '欧洲COD 物流', from: { id: '999', name: 'Honeydiy' } }), 'es_una_pagina');
es('lo escribimos nosotros',             entra({ message: 'Hola 💛', from: { id: PAGE, name: 'Lado Luminoso' } }), 'es_nuestro');
es('trae un enlace',                     entra({ message: 'mira aqui https://otro.com' }), 'trae_enlace');
es('sin fecha',                          entra({ message: 'hola que tal', created_time: 'nada' }), 'sin_fecha');

grupo('filtro de entrada: idempotencia SIN tabla, la guarda Facebook');
es('ya le respondimos', entra({
  message: 'Que precio tiene',
  comments: { data: [{ id: 'r1', from: { id: PAGE }, created_time: hace(0.5) }] },
}), 'ya_respondido');
es('respondió otra página, no nosotros', entra({
  message: 'Que precio tiene',
  comments: { data: [{ id: 'r1', from: { id: '777' }, created_time: hace(0.5) }] },
}), null);

grupo('filtro de entrada: lo que SÍ pasa (comentarios reales)');
for (const t of ['Precio', 'CUÁNTO CUESTA', 'Que precio tiene', 'Precio xfavor',
                 'Cuánto $$$', 'Hello is this store still available?',
                 'Pero en ese lugar tapa el aire del clima .....',
                 'No lo compren no sirve y solo van a gastar su dinero en vano']) {
  es('pasa: ' + JSON.stringify(t.slice(0, 34)), entra({ message: t }), null);
}

grupo('validar lo que devuelve el modelo: ante la duda, otro');
const v = (x) => { const r = L.validarClasificacion(x); return [r.clase, r.idioma, r.campo]; };
es('json limpio',            v('{"clase":"precio","idioma":"es","campo":null}'), ['precio', 'es', null]);
es('json envuelto en texto', v('claro:\n{"clase":"queja","idioma":"es","campo":null}\n'), ['queja', 'es', null]);
es('no es json',             v('pues yo diría que es precio'), ['otro', 'es', null]);
es('clase inventada',        v('{"clase":"enfadado","idioma":"es"}'), ['otro', 'es', null]);
es('campo fuera de la lista',v('{"clase":"duda_producto","idioma":"es","campo":"precio"}'), ['duda_producto', 'es', null]);
es('idioma raro',            v('{"clase":"precio","idioma":"zh"}'), ['precio', 'es', null]);
es('null',                   v(null), ['otro', 'es', null]);

grupo('respuesta: la queja NUNCA contesta en público');
const prod = { medidas: '30 x 12 cm', garantia: '', entrega: '3 a 5 dias' };
const ENL = L.enlaceWa('5215591937975', 'cepillo alisador');
const resp = (c, extra = {}) => L.construirRespuesta(
  { clase: c, idioma: 'es', campo: extra.campo || null },
  { enlace: ENL, producto: prod, ...extra });
es('queja no publica',      resp('queja').texto, null);
es('queja avisa',           resp('queja').avisar, true);
es('otro no publica',       resp('otro').texto, null);
es('precio sí publica',     typeof resp('precio').texto, 'string');
es('duda con dato',         resp('duda_producto', { campo: 'medidas' }).valor, '30 x 12 cm');
es('duda con campo VACÍO cae a llevar al privado',
   resp('duda_producto', { campo: 'garantia' }).motivo, 'duda_sin_dato');
es('duda sin campo cae a llevar al privado',
   resp('duda_producto').motivo, 'duda_sin_dato');
es('duda en modo solo aviso', resp('duda_producto', { campo: 'medidas', modoDudaSoloAviso: true }).texto, null);

grupo('el enlace nombra el producto, o la ficha no se dispara');
es('lleva la palabra clave', decodeURIComponent(ENL).includes('cepillo alisador'), true);
es('va urlencoded',          ENL.includes('%20'), true);

grupo('filtro de salida: lo que sale en público no se retira');
const base = {
  enlace: ENL,
  precios: ['995', '1290'],
  palabrasClave: ['cepillo', 'cepillo alisador'],
  nombresOtrosProductos: ['Mini Luces LED Solares', 'Filtro Purificador de Agua'],
};
const bueno = L.PLANTILLAS.precio.es(ENL);
const fs = (t, extra = {}) => L.filtroSalida(t, { ...base, esperado: bueno, ...extra }).motivo;

es('la plantilla exacta pasa',        fs(bueno), null);
es('un solo carácter distinto muere', fs(bueno + ' '), 'no_coincide_con_la_plantilla');
es('texto libre muere',               fs('Hola! cuesta $995 ' + ENL), 'no_coincide_con_la_plantilla');
// sin `esperado` se prueban las reglas de contenido, que sobreviven al día
// en que haya texto que no salga de una plantilla
const fc = (t) => L.filtroSalida(t, { ...base, esperado: null }).motivo;
es('lleva $995',                fc('Hola, cuesta $995 ' + ENL), 'lleva_signo_de_precio');
es('lleva el precio sin signo', fc('Hola, son 995 ' + ENL), 'lleva_un_precio_del_catalogo');
es('dice la palabra precio',    fc('Te paso el precio ' + ENL), 'menciona_precio_u_oferta');
es('dice oferta',               fc('Está en oferta ' + ENL), 'menciona_precio_u_oferta');
es('menciona el catálogo',      fc('Según nuestro catálogo ' + ENL), 'menciona_algo_interno');
es('sin enlace',                fc('Te atendemos por WhatsApp'), 'falta_el_enlace');
es('dos enlaces',               fc('mira ' + ENL + ' y https://x.com'), 'mas_de_un_enlace');
es('menciona otro producto',    fc('Mini Luces LED Solares ' + ENL), 'menciona_otro_producto');
es('demasiado largo',           fc('a'.repeat(420) + ' ' + ENL), 'demasiado_largo');
es('enlace que no nombra el producto',
   L.filtroSalida(L.PLANTILLAS.precio.es(L.enlaceWa('521', 'hola')),
     { ...base, esperado: null, enlace: L.enlaceWa('521', 'hola') }).motivo,
   'el_enlace_no_nombra_el_producto');

grupo('límite por anuncio: se cuenta sobre Facebook, sin tabla');
const conRespuestas = (n, h) => [{
  comments: { data: Array.from({ length: n }, () => ({ from: { id: PAGE }, created_time: hace(h) })) },
}];
es('5 respuestas en la última hora', L.respuestasNuestrasDesde(conRespuestas(5, 0.5), PAGE, AHORA - 3600000), 5);
es('las de hace 3 h no cuentan',     L.respuestasNuestrasDesde(conRespuestas(5, 3), PAGE, AHORA - 3600000), 0);
es('las de otra página no cuentan',
   L.respuestasNuestrasDesde([{ comments: { data: [{ from: { id: 'x' }, created_time: hace(0.1) }] } }], PAGE, AHORA - 3600000), 0);

console.log('\n' + (mal ? `${mal} FALLAN, ${ok} bien` : `Todo en orden. ${ok} comprobaciones.`));
process.exit(mal ? 1 : 0);
