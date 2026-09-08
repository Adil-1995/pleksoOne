/**
 * LA FECHA DE LOS MENSAJES ANTIGUOS.
 *
 * El separador de día es un elemento más del hilo, o sea que se queda donde
 * le toca: arriba del todo de su día. En una conversación con veinte mensajes
 * del 24 de agosto, subes a leerlos y la fecha ya no está en pantalla: te
 * quedas mirando mensajes sin saber de cuándo son. «Hoy» se veía siempre solo
 * porque el hilo abre abajo, pegado a él.
 *
 * Se prueban las dos mitades:
 *
 *   1. la REGLA de qué fecha enseñar arriba, incluida la única excepción
 *      —que no se pinte dos veces la misma cuando el separador ya se ve—
 *   2. que el separador salga en TODOS los cortes de día y en ninguno más,
 *      que es lo que hace que la fecha exista siquiera
 *
 *   node pruebas/fecha-del-hilo.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

// 1. La regla, de Hilo.tsx. Se corta el trozo puro: lo demás es React.
const hilo = readFileSync(join(raiz, 'src/componentes/Hilo.tsx'), 'utf8')
const a = hilo.indexOf('export function isoDe')
const b = hilo.indexOf('export function Hilo(')
if (a < 0 || b <= a) throw new Error('no encuentro isoDe/fechaFlotante en Hilo.tsx')
const { code } = transformSync(hilo.slice(a, b), { loader: 'ts', format: 'esm' })
const { isoDe, fechaFlotante } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

// 2. `mismoDia`, de formato.ts, que es lo que decide dónde va cada separador.
const fmt = readFileSync(join(raiz, 'src/lib/formato.ts'), 'utf8')
const c = fmt.indexOf('export function mismoDia')
const d = fmt.indexOf('\n}', c) + 2
const { code: code2 } = transformSync(fmt.slice(c, d), { loader: 'ts', format: 'esm' })
const { mismoDia } = await import(
  'data:text/javascript;base64,' + Buffer.from(code2).toString('base64')
)

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const dia = (iso) => ({ clase: 'dia', clave: 'd' + iso, iso })
const msg = (iso) => ({ clase: 'msg', clave: 'm' + iso, m: { id: 1, creado: iso } })
const anuncio = (iso) => ({ clase: 'anuncio', clave: 'a', a: {}, iso, id: 1 })

console.log('\nla fecha sale de lo que estás viendo')
comprueba('un mensaje', fechaFlotante(msg('2026-08-24T10:00:00Z')) === '2026-08-24T10:00:00Z')
comprueba('un anuncio', fechaFlotante(anuncio('2026-08-24T09:00:00Z')) === '2026-08-24T09:00:00Z')

console.log('\nla única excepción: no decir la fecha dos veces')
// Da igual que el separador se vea entero o cortado: si asoma, ya está
// diciendo la fecha. La regla anterior era «solo si está ENTERO», y en el
// navegador salía la fecha DOS VECES al llegar abajo del todo, con el
// separador cortado 17 px por arriba.
comprueba('si lo que asoma es el separador, no hay pastilla',
  fechaFlotante(dia('2026-08-24T00:00:00Z')) === null)

console.log('\nsin nada que enseñar, nada')
comprueba('hilo vacío', fechaFlotante(null) === null)

console.log('\nisoDe saca la fecha de los tres tipos')
comprueba('de un mensaje', isoDe(msg('2026-09-01T00:00:00Z')) === '2026-09-01T00:00:00Z')
comprueba('de un separador', isoDe(dia('2026-09-02T00:00:00Z')) === '2026-09-02T00:00:00Z')
comprueba('de un anuncio', isoDe(anuncio('2026-09-03T00:00:00Z')) === '2026-09-03T00:00:00Z')

console.log('\nhay un separador en cada cambio de día, y solo ahí')
// El mismo bucle que arma el hilo, sobre mensajes de tres días.
function cortes(isos) {
  const out = []
  let anterior = null
  for (const iso of isos) {
    if (!anterior || !mismoDia(anterior, iso)) { out.push(iso); anterior = iso }
  }
  return out
}
const tresDias = [
  '2026-08-24T08:00:00', '2026-08-24T09:00:00', '2026-08-24T23:59:00',
  '2026-08-25T00:01:00', '2026-08-25T12:00:00',
  '2026-09-08T10:00:00',
]
comprueba('tres días, tres separadores', cortes(tresDias).length === 3, JSON.stringify(cortes(tresDias)))
comprueba('el primero es el primer mensaje', cortes(tresDias)[0] === '2026-08-24T08:00:00')
comprueba('un minuto después de medianoche ya es otro día',
  cortes(tresDias)[1] === '2026-08-25T00:01:00')
comprueba('todo en el mismo día: UN separador', cortes([
  '2026-08-24T00:00:01', '2026-08-24T12:00:00', '2026-08-24T23:59:59',
]).length === 1)
comprueba('un hilo de un solo mensaje también lo lleva',
  cortes(['2026-08-24T10:00:00']).length === 1)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
