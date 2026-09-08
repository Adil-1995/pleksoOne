#!/usr/bin/env node
/**
 * «Cerrar con exito» deja de fallar en silencio.
 *
 * QUE HACIA
 *   Ese nodo llama al RPC `capi_cerrar` para apuntar que el Purchase se
 *   envio. Iba con `neverError: true` Y `onError: continueRegularOutput`, y
 *   NADIE mira su respuesta: el siguiente nodo es «Responder: enviado», que
 *   solo repite el event_id. Asi que si la llamada fallaba, la ejecucion
 *   salia VERDE, el inbox recibia «ok: true, enviado: true» y en la base la
 *   linea se quedaba como no reportada.
 *
 *   Lo que eso cuesta: el evento SI llego a Meta, pero la base no se entera.
 *   La linea se queda para siempre en «validados sin reportar», y quien la
 *   revalide manda el evento otra vez. La deduplicacion por event_id evita
 *   que se cuente doble, pero nadie sabe por que esa venta no se apunta
 *   nunca. Es exactamente el patron de los tres fallos del 22 de agosto:
 *   ejecucion en verde y algo que no ha pasado.
 *
 * HAY QUE QUITAR LAS DOS COSAS
 *   `neverError` hace que un 4xx/5xx no sea un error, y
 *   `onError: continueRegularOutput` se traga el error si lo fuera. Quitar
 *   solo una deja el nodo igual de mudo. Van juntas.
 *
 * LO QUE PASA AHORA SI FALLA: la ejecucion se marca en rojo y el inbox NO
 * recibe el «ok». Es feo a proposito: mejor que se vea a que mienta.
 *
 * LO QUE ESTO NO ARREGLA, y queda dicho: el RPC puede devolver 200 habiendo
 * tocado CERO filas —por ejemplo con unos ids que ya no existen— y eso
 * seguiria siendo mudo. Para cubrirlo haria falta mirar la respuesta y
 * exigir que haya cerrado tantas lineas como ids se mandaron; es otro
 * cambio, con su propio nodo.
 *
 * LOS OTROS `neverError` DEL WORKFLOW NO SE TOCAN, y no por descuido:
 *   · `Enviar a Meta CAPI`         -> «¿Meta lo acepto?» LEE la respuesta;
 *                                     sin neverError, un 400 de Meta seria
 *                                     un error de n8n y se perderia el
 *                                     mensaje que explica por que.
 *   · `Tomar el cerrojo`           -> «¿Tome algo?» lee el resultado.
 *   · `Leer conversacion y canal`  -> «Construir evento» lo comprueba.
 *   · `Cerrar con fallo`           -> si lanzara, se llevaria por delante
 *                                     «Avisar a Incidencias», que es el
 *                                     aviso de que algo fue mal. Ese tiene
 *                                     el mismo problema pero su arreglo NO
 *                                     es lanzar: es mirar el resultado y
 *                                     decirlo en el propio aviso.
 *
 *   node quitar-nevererror-cierre.js <entrada.json> <salida.json>
 */
const fs = require('fs')

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node quitar-nevererror-cierre.js <entrada.json> <salida.json>')
  process.exit(1)
}
const w = JSON.parse(fs.readFileSync(entrada, 'utf8'))
if (w.id !== 'qXCipdF2Blm0v6HI') {
  console.error('ERROR: esto es ' + w.id + ', no el workflow de validacion')
  process.exit(1)
}

const n = w.nodes.find((x) => x.name === 'Cerrar con éxito')
if (!n) { console.error('ERROR: no existe «Cerrar con éxito»'); process.exit(1) }

const r = ((n.parameters.options || {}).response || {}).response || {}
if (r.neverError !== true) {
  console.log('  = «Cerrar con éxito» ya no tenía neverError')
} else {
  delete r.neverError
  console.log('  + fuera neverError')
}
if (n.onError === 'continueRegularOutput') {
  delete n.onError
  console.log('  + fuera onError: continueRegularOutput')
} else {
  console.log('  = no tenía onError')
}

// `fullResponse` se queda: no hace daño y es lo que haría falta el día que
// se quiera comprobar cuántas líneas cerró de verdad.
if (r.fullResponse !== true) {
  console.error('ERROR: fullResponse ha desaparecido; no toco nada más')
  process.exit(1)
}

// Y una comprobación de que NO se han tocado los otros, que sí son
// deliberados. Si algún día alguien los quita, esto lo canta.
const DEBEN_SEGUIR = ['Enviar a Meta CAPI', 'Tomar el cerrojo', 'Leer conversación y canal', 'Cerrar con fallo']
for (const nombre of DEBEN_SEGUIR) {
  const x = w.nodes.find((y) => y.name === nombre)
  const rr = ((x.parameters.options || {}).response || {}).response || {}
  if (rr.neverError !== true) {
    console.error('ERROR: «' + nombre + '» ha perdido su neverError, que es deliberado')
    process.exit(1)
  }
}
console.log('  = los otros cuatro neverError siguen donde estaban (son deliberados)')

const fuera = { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} }
fs.writeFileSync(salida, JSON.stringify(fuera, null, 2), 'utf8')
console.log('\n-> ' + salida)
