#!/usr/bin/env node
/**
 * Construye los workflows del agente de comentarios de Facebook.
 *
 *   node construir-comentarios-fb.js
 *
 * Emite en workflows/:
 *   comentarios-fb-salida.json   subflujo, PUNTO ÚNICO de publicación
 *   comentarios-fb-ensayo.json   ciclo en seco, SIN nodo de publicación
 *   comentarios-fb-prod.json     el de verdad, cron cada 10 min
 *
 * La lógica NO se escribe aquí: se lee de fb/logica-comentarios.js y se
 * incrusta en los nodos Code. Una sola fuente, para que el CSV que apruebas
 * en el ensayo pruebe de verdad lo que hará producción.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DOC_SHEET   = '1NKp7pJ-Fx-yE8IKM-Kgy_cB7d9ToVd6ECyNybDteUPQ';
const CRED_SHEETS = { googleApi: { id: 'aRfirRPV9iB2zikq', name: 'Google Sheets account' } };
const CRED_OPENAI = { openAiApi: { id: 'sxah8myyKfHWnrCY', name: 'OpenAI account' } };
const CRED_FB     = { httpHeaderAuth: { id: 'FB_CRED_ID', name: 'FB Comments Responder' } };
const MODELO      = 'gpt-5.6-sol';
const API_FB      = 'https://graph.facebook.com/v23.0';
const SETTINGS    = { executionOrder: 'v1', availableInMCP: false };

const LOGICA = fs.readFileSync(path.join(__dirname, 'fb', 'logica-comentarios.js'), 'utf8')
  .replace(/^'use strict';\s*$/m, '')
  .replace(/^module\.exports[\s\S]*$/m, '')
  .trim();

const cab = (t) =>
  `// ${t}\n` +
  `// ────────────────────────────────────────────────────────────────────\n` +
  `// Lógica INCRUSTADA desde fb/logica-comentarios.js. No la edites aquí:\n` +
  `// edita el fichero y relanza construir-comentarios-fb.js, o el ensayo y\n` +
  `// producción dejarán de decir lo mismo.\n` +
  `// ────────────────────────────────────────────────────────────────────\n\n` +
  LOGICA + '\n\n// ── Nodo ────────────────────────────────────────────────\n';

const id = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');
const code   = (name, p, js)      => ({ id: id(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: p, parameters: { jsCode: js } });
const httpN  = (name, p, par, cr) => { const n = { id: id(name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: p, parameters: par }; if (cr) n.credentials = cr; return n; };
const sheet  = (name, p, par)     => ({ id: id(name), name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: p, parameters: par, credentials: CRED_SHEETS });
const nota   = (k, p, w, h, txt)  => ({ id: 'nota-' + k, name: 'Nota ' + k, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: p, parameters: { width: w, height: h, content: txt } });
const noOp   = (name, p)          => ({ id: id(name), name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: p, parameters: {} });
const ifNode = (name, p, izq, op, der) => ({
  id: id(name), name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: p,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: id(name) + '-c', leftValue: izq, rightValue: der,
      operator: op === 'notEmpty' ? { type: 'string', operation: 'notEmpty', singleValue: true }
              : op === 'true'     ? { type: 'boolean', operation: 'true', singleValue: true }
              : { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} } });

function conectar(pares) {
  const c = {};
  for (const [de, a, salida = 0] of pares) {
    c[de] = c[de] || { main: [] };
    while (c[de].main.length <= salida) c[de].main.push([]);
    c[de].main[salida].push({ node: a, type: 'main', index: 0 });
  }
  return c;
}

// ════════════════════════════════════════════════════════════════════════════
// Código compartido
// ════════════════════════════════════════════════════════════════════════════

const JS_TOKEN_A_ANUNCIOS = `// Expande a una fila por anuncio, cada una con el token de SU página.
const tokens = $input.all();
const ciclos = $('Ciclo').all();
const salida = [];
for (let i = 0; i < ciclos.length; i++) {
  const c = ciclos[i].json;
  const t = tokens[i] && tokens[i].json;
  if (!t || !t.access_token) {
    throw new Error('La página ' + c.page_id + ' no devolvió access_token. ' +
      '¿Sigue asignada al usuario de sistema con la tarea MODERATE?');
  }
  for (const a of c.anuncios) {
    // UN POST, UNA VEZ. Medido el 6/9/2026: 12 anuncios daban solo 10 posts
    // distintos, porque varios anuncios (copias del mismo creativo) apuntan
    // al MISMO post oscuro. Esto ahorra la llamada; la deduplicación DE
    // VERDAD la hace 'Juntar comentarios', porque dos posts con id distinto
    // pueden devolver el mismo conjunto de comentarios y eso aquí no se sabe.
    const suf = String(a.story_id).split('_')[1];
    const yaEsta = salida.find(s => String(s.json.story_id).split('_')[1] === suf);
    if (yaEsta) {
      if (yaEsta.json.producto_id !== a.producto_id) {
        throw new Error('El post ' + a.story_id + ' lo comparten los anuncios ' + yaEsta.json.ad_id +
          ' y ' + a.ad_id + ', pero con productos distintos (' + yaEsta.json.producto_id + ' vs ' +
          a.producto_id + '). Arréglalo en el Sheet: no puedo elegir por ti.');
      }
      continue;
    }
    salida.push({ json: { ...a, page_id: c.page_id, ventana_horas: c.ventana_horas, page_token: t.access_token } });
  }
}
if (!salida.length) throw new Error('Ningún anuncio que mirar después de resolver los tokens.');
return salida;`;

const JS_JUNTAR = `// CASAR CADA RESPUESTA CON SU ANUNCIO, Y DEDUPLICAR POR CONJUNTO REAL.
//
// ⚠️ Lo que se descubrió el 6/9/2026 midiendo, y que no está en ninguna
// documentación: el id de un comentario NO empieza por el id del post que has
// pedido. Empieza por el id del OBJETO MULTIMEDIA:
//
//   pides  ...1703257091504796  ->  comentarios con prefijo 1699707728526399
//   pides  ...1699707728526399  ->  comentarios con prefijo 1699707728526399
//   pides  ...1715467166950455  ->  comentarios con prefijo 1656915486138957
//
// O sea que DOS POSTS DISTINTOS DEVUELVEN LOS MISMOS COMENTARIOS cuando
// reutilizan el mismo creativo. Deduplicar por story_id NO basta: hay que
// deduplicar por el conjunto de comentarios de verdad, que solo se conoce
// después de leerlo. Sin esto se contesta dos y tres veces al mismo
// comentario, desde anuncios distintos, y en público.
//
// El emparejado por índice SÍ es correcto (n8n devuelve una respuesta por
// item y en orden), pero se comprueba en vez de suponerlo.
const anuncios = $('Anuncios con token').all().map(i => i.json);
const res = $input.all();
if (res.length !== anuncios.length) {
  throw new Error('Llegaron ' + res.length + ' respuestas para ' + anuncios.length +
    ' anuncios. No sigo: emparejar a ciegas mandaría el enlace de otro producto.');
}

const salida = [];
const conjuntos = new Map();
for (let i = 0; i < anuncios.length; i++) {
  const a = anuncios[i];
  const r = (res[i] && res[i].json) || { data: [] };
  const datos = r.data || [];
  if (!datos.length) continue;                    // sin comentarios: no aporta nada

  const conjunto = String(datos[0].id).split('_')[0];
  const ya = conjuntos.get(conjunto);
  if (ya) {
    if (ya.producto_id !== a.producto_id) {
      throw new Error('Los anuncios ' + ya.ad_id + ' y ' + a.ad_id + ' comparten los MISMOS ' +
        'comentarios pero tienen productos distintos en el Sheet (' + ya.producto_id + ' vs ' +
        a.producto_id + '). Arréglalo: no puedo elegir por ti.');
    }
    continue;                                     // mismo conjunto, ya procesado
  }
  conjuntos.set(conjunto, a);
  salida.push({ json: { ...a, conjunto, respuesta: r } });
}
return salida;`;

const JS_ENTRADA = cab('FILTRO DE ENTRADA + LÍMITE POR ANUNCIO') + `
// Emite TODOS los comentarios, los que pasan y los que no, con \`pasa\`.
// Así este nodo se ejecuta siempre y cualquiera aguas abajo puede
// referenciarlo sin miedo: el fallo nº1 del 22/8 fue justo referenciar un
// nodo que en esa rama no se había ejecutado.
const ahora = Date.now();
const fuera = [];

// TOPE DE TODO EL CICLO, además del de cada anuncio. Estaba declarado en la
// lógica y NO se aplicaba en ninguna parte: con 20 anuncios activos y 5 de
// cupo cada uno salían 100 respuestas en un ciclo, que es exactamente la
// automatización agresiva que se quería evitar. Un límite declarado y no
// aplicado es peor que no tenerlo, porque se cuenta con él.
let cupoCiclo = LIMITE_CICLO;

// OJO: se lee de 'Juntar comentarios' POR NOMBRE, no de $input. Este nodo
// cuelga de 'Leer Catalogo' (que va antes solo para que el catálogo esté
// disponible más abajo), así que $input serían las filas del catálogo y este
// bucle daría CERO comentarios sin un solo error. Es exactamente el aviso de
// CLAUDE.md: $json se rompe al insertar nodos, referencia la fuente por nombre.
for (const item of $('Juntar comentarios').all()) {
  const d = item.json;
  const comentarios = (d.respuesta && d.respuesta.data) || [];
  const pageId = String(d.page_id);

  // LÍMITE POR ANUNCIO, contado sobre Facebook: se cuentan nuestras propias
  // respuestas ya publicadas. Sin tabla y sin contador que se desincronice.
  // La distribución medida es 109, 76, 18, 15, 8, 3, 3, 3, 2 y CERO en cinco
  // anuncios: un límite global no serviría de nada.
  const enHora = respuestasNuestrasDesde(comentarios, pageId, ahora - 3600000);
  const enDia  = respuestasNuestrasDesde(comentarios, pageId, ahora - 86400000);
  let cupo = Math.min(LIMITE_ANUNCIO_HORA - enHora, LIMITE_ANUNCIO_DIA - enDia);

  for (const c of comentarios) {
    const base = {
      ad_id: d.ad_id, page_id: pageId, producto_id: d.producto_id,
      wa_destino: d.wa_destino, comment_id: c.id, texto: c.message || '',
      creado_en: c.created_time || '',
    };
    const r = filtroEntrada(c, { ahora, pageId, ventanaHoras: d.ventana_horas || VENTANA_HORAS });
    if (!r.pasa) { fuera.push({ ...base, pasa: false, motivo: r.motivo }); continue; }
    if (cupo <= 0) {
      // APLAZADO, no descartado: si se descartara por límite se perderían
      // justo los comentarios del anuncio que funciona.
      fuera.push({ ...base, pasa: false, motivo: 'aplazado_por_limite' });
      continue;
    }
    if (cupoCiclo <= 0) {
      fuera.push({ ...base, pasa: false, motivo: 'aplazado_por_limite_del_ciclo' });
      continue;
    }
    cupo--; cupoCiclo--;
    fuera.push({ ...base, pasa: true, motivo: null });
  }
}
return fuera.map(json => ({ json }));`;

const JS_DECIDIR = (modoDuda) => cab('DECIDIR Y FILTRAR LA SALIDA') + `
// El modelo ya ha hablado, y a partir de aquí manda el FLUJO (regla 5).
// El modelo no ha escrito ni una palabra de lo que se publica.
const catalogo = $('Leer Catalogo').all().map(i => i.json);
const porId   = new Map(catalogo.map(p => [String(p.id || '').trim(), p]));
const precios = catalogo.map(p => p.precio).filter(Boolean);
const nombres = catalogo.map(p => p.nombre).filter(Boolean);

const MODO_QUEJA_SOLO_AVISO = true;          // nunca se discute en público
const MODO_DUDA_SOLO_AVISO  = ${modoDuda};   // se le suelta la correa cuando acierte

// Los que llegaron aquí son EXACTAMENTE los que pasaron el filtro, en orden.
const origen = $('Filtro de entrada').all().map(i => i.json).filter(x => x.pasa);
const clasificaciones = $input.all();

const fuera = [];
for (let i = 0; i < origen.length; i++) {
  const base = origen[i];
  const cruda = clasificaciones[i] ? clasificaciones[i].json : null;

  const producto = porId.get(String(base.producto_id).trim());
  if (!producto) { fuera.push({ ...base, accion: 'no_publica', motivo: 'producto_no_esta_en_el_catalogo', texto_respuesta: '', texto_bloqueado: '' }); continue; }

  const claves = String(producto.palabras_clave || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!claves.length) { fuera.push({ ...base, accion: 'no_publica', motivo: 'producto_sin_palabras_clave', texto_respuesta: '', texto_bloqueado: '' }); continue; }

  const cls = validarClasificacion(cruda && (cruda.text ?? cruda.output ?? cruda.response ?? cruda));
  const enlace = enlaceWa(base.wa_destino, claves[0]);
  const ctx = { enlace, producto, modoQuejaSoloAviso: MODO_QUEJA_SOLO_AVISO, modoDudaSoloAviso: MODO_DUDA_SOLO_AVISO };

  const r = construirRespuesta(cls, ctx);
  const comun = { ...base, clase: cls.clase, idioma: cls.idioma, campo: cls.campo, degradado: cls.degradado || '' };

  if (!r.texto) {
    fuera.push({ ...comun, accion: r.avisar ? 'solo_aviso' : 'no_publica', motivo: r.motivo, texto_respuesta: '', texto_bloqueado: '' });
    continue;
  }

  // RE-RENDERIZAR desde cero y exigir IDÉNTICO. Si alguien mete texto libre
  // por cualquier vía, muere aquí. Lo que sale en público no se retira.
  const esperado = construirRespuesta(cls, ctx).texto;
  const f = filtroSalida(r.texto, {
    enlace, precios, palabrasClave: claves,
    nombresOtrosProductos: nombres.filter(n => n !== producto.nombre),
    esperado,
  });

  fuera.push({ ...comun,
    accion: f.pasa ? 'publica' : 'bloqueado', motivo: f.motivo,
    texto_respuesta: f.pasa ? r.texto : '', texto_bloqueado: f.pasa ? '' : r.texto });
}
return fuera.map(json => ({ json }));`;

const PROMPT_NODO = '=' + LOGICA.match(/const PROMPT_CLASIFICADOR = `([\s\S]*?)`;/)[1]
  .replace(/\{/g, '{').trim() + '\n{{ $json.texto }}';

const nodoModelo = (p) => ({ id: 'modelo', name: 'Modelo', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  typeVersion: 1.3, position: p,
  // Sin `temperature` ni `maxTokens`: gpt-5.6-sol los rechaza con
  // «Unsupported parameter: 'temperature' is not supported with this model».
  // El determinismo no se busca bajando la temperatura, se busca en el
  // validador: cualquier salida rara cae a `otro` y `otro` no publica.
  parameters: { model: { __rl: true, value: MODELO, mode: 'list', cachedResultName: MODELO }, options: {} },
  credentials: CRED_OPENAI });

const nodoClasificar = (p) => ({ id: 'clasificar', name: 'Clasificar', type: '@n8n/n8n-nodes-langchain.chainLlm',
  typeVersion: 1.7, position: p,
  parameters: { promptType: 'define', text: PROMPT_NODO,
    batching: { batchSize: 1, delayBetweenBatches: 300 } } });

const nodoLeerComentarios = (p) => httpN('Leer comentarios', p, {
  url: `=${API_FB}/{{ $json.story_id }}/comments`,
  sendQuery: true,
  queryParameters: { parameters: [
    { name: 'filter', value: 'toplevel' },
    { name: 'limit',  value: '100' },
    { name: 'fields', value: 'id,message,created_time,from,comments.limit(25){id,from,created_time}' },
  ] },
  sendHeaders: true,
  headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $json.page_token }}' }] },
  options: {},
});

const nodoCatalogo = (p) => sheet('Leer Catalogo', p, {
  documentId: { __rl: true, value: DOC_SHEET, mode: 'id' },
  sheetName:  { __rl: true, value: 'Productos', mode: 'name' },
  authentication: 'serviceAccount', options: {},
});

// ════════════════════════════════════════════════════════════════════════════
// 1. SUBFLUJO DE SALIDA
// ════════════════════════════════════════════════════════════════════════════
function salida() {
  const nodes = [
    nota('s', [200, 60], 1500, 210,
      '## Comentarios FB — Salida\n\n' +
      '**El ÚNICO sitio de todo el proyecto que publica en Facebook.**\n\n' +
      'El grafo es LINEAL a propósito: un subflujo devuelve al padre lo que salga del ÚLTIMO nodo ejecutado ' +
      '(`lastNodeExecuted`). Colgar una rama de aviso en paralelo la convierte en la última, devuelve cero ' +
      'items y el padre muere en verde y sin error. Costó una tarde el 22/8.\n\n' +
      '⚠️ Un **PUT** sobre este subflujo lo DESPUBLICA y tumba en cascada a quien lo llama.\n' +
      'Orden obligatorio: activar ESTE primero, después el padre, y comprobar que responde de verdad.'),

    { id: 'entrada', name: 'Entrada', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1, position: [260, 340], parameters: {} },

    code('Validar peticion', [480, 340], `// CONTRATO DEL PUNTO ÚNICO.
const p = $input.first().json || {};

// Se exige TODO, sin excepciones por tipo de acción. La lección del 22/8 fue
// exactamente esta: un campo que no se exigía en una rama, un valor por
// defecto silencioso, y el canal 1 "funcionando" por casualidad.
const faltan = ['page_id', 'comment_id', 'texto'].filter(k => !p[k] || !String(p[k]).trim());
if (faltan.length) throw new Error('Salida FB: faltan campos obligatorios: ' + faltan.join(', '));
if (String(p.texto).length > 400) throw new Error('Salida FB: texto de más de 400 caracteres, no se publica');

// Cinturón y tirantes: aunque el padre ya lo filtró, aquí NO pasa un precio.
if (/\\$\\s?\\d/.test(p.texto)) throw new Error('Salida FB: el texto lleva un precio. No se publica.');
if (!/https:\\/\\/wa\\.me\\//.test(p.texto)) throw new Error('Salida FB: el texto no lleva enlace de WhatsApp.');

return [{ json: { page_id: String(p.page_id), comment_id: String(p.comment_id), texto: String(p.texto),
  ad_id: p.ad_id || '', clase: p.clase || '', producto_id: p.producto_id || '' } }];`),

    httpN('Token de pagina', [700, 340], {
      // OJO: sin estas DOS líneas el nodo HTTP de n8n IGNORA la credencial
      // adjunta y manda la petición sin cabecera. Graph responde entonces
      // «(#200) Provide valid app ID», que suena a app mal configurada y en
      // realidad es «no me has mandado token». Nos costó una vuelta entera.
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      url: `=${API_FB}/{{ $json.page_id }}?fields=access_token`, options: {},
    }, CRED_FB),

    code('Preparar publicacion', [920, 340], `const t = $input.first().json;
if (!t || !t.access_token) throw new Error('Salida FB: la página no devolvió access_token.');
return [{ json: { ...$('Validar peticion').first().json, page_token: t.access_token } }];`),

    httpN('Publicar respuesta', [1140, 340], {
      method: 'POST', url: `=${API_FB}/{{ $json.comment_id }}/comments`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $json.page_token }}' }] },
      sendBody: true, contentType: 'form-urlencoded',
      bodyParameters: { parameters: [{ name: 'message', value: '={{ $json.texto }}' }] },
      options: {},
    }),

    sheet('Registrar en Log', [1360, 340], {
      operation: 'append',
      documentId: { __rl: true, value: DOC_SHEET, mode: 'id' },
      sheetName:  { __rl: true, value: 'FB_Log', mode: 'name' },
      authentication: 'serviceAccount',
      columns: { mappingMode: 'defineBelow', value: {
        fecha: '={{ $now.toISO() }}',
        page_id:      "={{ $('Preparar publicacion').first().json.page_id }}",
        ad_id:        "={{ $('Preparar publicacion').first().json.ad_id }}",
        producto_id:  "={{ $('Preparar publicacion').first().json.producto_id }}",
        comment_id:   "={{ $('Preparar publicacion').first().json.comment_id }}",
        clase:        "={{ $('Preparar publicacion').first().json.clase }}",
        accion: 'publicado',
        texto:        "={{ $('Preparar publicacion').first().json.texto }}",
        respuesta_id: '={{ $json.id }}',
      }, matchingColumns: [] },
      options: {},
    }),

    code('Devolver', [1580, 340], `// ÚLTIMO NODO SIEMPRE: es lo que recibe el padre (lastNodeExecuted).
const pub = $('Publicar respuesta').first().json || {};
const p = $('Preparar publicacion').first().json;
return [{ json: { ok: !!pub.id, respuesta_id: pub.id || null, comment_id: p.comment_id } }];`),
  ];

  return { name: 'Comentarios FB — Salida', nodes, settings: SETTINGS, connections: conectar([
    ['Entrada', 'Validar peticion'], ['Validar peticion', 'Token de pagina'],
    ['Token de pagina', 'Preparar publicacion'], ['Preparar publicacion', 'Publicar respuesta'],
    ['Publicar respuesta', 'Registrar en Log'], ['Registrar en Log', 'Devolver'],
  ]) };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. ENSAYO — sin nodo de publicación
// ════════════════════════════════════════════════════════════════════════════
function ensayo() {
  const nodes = [
    nota('e', [180, 40], 1700, 250,
      '## Comentarios FB — Ensayo · CICLO EN SECO\n\n' +
      '**Hace TODO menos publicar.** No existe ningún nodo que escriba en Facebook, ni llamada al subflujo ' +
      'de salida. Aunque alguien lo active por error, es incapaz de publicar.\n\n' +
      'Sirve para leer en un CSV qué contestaría a cada comentario REAL antes de dejarle hablar.\n\n' +
      '```\nPOST /webhook/fb-ensayo\n{ "ventana_horas": 2400,\n  "anuncios": [ {"ad_id":"...","page_id":"...","story_id":"...","producto_id":"...","wa_destino":"..."} ] }\n```\n\n' +
      'La ventana va en la petición para poder barrer los comentarios viejos, que en producción quedan fuera por las 48 h.'),

    { id: 'webhook', name: 'Webhook ensayo', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [240, 400],
      webhookId: 'a7f1c0de-fb00-4e00-9000-comentariosfb1', parameters: { httpMethod: 'POST', path: 'fb-ensayo', responseMode: 'responseNode', options: {} } },

    code('Ciclo', [460, 400], `// De dónde salen los anuncios: de la PETICIÓN, para poder ensayar sin que
// exista todavía el Sheet.
const body = $input.first().json.body || {};
const anuncios = Array.isArray(body.anuncios) ? body.anuncios : [];
if (!anuncios.length) throw new Error('Ensayo: no me has pasado ningún anuncio en "anuncios".');
const ventana = Number(body.ventana_horas) || 2400;

const paginas = [...new Set(anuncios.map(a => String(a.page_id)))];
return paginas.map(page_id => ({ json: {
  page_id, ventana_horas: ventana,
  anuncios: anuncios.filter(a => String(a.page_id) === page_id),
} }));`),

    httpN('Token de pagina', [680, 400], {
      // OJO: sin estas DOS líneas el nodo HTTP de n8n IGNORA la credencial
      // adjunta y manda la petición sin cabecera. Graph responde entonces
      // «(#200) Provide valid app ID», que suena a app mal configurada y en
      // realidad es «no me has mandado token». Nos costó una vuelta entera.
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      url: `=${API_FB}/{{ $json.page_id }}?fields=access_token`, options: {},
    }, CRED_FB),
    code('Anuncios con token', [900, 400], JS_TOKEN_A_ANUNCIOS),
    nodoLeerComentarios([1120, 400]),
    code('Juntar comentarios', [1340, 400], JS_JUNTAR),
    nodoCatalogo([1340, 660]),
    code('Filtro de entrada', [1560, 400], JS_ENTRADA),
    ifNode('Hay algo que clasificar', [1780, 400], '={{ $json.pasa }}', 'true', ''),
    nodoClasificar([2000, 300]),
    nodoModelo([2000, 560]),
    code('Decidir y filtrar', [2220, 300], JS_DECIDIR('true')),

    code('Armar CSV', [2460, 400], `// El CSV. Los DESCARTADOS también van: si el agente calla algo que debía
// contestar, la explicación tiene que estar aquí y no en un log que se rota.
// Se lee de 'Filtro de entrada', que se ejecuta SIEMPRE, así que esta
// referencia es segura venga por la rama que venga.
function q(v) {
  const s = String(v == null ? '' : v).replace(/\\r?\\n/g, ' ').trim();
  return '"' + s.replace(/"/g, '""') + '"';
}
const COLS = ['ad_id','producto_id','comment_id','creado_en','comentario','clase','idioma','campo','accion','motivo','respuesta_que_publicaria','texto_bloqueado'];

const decisiones = new Map();
for (const i of $input.all()) {
  const d = i.json;
  if (d && d.comment_id && d.accion) decisiones.set(d.comment_id, d);
}

const filas = [COLS.join(',')];
const cuenta = {};
for (const i of $('Filtro de entrada').all()) {
  const b = i.json;
  const d = decisiones.get(b.comment_id);
  const accion = d ? d.accion : 'descartado';
  const motivo = d ? (d.motivo || '') : b.motivo;
  const k = accion === 'descartado' ? 'descartado: ' + motivo : accion;
  cuenta[k] = (cuenta[k] || 0) + 1;
  filas.push([b.ad_id, b.producto_id, b.comment_id, b.creado_en, b.texto,
    d ? d.clase : '', d ? d.idioma : '', d ? d.campo : '',
    accion, motivo, d ? d.texto_respuesta : '', d ? d.texto_bloqueado : ''].map(q).join(','));
}

const resumen = Object.entries(cuenta).sort((a,b) => b[1]-a[1])
  .map(([k,v]) => '# ' + k + ': ' + v).join('\\n');
return [{ json: { csv: filas.join('\\n') + '\\n' + resumen, total: filas.length - 1, cuenta } }];`),

    { id: 'responder', name: 'Responder', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [2680, 400],
      parameters: { respondWith: 'text', responseBody: '={{ $json.csv }}',
        options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/csv; charset=utf-8' }] } } } },
  ];

  const conns = conectar([
    ['Webhook ensayo', 'Ciclo'], ['Ciclo', 'Token de pagina'],
    ['Token de pagina', 'Anuncios con token'], ['Anuncios con token', 'Leer comentarios'],
    ['Leer comentarios', 'Juntar comentarios'], ['Juntar comentarios', 'Leer Catalogo'],
    ['Leer Catalogo', 'Filtro de entrada'], ['Filtro de entrada', 'Hay algo que clasificar'],
    ['Hay algo que clasificar', 'Clasificar', 0],
    ['Hay algo que clasificar', 'Armar CSV', 1],
    ['Clasificar', 'Decidir y filtrar'], ['Decidir y filtrar', 'Armar CSV'],
    ['Armar CSV', 'Responder'],
  ]);
  conns['Modelo'] = { ai_languageModel: [[{ node: 'Clasificar', type: 'ai_languageModel', index: 0 }]] };
  return { name: 'Comentarios FB — Ensayo', nodes, settings: SETTINGS, connections: conns };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. PROD
// ════════════════════════════════════════════════════════════════════════════
function prod() {
  const nodes = [
    nota('p', [180, 40], 1700, 260,
      '## Comentarios FB — PROD\n\n' +
      'Responde comentarios en los ANUNCIOS (posts oscuros: `is_published:false`, no salen en `/page/posts`).\n\n' +
      '**Sondeo cada 10 min y no webhook.** El webhook `feed` también los trae — la documentación es literal: ' +
      '«Webhooks are not sent for Ad Posts, but are sent for Comments on Ad Posts» — pero su ENTREGA no se ha ' +
      'visto funcionar nunca aquí, y el sondeo trae de serie el retraso y el límite que queremos.\n\n' +
      '**Ninguna página contesta hasta que la pongas a SI en el Sheet `FB_Paginas`.** Por defecto, ninguna.\n\n' +
      '⚠️ No toca ninguno de los cuatro workflows de WhatsApp. Publicar va SIEMPRE por `Comentarios FB — Salida`.'),

    { id: 'cron', name: 'Cada 10 minutos', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [240, 400],
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } } },

    sheet('Leer Paginas', [460, 400], {
      documentId: { __rl: true, value: DOC_SHEET, mode: 'id' },
      sheetName:  { __rl: true, value: 'FB_Paginas', mode: 'name' },
      authentication: 'serviceAccount', options: {} }),

    sheet('Leer Anuncios', [680, 400], {
      documentId: { __rl: true, value: DOC_SHEET, mode: 'id' },
      sheetName:  { __rl: true, value: 'FB_Anuncios', mode: 'name' },
      authentication: 'serviceAccount', options: {} }),

    code('Ciclo', [900, 400], `// Qué anuncios se miran. Del Sheet, no de una variable global: es la
// lección del CAPI_DATASET, donde un valor único para dos canales acertaba
// por azar en uno y mentía en el otro.
const paginas  = $('Leer Paginas').all().map(i => i.json);
const anuncios = $('Leer Anuncios').all().map(i => i.json);
const si = (v) => String(v == null ? '' : v).trim().toUpperCase() === 'SI';

// CONTROL POR PÁGINA. Por defecto NINGUNA contesta: solo las marcadas a SI.
const activas = new Set(paginas.filter(p => si(p.activo)).map(p => String(p.page_id).trim()));

const problemas = [];
const buenos = [];
for (const a of anuncios) {
  if (!si(a.activo)) continue;
  const page_id = String(a.page_id || '').trim();
  if (!activas.has(page_id)) continue;              // página apagada: ni se mira
  // Una caída a un valor por defecto TIENE que avisar.
  if (!String(a.producto_id || '').trim()) { problemas.push(a.ad_id + ' — sin producto_id'); continue; }
  if (!String(a.wa_destino || '').trim())  { problemas.push(a.ad_id + ' — sin wa_destino');  continue; }
  if (!String(a.story_id   || '').trim())  { problemas.push(a.ad_id + ' — sin story_id');    continue; }
  buenos.push({ ad_id: String(a.ad_id).trim(), page_id, story_id: String(a.story_id).trim(),
                producto_id: String(a.producto_id).trim(), wa_destino: String(a.wa_destino).trim() });
}
if (!buenos.length) return [];

const porPagina = [...new Set(buenos.map(a => a.page_id))];
return porPagina.map(page_id => ({ json: {
  page_id, ventana_horas: VENTANA_HORAS,
  anuncios: buenos.filter(a => a.page_id === page_id),
  __problemas: problemas,
} }));`.replace('VENTANA_HORAS', '48')),

    httpN('Token de pagina', [1120, 400], {
      // OJO: sin estas DOS líneas el nodo HTTP de n8n IGNORA la credencial
      // adjunta y manda la petición sin cabecera. Graph responde entonces
      // «(#200) Provide valid app ID», que suena a app mal configurada y en
      // realidad es «no me has mandado token». Nos costó una vuelta entera.
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      url: `=${API_FB}/{{ $json.page_id }}?fields=access_token`, options: {},
    }, CRED_FB),
    code('Anuncios con token', [1340, 400], JS_TOKEN_A_ANUNCIOS),
    nodoLeerComentarios([1560, 400]),
    code('Juntar comentarios', [1780, 400], JS_JUNTAR),
    nodoCatalogo([1780, 660]),
    code('Filtro de entrada', [2000, 400], JS_ENTRADA),
    ifNode('Hay algo que clasificar', [2220, 400], '={{ $json.pasa }}', 'true', ''),
    nodoClasificar([2440, 300]),
    nodoModelo([2440, 580]),
    code('Decidir y filtrar', [2660, 300], JS_DECIDIR('true')),
    ifNode('Publica?', [2880, 300], '={{ $json.accion }}', 'equals', 'publica'),

    { id: 'espera', name: 'Esperar un poco', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [3100, 220],
      webhookId: 'b8e2d1ef-fb00-4e00-9000-comentariosfb2',
      // Retraso ALEATORIO: cinco respuestas idénticas en el mismo segundo es
      // la huella de automatización agresiva que penaliza la página.
      parameters: { amount: '={{ Math.floor(Math.random() * 8) + 3 }}', unit: 'minutes' } },

    { id: 'publicar', name: 'Publicar (punto unico)', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1, position: [3320, 220],
      parameters: { workflowId: 'ID_SALIDA', options: { waitForSubWorkflow: true } } },

    code('Avisar', [3540, 400], `// Rama de aviso que VUELVE al camino: nada de ramas terminales paralelas.
// Se lee de nodos que se ejecutan SIEMPRE ('Ciclo' y 'Filtro de entrada'),
// nunca de uno que puede no haber corrido en esta rama.
const problemas = ($('Ciclo').first().json.__problemas) || [];
const avisos = [];

for (const i of $input.all()) {
  const d = i.json || {};
  if (d.clase === 'queja') {
    avisos.push('🚨 QUEJA en un anuncio de Facebook\\n\\nAnuncio: ' + d.ad_id +
      '\\nProducto: ' + d.producto_id + '\\n\\n"' + (d.texto || '') + '"\\n\\n' +
      'NO se ha contestado en público. Contestas tú.');
  } else if (d.accion === 'bloqueado') {
    avisos.push('⛔ El filtro de salida ha BLOQUEADO una respuesta\\n\\nAnuncio: ' + d.ad_id +
      '\\nMotivo: ' + d.motivo + '\\n\\nIba a decir:\\n"' + (d.texto_bloqueado || '') + '"');
  } else if (d.accion === 'solo_aviso' && d.motivo === 'duda_solo_aviso') {
    avisos.push('❓ DUDA de producto sin contestar (modo prudente)\\n\\nAnuncio: ' + d.ad_id +
      '\\n\\n"' + (d.texto || '') + '"');
  }
}
if (problemas.length) {
  avisos.push('⚠️ Anuncios activos que NO se pueden atender\\n\\n' + problemas.join('\\n') +
    '\\n\\nRevisa el Sheet FB_Anuncios.');
}
return avisos.length ? avisos.map(texto => ({ json: { texto } })) : [{ json: { texto: '' } }];`),

    ifNode('Hay aviso?', [3760, 400], '={{ $json.texto }}', 'notEmpty', ''),

    httpN('Aviso Telegram', [3980, 300], {
      method: 'POST', url: '=https://api.telegram.org/bot{{ $env.TG_INCIDENCIAS_TOKEN }}/sendMessage',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ chat_id: $env.TG_INCIDENCIAS_CHAT, text: $json.texto }) }}',
      options: {} }),

    noOp('Fin', [4200, 400]),
  ];

  const conns = conectar([
    ['Cada 10 minutos', 'Leer Paginas'], ['Leer Paginas', 'Leer Anuncios'], ['Leer Anuncios', 'Ciclo'],
    ['Ciclo', 'Token de pagina'], ['Token de pagina', 'Anuncios con token'],
    ['Anuncios con token', 'Leer comentarios'], ['Leer comentarios', 'Juntar comentarios'],
    ['Juntar comentarios', 'Leer Catalogo'], ['Leer Catalogo', 'Filtro de entrada'],
    ['Filtro de entrada', 'Hay algo que clasificar'],
    ['Hay algo que clasificar', 'Clasificar', 0],
    ['Hay algo que clasificar', 'Avisar', 1],
    ['Clasificar', 'Decidir y filtrar'], ['Decidir y filtrar', 'Publica?'],
    ['Publica?', 'Esperar un poco', 0], ['Publica?', 'Avisar', 1],
    ['Esperar un poco', 'Publicar (punto unico)'], ['Publicar (punto unico)', 'Avisar'],
    ['Avisar', 'Hay aviso?'], ['Hay aviso?', 'Aviso Telegram', 0], ['Hay aviso?', 'Fin', 1],
    ['Aviso Telegram', 'Fin'],
  ]);
  conns['Modelo'] = { ai_languageModel: [[{ node: 'Clasificar', type: 'ai_languageModel', index: 0 }]] };
  return { name: 'Comentarios FB — PROD', nodes, settings: SETTINGS, connections: conns };
}

// ─── Emitir ─────────────────────────────────────────────────────────────────
const dir = path.join(__dirname, 'workflows');
fs.mkdirSync(dir, { recursive: true });
const escribir = (f, o) => {
  fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2));
  const publica = JSON.stringify(o).includes('Publicar respuesta') || JSON.stringify(o).includes('Publicar (punto unico)');
  console.log('  ' + f.padEnd(32) + o.nodes.length + ' nodos   publica: ' + (publica ? 'SÍ' : 'no'));
};
console.log('Construyendo:');
escribir('comentarios-fb-salida.json', salida());
escribir('comentarios-fb-ensayo.json', ensayo());
escribir('comentarios-fb-prod.json',   prod());
console.log('\nEl ensayo no tiene ningún nodo que escriba en Facebook. Es incapaz de publicar.');
