/**
 * LÓGICA DEL AGENTE DE COMENTARIOS DE FACEBOOK
 *
 * Funciones puras, sin E/S. Es la MISMA fuente que:
 *   - corre en el ciclo en seco (fb/ciclo-seco.js)
 *   - se incrusta en los nodos Code de n8n (la mete construir-comentarios-fb.js)
 *
 * Que sea una sola fuente no es cosmética: si la lógica del ensayo y la de
 * producción se escriben dos veces, el CSV que apruebas no prueba nada sobre
 * lo que el agente hará después.
 *
 * Nada aquí llama a la red ni lee un fichero. Todo entra por parámetro.
 */

'use strict';

// ─── Constantes de negocio ──────────────────────────────────────────────────
// Van aquí y NO en el prompt: son decisiones de negocio (regla 5).
const VENTANA_HORAS          = 48;   // nada más viejo se toca. Esto es la "fecha de corte"
const LIMITE_ANUNCIO_HORA    = 5;
const LIMITE_ANUNCIO_DIA     = 20;
// EN 1 A PROPÓSITO mientras se ve la primera respuesta real en público. Sube
// a 10 cuando esa primera esté revisada y aprobada. Es el tope de TODO el
// ciclo, sumando todas las páginas y todos los anuncios.
const LIMITE_CICLO           = 1;
const MAX_LONGITUD_RESPUESTA = 400;
const MIN_CARACTERES_UTILES  = 3;

// ─── Normalizador ───────────────────────────────────────────────────────────
// Misma semántica que el `normalizar()` del agente de WhatsApp: minúsculas,
// sin tildes y SIN EMOJIS. Ojo: eso último es justo lo que hace que un
// comentario que solo lleva emojis se quede vacío, que es lo que queremos.
function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Filtro de ENTRADA ──────────────────────────────────────────────────────
/**
 * Decide si un comentario merece siquiera gastar una llamada al modelo.
 * Determinista, sin modelo, y cada descarte deja su motivo.
 *
 * `comentario` es el objeto tal cual lo devuelve Meta con
 *   fields=id,message,created_time,comments{id,from,created_time}
 */
function filtroEntrada(comentario, opciones) {
  const { ahora, pageId, ventanaHoras = VENTANA_HORAS } = opciones;

  // 1. Vacío. El comentario '' que vimos en producción es real: probablemente
  //    un sticker. Tiene que caer aquí sin romper nada.
  const crudo = comentario.message;
  if (crudo == null || String(crudo).trim() === '') {
    return { pasa: false, motivo: 'vacio' };
  }

  // 2. Solo emojis / solo signos. Tras normalizar no queda nada que clasificar.
  const texto = normalizar(crudo);
  if (!texto) return { pasa: false, motivo: 'sin_texto' };

  // 3. Demasiado corto para significar algo. "ok", "?" no son una pregunta.
  const utiles = texto.replace(/[^a-z0-9ñ]/g, '');
  if (utiles.length < MIN_CARACTERES_UTILES) {
    return { pasa: false, motivo: 'demasiado_corto' };
  }

  // 4. Fuera de la ventana. Sustituye a la columna `arrancado_en` que tendría
  //    una tabla: sin estado, y los 239 comentarios acumulados quedan fuera
  //    solos porque todos son más viejos que esto.
  const creado = Date.parse(comentario.created_time);
  if (!Number.isFinite(creado)) return { pasa: false, motivo: 'sin_fecha' };
  const horas = (ahora - creado) / 3600000;
  if (horas > ventanaHoras) return { pasa: false, motivo: 'anterior_al_corte' };
  if (horas < 0) return { pasa: false, motivo: 'fecha_futura' };

  // 5. Lo escribió una PÁGINA, no una persona.
  //    Medido el 6/9/2026 sobre 100 comentarios reales: `from` viene VACÍO en
  //    los de personas y CON VALOR cuando comenta una Página. La ausencia de
  //    identidad, que es un incordio para todo lo demás, resulta ser el
  //    detector de spam más fiable que tenemos: el spam en chino de la página
  //    "Honeydiy" traía `from` y ningún cliente real lo traía.
  if (comentario.from && comentario.from.id) {
    return {
      pasa: false,
      motivo: comentario.from.id === pageId ? 'es_nuestro' : 'es_una_pagina',
    };
  }

  // 6. Ya le respondimos. AQUÍ ESTÁ LA IDEMPOTENCIA, y no hay tabla que la
  //    guarde: la guarda Facebook. Una respuesta nuestra es un comentario
  //    hijo cuyo `from.id` es el de la página. Como el estado ES la realidad,
  //    no se puede desincronizar.
  if (yaRespondido(comentario, pageId)) {
    return { pasa: false, motivo: 'ya_respondido' };
  }

  // 7. Trae enlace o teléfono: competencia o spam. Objetivo y barato.
  if (/https?:\/\/|www\.|\bwa\.me\b/i.test(crudo)) {
    return { pasa: false, motivo: 'trae_enlace' };
  }

  return { pasa: true, motivo: null, texto };
}

