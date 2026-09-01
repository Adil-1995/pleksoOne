/**
 * PASO 4 — La ficha se identifica por el CUERPO del anuncio.
 *
 * EL PROBLEMA (diagnosticado el 1/9/2026 contra ejecuciones reales)
 *
 *   Los anuncios nuevos (filtro de agua, mascarilla, soporte) traen un
 *   mensaje prerrellenado que NO nombra el producto:
 *       "Hola 👋 Me interesa 💧 ¿Me pueden dar más información"
 *   El producto está en el EMOJI, y `normalizar()` lo borra. Los anuncios
 *   viejos sí lo nombraban —"Qué precio tienen las *Luces led con carga
 *   solar*?"— y por eso las luces nunca dejaron de funcionar.
 *
 *   El titular del anuncio tampoco vale: "💧 Convierte tu grifo en agua
 *   filtrada" no contiene ninguna `palabra_clave`. Comprobado contra los 8
 *   anuncios reales: 0 de 8 identifican el producto por el titular.
 *
 *   El CUERPO sí lo nombra, siempre, y de forma explícita: "Este Filtro
 *   Purificador de Agua...", "**Mini Luces LED Solares**". Probado en frío
 *   con el catálogo y los anuncios reales: 8 de 8, sin un solo ambiguo.
 *
 * Y HAY UN SEGUNDO FALLO QUE LO TAPABA
 *
 *   El `referral` de Meta solo viene en el PRIMER mensaje. Si el cliente
 *   manda dos seguidos —"Hola 👋 Me interesa 💧" y "Precio", 2 segundos
 *   después— el buffer los junta y la ejecución que llega a `Decidir ficha`
 *   es la del SEGUNDO, que ya no trae `referral`. Comprobado:
 *       ejec 18766: ad_titulo='💧 Filtra el agua...'  (27 nodos, se para en el buffer)
 *       ejec 18767: ad_titulo=''                       (61 nodos, decide la ficha)
 *   Por eso se rescata del historial, donde `mensajes.payload` lo guarda
 *   entero desde el primer día.
 *
 * QUÉ NO SE TOCA, A PROPÓSITO
 *   - El subflujo de salida (CYgKApb26ARGlhVZ). Nada de esto lo necesita, y
 *     así no hay PUT que lo despublique ni 404 en cascada.
 *   - Lo que ve María. `Variables.ad_cuerpo` se queda en '' porque de ahí
 *     sale el `[CONTEXTO: ...]` que se le inyecta al modelo; meterle 1300
 *     caracteres de copy publicitario es otro cambio y otra tanda. El cuerpo
 *     viaja por un campo NUEVO que solo lee el flujo (regla 5).
 *
 *   node construir-paso4.js
 */
const fs = require('fs');
const path = require('path');

const ENTRADA = process.argv[2];
const SALIDA = process.argv[3] || path.join(__dirname, 'paso4-ficha-desde-el-anuncio.json');

