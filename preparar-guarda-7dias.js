// Tanda A: la guarda de los 7 días en 'Construir evento'.
//
// Meta rechaza los Purchase de más de 7 días. El nodo YA calculaba la
// antigüedad y hasta llevaba el comentario diciendo que se prefiere perder
// el evento a mover la venta de día — pero `dias` solo se devolvía como
// informativo (`dias_de_antiguedad`) y no paraba nada.
//
// Las dos salidas de un evento viejo son malas, y la segunda es la peor:
//   - Meta lo rechaza  -> capi_error se llena de ruido y la linea rebota.
//   - Meta lo ACEPTA   -> la venta se atribuye al dia equivocado, y eso no
//                         se ve en ningun sitio.
//
// Se descarta por el camino normal (`puede: 'no'`), o sea:
//   ¿Se puede enviar? [false] -> Motivo del fallo -> Cerrar con fallo
// que suelta el cerrojo y escribe el motivo. La linea queda como HUECO
// visible en "validados sin reportar". Un hueco se ve; una conversión
// atribuida a destiempo, no.

const fs = require("fs");
const d = JSON.parse(fs.readFileSync("backup-capi-VIVO-preGuarda7d-20260903.json", "utf8"));
const hechos = [];

function editCode(nombre, de, a, etq) {
  const n = d.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error("no existe nodo: " + nombre);
  if (!n.parameters.jsCode.includes(de)) throw new Error("patrón no encontrado en " + nombre + ": " + etq);
  n.parameters.jsCode = n.parameters.jsCode.replace(de, a);
  hechos.push(etq);
}

editCode("Construir evento",
`const dias = (Date.now() / 1000 - event_time) / 86400;

const evento = {`,
`const dias = (Date.now() / 1000 - event_time) / 86400;

// Y AQUI SE DESCARTA DE VERDAD. Hasta el 3/9/2026 esto solo se calculaba:
// el comentario de arriba decia lo correcto y el codigo no lo cumplia, asi
// que un Purchase de hace dos semanas salia igual hacia Meta.
//
// Va aqui, y no arriba con los otros \`fallos\`, porque event_time no existe
// hasta unas lineas mas arriba. Sale por el mismo camino que el resto de
// fallos: 'Motivo del fallo' -> 'Cerrar con fallo' suelta el cerrojo y
// apunta el motivo, y la linea se queda visible en "validados sin reportar".
//
// El umbral es 7 dias EXACTOS, el limite real de Meta. No se recorta antes
// por prudencia: eso tiraria ventas recuperables sin que nadie lo pidiera.
// Una linea que llegue a 6,9 dias saldra, y si Meta la rechaza se vera.
if (dias > 7) {
  return [{ json: { puede: 'no', ids: previo.ids, event_id,
    motivo: 'fuera de la ventana de 7 dias del CAPI: ' +
            (Math.round(dias * 10) / 10) + ' dias de antiguedad (fecha de ' +
            fecha_origen + ')' } }];
}

const evento = {`,
  "A1 Construir evento: descartar los Purchase de más de 7 días");

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

fs.writeFileSync("capi-guarda-7dias.json", txt);

const cod = d.nodes.find((n) => n.name === "Construir evento").parameters.jsCode;
console.log("CAMBIOS (" + hechos.length + "):");
hechos.forEach((h) => console.log("  - " + h));
console.log("nodos: " + d.nodes.length);
console.log("conexiones rotas: " + (malos.length ? malos.join(", ") : "ninguna"));
console.log("¿la guarda corta de verdad?: " + (/if \(dias > 7\) \{[\s\S]{0,200}puede: 'no'/.test(cod) ? "sí" : "NO !!!"));
console.log("¿sigue el dataset por canal?: " + (cod.includes("dataset_id: dataset") ? "sí" : "NO !!!"));
console.log("¿algun secreto escrito?: " + (/EAA[A-Za-z0-9]{20,}|sb_(secret|publishable)_/.test(txt) ? "SÍ !!!" : "no"));