/** ¿Tiene ya un comentario hijo escrito por nuestra página? */
function yaRespondido(comentario, pageId) {
  const hijos = (comentario.comments && comentario.comments.data) || [];
  return hijos.some((h) => h.from && h.from.id === pageId);
}

/** Cuántas respuestas nuestras hay en este post dentro de una ventana. */
function respuestasNuestrasDesde(comentarios, pageId, desdeMs) {
  let n = 0;
  for (const c of comentarios) {
    for (const h of ((c.comments && c.comments.data) || [])) {
      if (!h.from || h.from.id !== pageId) continue;
      const t = Date.parse(h.created_time);
      if (Number.isFinite(t) && t >= desdeMs) n++;
    }
  }
  return n;
}

// ─── Clasificación: validar lo que devuelve el modelo ───────────────────────
const CLASES  = ['precio', 'duda_producto', 'queja', 'otro'];
const IDIOMAS = ['es', 'en', 'otro'];
// Lista CERRADA de campos que el agente puede citar del catálogo.
// El modelo elige CUÁL; el valor lo pone el flujo. Así no puede inventarse
// una garantía como pasó con el cojín.
const CAMPOS = ['medidas', 'colores', 'garantia', 'vida_util', 'entrega'];

/**
 * El modelo devuelve texto. Esto lo convierte en una decisión o en `otro`.
 * Cualquier duda cae a `otro`, y `otro` no publica nada: no contestar es
 * siempre seguro, y en público ese es el default correcto.
 */
function validarClasificacion(bruto) {
  let d = bruto;
  if (typeof d === 'string') {
    const m = d.match(/\{[\s\S]*\}/);          // por si el modelo envuelve el JSON
    try { d = JSON.parse(m ? m[0] : d); } catch (e) { d = null; }
  }
  if (!d || typeof d !== 'object') {
    return { clase: 'otro', idioma: 'es', campo: null, degradado: 'no_es_json' };
  }
  const clase  = CLASES.includes(d.clase)   ? d.clase   : 'otro';
  const idioma = IDIOMAS.includes(d.idioma) ? d.idioma  : 'es';
  const campo  = CAMPOS.includes(d.campo)   ? d.campo   : null;
  const degradado = CLASES.includes(d.clase) ? null : 'clase_invalida';
  return { clase, idioma, campo, degradado };
}

// ─── El enlace de WhatsApp ──────────────────────────────────────────────────
/**
 * El mensaje prefijado TIENE que nombrar el producto con una de sus
 * `palabras_clave`, o la ficha no se dispara al llegar a WhatsApp. Como esto
 * no es un click-to-WhatsApp, NO hay `referral`: la ficha depende al 100 %
 * de este texto.
 *
 * Y nada de emojis como única señal del producto: `normalizar()` los borra.
 */