if (!ENTRADA) {
  console.error('Uso: node construir-paso4.js <receptor-vivo.json> [salida.json]');
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'));
const nodo = (nombre) => {
  const n = wf.nodes.find((x) => x.name === nombre);
  if (!n) { console.error('NO EXISTE el nodo: ' + nombre); process.exit(1); }
  return n;
};

/** Sustituye una vez y exige que haya cambiado algo. Un parche que no
 *  encuentra su ancla es el fallo mudo clásico: el JSON sale, se publica,
 *  y no arregla nada. */
function sustituir(texto, buscar, poner, etiqueta) {
  if (!texto.includes(buscar)) {
    console.error(`✘ ${etiqueta}: no se encontró el ancla:\n   ${JSON.stringify(buscar.slice(0, 90))}`);
    process.exit(1);
  }
  console.log(`✔ ${etiqueta}`);
  return texto.replace(buscar, poner);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Normalizar evento — sacar también el CUERPO del referral
// ─────────────────────────────────────────────────────────────────────────
{
  const n = nodo('Normalizar evento');
  n.parameters.jsCode = sustituir(
    n.parameters.jsCode,
    "        ad_titulo:       ref.headline || '',",
    "        ad_titulo:       ref.headline || '',\n" +
    "        // El CUERPO del anuncio. El titular casi nunca nombra el producto\n" +
    "        // (\"Convierte tu grifo en agua filtrada\"); el cuerpo sí, siempre\n" +
    "        // (\"Este Filtro Purificador de Agua...\"). Es lo único que permite\n" +
    "        // identificar el producto cuando el mensaje prerrellenado del\n" +
    "        // anuncio lo dice solo con un emoji.\n" +
    "        ad_cuerpo:       ref.body || '',",
    'Normalizar evento: se extrae ref.body',
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Variables — llevarlo por un campo NUEVO, sin tocar el prompt
// ─────────────────────────────────────────────────────────────────────────
{
  const n = nodo('Variables');
  n.parameters.jsCode = sustituir(
    n.parameters.jsCode,
    "  ad_cuerpo:      '',",
    "  // ad_cuerpo SIGUE VACÍO A PROPÓSITO. De aquí lo lee 'Juntar mensajes'\n" +
    "  // para armar el [CONTEXTO: ...] que se le inyecta al modelo, y meterle\n" +
    "  // 1300 caracteres de copy publicitario cambiaría lo que María contesta.\n" +
    "  // Eso es otro cambio y otra tanda.\n" +
    "  ad_cuerpo:      '',\n" +
    "  // El cuerpo del anuncio para EMPAREJAR, que es una decisión del flujo y\n" +
    "  // no del modelo (regla 5). Solo lo lee 'Decidir ficha'.\n" +
    "  ad_cuerpo_emparejar: n.ad_cuerpo || '',",
    'Variables: ad_cuerpo_emparejar (y ad_cuerpo se queda vacío)',
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Leer historial del cliente — traer también el payload
// ─────────────────────────────────────────────────────────────────────────
{
  const n = nodo('Leer historial del cliente');
  n.parameters.url = sustituir(
    n.parameters.url,
    '&select=texto,creado',
    // `payload` es el webhook crudo de Meta, y ahí vive el `referral` del
    // primer mensaje. Se pide aquí y no con una llamada nueva porque esta
    // consulta ya se hace: es una columna más, no un viaje más.
    '&select=texto,creado,payload',
    'Leer historial del cliente: +payload',
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Decidir ficha — el anuncio como fuente de identificación
// ─────────────────────────────────────────────────────────────────────────
{
  const n = nodo('Decidir ficha');
  n.parameters.jsCode = sustituir(
    n.parameters.jsCode,
    "try { contextoAnuncio = normalizar($('Juntar mensajes').first().json.contexto_anuncio); } catch (e) {}",

    "try { contextoAnuncio = normalizar($('Juntar mensajes').first().json.contexto_anuncio); } catch (e) {}\n" +
    "\n" +
    "// ---------- el CUERPO del anuncio ----------\n" +
    "// El titular no sirve para identificar: comprobado contra los 8 anuncios\n" +
    "// reales, 0 de 8 contienen una palabra clave. \"Convierte tu grifo en agua\n" +
    "// filtrada\" no dice \"filtro\" ni \"purificador\". El cuerpo sí, siempre.\n" +
    "//\n" +
    "// Se junta con el titular en la MISMA cadena: para el emparejador es un\n" +
    "// texto más, y así la comprobación de contradicción entre fuentes sigue\n" +
    "// funcionando igual, sin una rama nueva que mantener.\n" +
    "let anuncioRescatado = false;\n" +
    "\n" +
    "// a) Del evento que estamos procesando, si aún lo trae.\n" +
    "try {\n" +
    "  const v = $('Variables').first().json;\n" +
    "  const t = [v.ad_titulo, v.ad_cuerpo_emparejar].filter(Boolean).join(' ');\n" +
    "  if (t) contextoAnuncio = (contextoAnuncio + ' ' + normalizar(t)).trim();\n" +
    "} catch (e) {}\n" +
    "\n" +
    "// b) Rescatado del historial.\n" +
    "//\n" +
    "// ESTO NO ES UN CINTURÓN DE MÁS, es el caso NORMAL. El `referral` de Meta\n" +
    "// solo viene en el PRIMER mensaje del cliente; si manda dos seguidos, el\n" +
    "// buffer los junta y la ejecución que llega hasta aquí es la del segundo,\n" +
    "// que ya no lo trae. Pasó en la ejecución 18767 y es lo que dejó al filtro\n" +
    "// de agua sin ficha. En `mensajes.payload` está entero desde el primer día.\n" +
    "//\n" +
    "// Se recorre de más NUEVO a más viejo y se para en el primero que traiga\n" +
    "// anuncio: si el cliente ha vuelto por una campaña distinta, gana la\n" +
    "// última, que es el mismo criterio que ya usa la atribución del CAPI.\n" +
    "try {\n" +
    "  let _c = ($('Leer historial del cliente').first().json || {}).body;\n" +
    "  if (typeof _c === 'string') { try { _c = JSON.parse(_c); } catch (e) {} }\n" +
    "  for (const fila of (Array.isArray(_c) ? _c : [])) {\n" +
    "    const r = (fila && fila.payload && fila.payload.referral) || null;\n" +
    "    if (!r || typeof r !== 'object') continue;\n" +
    "    const t = [r.headline, r.body].filter(Boolean).join(' ');\n" +
    "    if (!t) continue;\n" +
    "    contextoAnuncio = (contextoAnuncio + ' ' + normalizar(t)).trim();\n" +
    "    anuncioRescatado = true;\n" +
    "    break;\n" +
    "  }\n" +
    "} catch (e) {}",

    'Decidir ficha: el cuerpo del anuncio, del evento y del historial',
  );

  // Que se vea en la salida del nodo si el rescate hizo falta. Sin esto, el
  // día que el historial deje de traer payload, esto volvería a fallar en
  // silencio y en verde — que es exactamente cómo llegamos hasta aquí.
  n.parameters.jsCode = sustituir(
    n.parameters.jsCode,
    "    _historial: historialLeidos,\n    motivo: producto ? 'no es consulta general' : 'producto no identificado con seguridad'",
    "    _historial: historialLeidos,\n    _anuncio_rescatado: anuncioRescatado,\n    motivo: producto ? 'no es consulta general' : 'producto no identificado con seguridad'",
    'Decidir ficha: _anuncio_rescatado en la rama que NO envía',
  );
  n.parameters.jsCode = sustituir(
    n.parameters.jsCode,
    '    _historial: historialLeidos,\n    imagen,',
    '    _historial: historialLeidos,\n    _anuncio_rescatado: anuncioRescatado,\n    imagen,',
    'Decidir ficha: _anuncio_rescatado en la rama que SÍ envía',
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Solo lo que acepta el PUT de la API pública.
// ─────────────────────────────────────────────────────────────────────────
const salida = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
};

fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 2));
console.log('\nEscrito: ' + SALIDA);
console.log('Nodos: ' + salida.nodes.length);
