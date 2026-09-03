// Purchase al CAPI: el dataset deja de ser una variable de entorno global y
// pasa a salir de la fila del canal (canales.dataset_id, 15-dataset-por-canal.sql).
//
// El evento ya llevaba el waba_id correcto de cada canal dentro de
// user_data.whatsapp_business_account_id, pero el POST se iba siempre al
// mismo dataset ($env.CAPI_DATASET = 2044273926400221), que no es el de
// ninguna de las dos WABA. Meta lo rechazaba con 100/2804132 y la ejecución
// salía en verde.
//
//   WABA 1686689748986716 (canal 1) -> dataset 1672235741574223
//   WABA 1100299049179241 (canal 2) -> dataset 1623190315916336
//
// SIN REPLIEGUE a CAPI_DATASET a propósito: un canal sin dataset_id no envía
// y lo dice. Replegar a un valor por defecto con dos canales es acertar por
// azar, que es exactamente el fallo 2 del 22 de agosto.

const fs = require("fs");
const d = JSON.parse(fs.readFileSync("backup-capi-VIVO-preDataset-20260903.json", "utf8"));
const hechos = [];

function nodo(nombre) {
  const n = d.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error("no existe nodo: " + nombre);
  return n;
}

// Sustituye dentro de jsCode. Si el patrón no está, revienta: prefiero que
// falle aquí y no un PUT que deja el nodo a medias sin que se note.
function editCode(nombre, de, a, etq) {
  const n = nodo(nombre);
  if (!n.parameters.jsCode.includes(de)) throw new Error("patrón no encontrado en " + nombre + ": " + etq);
  n.parameters.jsCode = n.parameters.jsCode.replace(de, a);
  hechos.push(etq);
}

// Igual pero sobre un parámetro suelto (url, etc.).
function editParam(nombre, campo, de, a, etq) {
  const n = nodo(nombre);
  const v = n.parameters[campo];
  if (typeof v !== "string" || !v.includes(de)) throw new Error("patrón no encontrado en " + nombre + "." + campo + ": " + etq);
  n.parameters[campo] = v.replace(de, a);
  hechos.push(etq);
}

// ===== 1. Traerse el dataset en el mismo join que ya trae el waba_id =====
editParam("Leer conversación y canal", "url",
  "canales(waba_id,nombre)",
  "canales(waba_id,dataset_id,nombre)",
  "1 Leer conversación y canal: dataset_id en el select");

// ===== 2. Validarlo igual que el waba_id =====
editCode("Construir evento",
`const waba = canal ? String(canal.waba_id || '') : '';
if (!waba) fallos.push('el canal de la conversacion no tiene waba_id');`,
`const waba = canal ? String(canal.waba_id || '') : '';
if (!waba) fallos.push('el canal de la conversacion no tiene waba_id');

// El dataset SALE DEL CANAL, no del entorno. Un dataset de mensajeria
// pertenece a una WABA: mandar el evento al de otra da 100/2804132 y se
// pierde la venta en una ejecucion verde. Aqui no hay repliegue a
// $env.CAPI_DATASET a proposito -- con dos canales, un valor por defecto
// acierta por azar en uno y miente en el otro. Sin dataset_id no se envia.
const dataset = canal ? String(canal.dataset_id || '') : '';
if (!dataset) fallos.push('el canal de la conversacion no tiene dataset_id (ver 15-dataset-por-canal.sql)');`,
  "2 Construir evento: leer y exigir dataset_id");

// ===== 3. Sacarlo en la salida para que lo use el nodo del POST =====
editCode("Construir evento",
`return [{ json: { puede: 'si', evento, event_id, valor, unidades, ids: previo.ids,
                  canal: canal ? canal.nombre : null, prueba: $env.CAPI_TEST_CODE || null,`,
`return [{ json: { puede: 'si', evento, event_id, valor, unidades, ids: previo.ids,
                  canal: canal ? canal.nombre : null, dataset_id: dataset,
                  prueba: $env.CAPI_TEST_CODE || null,`,
  "3 Construir evento: devolver dataset_id");

// ===== 4. El POST, al dataset del canal =====
// $json aqui es el item de 'Construir evento' (pasa tal cual por el IF
// '¿Se puede enviar?'), el mismo del que ya sale $json.evento en el body.
editParam("Enviar a Meta CAPI", "url",
  "{{ $env.CAPI_DATASET }}",
  "{{ $json.dataset_id }}",
  "4 Enviar a Meta CAPI: dataset del canal");

// ───────────────────────────── validacion ──────────────────────────────────
const salida = {
  name: d.name,
  nodes: d.nodes,
  connections: d.connections,
  settings: d.settings || {},
};
const txt = JSON.stringify(salida, null, 2);

const nom = new Set(d.nodes.map((n) => n.name));
const malos = [];
for (const [s, c] of Object.entries(d.connections)) {
  if (!nom.has(s)) malos.push("origen inexistente: " + s);
  for (const br of (c.main || [])) for (const o of br) if (!nom.has(o.node)) malos.push(s + " -> " + o.node);
}

fs.writeFileSync("capi-dataset-por-canal.json", txt);

console.log("CAMBIOS (" + hechos.length + "):");
hechos.forEach((h) => console.log("  - " + h));
console.log("nodos: " + d.nodes.length);
console.log("conexiones rotas: " + (malos.length ? malos.join(", ") : "ninguna"));
console.log("¿queda algun CAPI_DATASET?: " + (txt.includes("CAPI_DATASET") ? "SI !!!" : "no"));
console.log("¿algun secreto escrito?: " + (/EAA[A-Za-z0-9]{20,}|sb_(secret|publishable)_/.test(txt) ? "SÍ !!!" : "no"));