function enlaceWa(numero, palabraClave) {
  const msg = `Hola, me interesa ${palabraClave}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
}

// ─── Plantillas: FIJAS. El modelo no escribe ni una palabra ────────────────
const PLANTILLAS = {
  precio: {
    es: (e) => `¡Hola! Te damos toda la información por WhatsApp para atenderte mejor 👉 ${e}`,
    en: (e) => `Hi! We'll send you all the details on WhatsApp so we can help you better 👉 ${e}`,
  },
  duda_producto: {
    es: (e, etiqueta, valor) => `${etiqueta}: ${valor}. Si quieres más detalle te atendemos por WhatsApp 👉 ${e}`,
    en: (e, etiqueta, valor) => `${etiqueta}: ${valor}. For more details we'll help you on WhatsApp 👉 ${e}`,
  },
};

const ETIQUETAS_CAMPO = {
  es: { medidas: 'Medidas', colores: 'Colores', garantia: 'Garantía', vida_util: 'Vida útil', entrega: 'Entrega' },
  en: { medidas: 'Size',    colores: 'Colours', garantia: 'Warranty', vida_util: 'Lifespan',  entrega: 'Delivery' },
};

/**
 * Construye la respuesta, o devuelve null si NO hay que publicar nada.
 *
 * `queja` devuelve null a propósito: durante las primeras semanas solo avisa
 * a Telegram y contesta una persona. Nunca se discute en público.
 */
function construirRespuesta(clasificacion, contexto) {
  const { clase, idioma, campo } = clasificacion;
  const { enlace, producto, modoQuejaSoloAviso = true, modoDudaSoloAviso = false } = contexto;

  const lang = idioma === 'en' ? 'en' : 'es';   // 'otro' -> español, la lengua del negocio

  if (clase === 'otro')  return { texto: null, motivo: 'clase_otro' };
  if (clase === 'queja') {
    return { texto: null, motivo: modoQuejaSoloAviso ? 'queja_solo_aviso' : 'queja', avisar: true };
  }

  if (clase === 'duda_producto') {
    if (modoDudaSoloAviso) return { texto: null, motivo: 'duda_solo_aviso', avisar: true };
    const valor = campo ? (producto[campo] || '').trim() : '';
    // Campo vacío = el dato NO existe. No se rellena y no se improvisa:
    // se lleva al privado con la plantilla de precio. Una columna vacía que
    // llega al modelo es una invitación a inventarse el dato.
    if (!campo || !valor) {
      return { texto: PLANTILLAS.precio[lang](enlace), motivo: 'duda_sin_dato', plantilla: 'precio' };
    }
    const etiqueta = ETIQUETAS_CAMPO[lang][campo];
    return {
      texto: PLANTILLAS.duda_producto[lang](enlace, etiqueta, valor),
      motivo: null, plantilla: 'duda_producto', campo, valor, etiqueta,
    };
  }

  // precio
  return { texto: PLANTILLAS.precio[lang](enlace), motivo: null, plantilla: 'precio' };
}

// ─── Filtro de SALIDA ───────────────────────────────────────────────────────
/**
 * Lo que sale en público no se puede retirar, así que este filtro es el más
 * fuerte que se puede escribir: RE-RENDERIZA la plantilla desde cero y exige
 * que el texto a publicar sea IDÉNTICO. Si alguien mete texto libre por
 * cualquier vía, aquí muere.
 *
 * Las comprobaciones de contenido van después y sobreviven al día en que
 * haya texto que no salga de una plantilla.
 */
