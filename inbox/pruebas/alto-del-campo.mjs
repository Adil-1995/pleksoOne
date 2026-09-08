/**
 * EL CAMPO DE MENSAJE CRECE Y ENCOGE, COMO WHATSAPP.
 *
 * Lo que se prueba no es que crezca —eso se ve— sino las dos cosas que
 * fallan en silencio y solo se notan usándolo un rato:
 *
 *   1. que ENCOJA al borrar. `scrollHeight` nunca baja por su cuenta: si no
 *      se pone la altura en `auto` antes de medir, el campo crece y ya no
 *      vuelve, y te quedas con medio panel ocupado por un campo vacío.
 *   2. que al llegar al tope PARE y saque la barra, en vez de seguir
 *      comiéndose la conversación.
 *
 * El textarea de mentira imita al navegador en lo único que importa aquí:
 * `scrollHeight` devuelve el contenido O la caja, lo que sea MAYOR. Así, si
 * alguien quita el `height = 'auto'`, esta prueba se pone roja.
 *
 *   node pruebas/alto-del-campo.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const fuente = readFileSync(join(raiz, 'src/componentes/Redactor.tsx'), 'utf8')
const desde = fuente.indexOf('const ALTO_MAXIMO')
const hasta = fuente.indexOf('export function Redactor')
if (desde < 0 || hasta <= desde) throw new Error('no encuentro ajustarAlto en Redactor.tsx')
const { code } = transformSync(
  fuente.slice(desde, hasta) + '\nexport { ALTO_MAXIMO, ajustarAlto }\n',
  { loader: 'ts', format: 'esm' },
)
const { ALTO_MAXIMO, ajustarAlto } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const ALTO_LINEA = 21
const RELLENO = 20

/** Un textarea de mentira que mide como el navegador. */
function campo() {
  return {
    lineas: 1,
    style: { height: '', overflowY: '' },
    get contenido() { return this.lineas * ALTO_LINEA + RELLENO },
    get scrollHeight() {
      // La caja, tal y como esté puesta ahora mismo. `auto` = sin caja.
      const caja = this.style.height.endsWith('px') ? parseFloat(this.style.height) : 0
      return Math.max(this.contenido, caja)
    },
    get alto() { return parseFloat(this.style.height) },
  }
}

console.log('\ncrece con lo que escribes')
const c = campo()
ajustarAlto(c)
comprueba('una línea: la altura del contenido', c.alto === 41, 'es ' + c.alto)
comprueba('sin barra', c.style.overflowY === 'hidden', c.style.overflowY)

c.lineas = 3; ajustarAlto(c)
comprueba('tres líneas: crece', c.alto === 83, 'es ' + c.alto)
comprueba('sigue sin barra', c.style.overflowY === 'hidden', c.style.overflowY)

console.log('\npara en el tope y hace scroll dentro')
c.lineas = 12; ajustarAlto(c)
comprueba('no pasa del tope', c.alto === ALTO_MAXIMO, 'es ' + c.alto + ', tope ' + ALTO_MAXIMO)
comprueba('ahora SÍ hay barra', c.style.overflowY === 'auto', c.style.overflowY)

console.log('\nENCOGE al borrar, que es lo que se rompe')
c.lineas = 1; ajustarAlto(c)
comprueba('vuelve a una línea', c.alto === 41, 'se quedó en ' + c.alto)
comprueba('y se va la barra', c.style.overflowY === 'hidden', c.style.overflowY)

c.lineas = 6; ajustarAlto(c)
c.lineas = 2; ajustarAlto(c)
comprueba('de seis a dos también encoge', c.alto === 62, 'es ' + c.alto)

console.log('\nel caso justo del borde')
const b = campo()
b.lineas = Math.floor((ALTO_MAXIMO - RELLENO) / ALTO_LINEA)   // la última que cabe
ajustarAlto(b)
comprueba('la última que cabe no saca barra',
  b.alto <= ALTO_MAXIMO && b.style.overflowY === 'hidden', b.alto + ' / ' + b.style.overflowY)
b.lineas += 1; ajustarAlto(b)
comprueba('la siguiente sí', b.alto === ALTO_MAXIMO && b.style.overflowY === 'auto',
  b.alto + ' / ' + b.style.overflowY)

console.log('\nno revienta sin campo')
let exploto = false
try { ajustarAlto(null) } catch { exploto = true }
comprueba('con null no hace nada', !exploto)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