function filtroSalida(texto, contexto) {
  const { enlace, precios = [], palabrasClave = [], nombresOtrosProductos = [], esperado } = contexto;

  if (!texto || !texto.trim()) return { pasa: false, motivo: 'texto_vacio' };

  // 1. IDÉNTICO a la plantilla re-renderizada.
  if (esperado != null && texto !== esperado) {
    return { pasa: false, motivo: 'no_coincide_con_la_plantilla' };
  }

  // 2. Nunca un precio. Ni con símbolo, ni sin él.
  if (/\$\s?\d/.test(texto)) return { pasa: false, motivo: 'lleva_signo_de_precio' };
  for (const p of precios) {
    const n = String(p).replace(/[^\d]/g, '');
    if (n.length >= 3 && texto.replace(/[^\d]/g, '').includes(n)) {
      return { pasa: false, motivo: 'lleva_un_precio_del_catalogo' };
    }
  }
  if (/\b(precio|cuesta|vale|pesos|mxn|oferta|descuento)\b/i.test(texto)) {
    return { pasa: false, motivo: 'menciona_precio_u_oferta' };
  }

  // 3. Nada interno.
  if (/\b(cat[aá]logo|interno|proveedor|coste|costo|margen|stock|sku)\b/i.test(texto)) {
    return { pasa: false, motivo: 'menciona_algo_interno' };
  }

  // 4. El enlace correcto, y uno solo.
  if (!texto.includes(enlace)) return { pasa: false, motivo: 'falta_el_enlace' };
  if ((texto.match(/https?:\/\//g) || []).length !== 1) {
    return { pasa: false, motivo: 'mas_de_un_enlace' };
  }

  // 5. El enlace tiene que nombrar el producto con una palabra_clave, o la
  //    ficha no se dispara al otro lado.
  const enlaceTexto = normalizar(decodeURIComponent(enlace));
  if (!palabrasClave.some((k) => enlaceTexto.includes(normalizar(k)))) {
    return { pasa: false, motivo: 'el_enlace_no_nombra_el_producto' };
  }

  // 6. Un solo producto. Si menciona dos, se descarta (misma regla que en
  //    WhatsApp: nunca enumerar el catálogo).
  const t = normalizar(texto);
  const otros = nombresOtrosProductos.filter((n) => n && t.includes(normalizar(n)));
  if (otros.length) return { pasa: false, motivo: 'menciona_otro_producto' };

  // 7. Longitud.
  if (texto.length > MAX_LONGITUD_RESPUESTA) return { pasa: false, motivo: 'demasiado_largo' };

  return { pasa: true, motivo: null };
}

// ─── El prompt del clasificador ─────────────────────────────────────────────
/**
 * Entra el texto del comentario y NADA MÁS. Ni catálogo, ni precio, ni
 * historial. Si el modelo no ve el precio, no puede soltarlo.
 *
 * Y no clasifica en español: hay comentarios en inglés en los anuncios reales
 * ("Hello is this store still available?").
 */
const PROMPT_CLASIFICADOR = `Clasificas UN comentario de Facebook en un anuncio de una tienda.

Devuelves SOLO un objeto JSON, sin texto alrededor, sin markdown:
{"clase":"...","idioma":"...","campo":null}

clase, exactamente uno de:
  precio         - pregunta cuánto cuesta, dónde comprar, si hay envío, si está disponible
  duda_producto  - pregunta por una característica concreta del producto
  queja          - se queja, acusa, insulta, dice que no funciona o que es estafa
  otro           - saludo, etiqueta a un amigo, broma, spam, o no se entiende

idioma, exactamente uno de: es, en, otro

campo: SOLO si clase es duda_producto y la pregunta es exactamente sobre uno
de estos. Si no, null:
  medidas, colores, garantia, vida_util, entrega

Reglas:
- Ante la duda, "otro". Es preferible no contestar a contestar mal.
- Una pregunta por el precio mezclada con una queja es "queja".
- No expliques nada. Solo el JSON.

Comentario:
`;

module.exports = {
  VENTANA_HORAS, LIMITE_ANUNCIO_HORA, LIMITE_ANUNCIO_DIA, LIMITE_CICLO,
  MAX_LONGITUD_RESPUESTA, CLASES, IDIOMAS, CAMPOS, PLANTILLAS, ETIQUETAS_CAMPO,
  PROMPT_CLASIFICADOR,
  normalizar, filtroEntrada, yaRespondido, respuestasNuestrasDesde,
  validarClasificacion, enlaceWa, construirRespuesta, filtroSalida,
};
