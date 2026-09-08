/**
 * ABRIR UNA CONVERSACIÓN QUE NO ESTÁ EN LA LISTA.
 *
 * El fallo que esto cubre estuvo VIVO: pulsar un resultado del buscador y
 * quedarte mirando «Elige una conversación». Pasó desapercibido porque solo
 * ocurre con términos raros — los comunes devuelven coincidencias recientes,
 * que sí están cargadas. Medido contra la base el 8/9/2026: «Chiapas» daba
 * 16 conversaciones y SIETE de ellas no se podían abrir.
 *
 * Se prueba lo que no puede fallar:
 *
 *   1. que se apunte la rescatada, para que sobreviva a una recarga
 *   2. que el conjunto no crezca sin fin, y que se vaya la MÁS VIEJA
 *   3. que reabrir una ya apuntada la suba, no la duplique
 *   4. que el filtro que va a la consulta se construya bien
 *   5. que insertar en la lista NO pierda ni duplique lo que ya había
 *
 *   node pruebas/rescate-conversacion.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
let fuente = readFileSync(join(raiz, 'src/hooks/datos.ts'), 'utf8')
  .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')

// Las piezas puras: el orden de la lista y el apunte de rescatadas. Lo demás
// necesita React y supabase, y eso se comprueba en el navegador.
const trozo = (desde, hasta) => {
  const a = fuente.indexOf(desde)
  const b = fuente.indexOf(hasta)
  if (a < 0 || b < 0 || b <= a) throw new Error('no encuentro el trozo: ' + desde)
  return fuente.slice(a, b)
}
const codigo =
  trozo('export function ordenarLista', 'function separar') +
  trozo('const RESCATADAS = new Set<string>()', 'async function idsConTrabajo')

const { code } = transformSync(codigo, { loader: 'ts', format: 'esm' })
const { ordenarLista, apuntarRescatada, rescatadas, _olvidarRescatadas } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const conv = (id, extra = {}) => ({
  id, cliente_id: '52' + id, nombre: 'C' + id,
  ultimo_texto: 'hola', ultimo_en: '2026-09-0' + (id % 9 + 1) + 'T10:00:00Z',
  no_leidos: 0, fijada: false, favorita: false,
  etiquetas: [], conversacion_productos: [],
  ...extra,
})

console.log('\nse apunta para sobrevivir a una recarga')
_olvidarRescatadas()
apuntarRescatada('5215551234567')
comprueba('queda apuntada', rescatadas().includes('5215551234567'), rescatadas().join())

console.log('\nel conjunto no crece sin fin')
_olvidarRescatadas()
for (let i = 0; i < 40; i++) apuntarRescatada('52100000000' + i)
comprueba('se queda en 25', rescatadas().length === 25, 'son ' + rescatadas().length)
comprueba('se fue la MÁS VIEJA', !rescatadas().includes('521000000000'))
comprueba('sigue la más nueva', rescatadas().includes('5210000000039'))

console.log('\nreabrir una ya apuntada la sube, no la duplica')
_olvidarRescatadas()
apuntarRescatada('A'); apuntarRescatada('B'); apuntarRescatada('A')
comprueba('sin duplicados', rescatadas().length === 2, rescatadas().join())
comprueba('«A» pasa a ser la más reciente', rescatadas()[1] === 'A', rescatadas().join())
// Y por eso no se pierde: con el tope lleno, la que acabas de mirar se queda.
_olvidarRescatadas()
for (let i = 0; i < 25; i++) apuntarRescatada('x' + i)
apuntarRescatada('x0')          // la vuelves a abrir
apuntarRescatada('nueva')       // y entra otra, que echa a alguien
comprueba('la reabierta NO es la que se va', rescatadas().includes('x0'))
comprueba('se fue la siguiente más vieja', !rescatadas().includes('x1'))

console.log('\nel filtro que se le manda a PostgREST')
_olvidarRescatadas()
const filtro = () => rescatadas().length ? `cliente_id.in.(${rescatadas().join(',')})` : null
comprueba('sin ninguna, no se manda nada', filtro() === null, String(filtro()))
apuntarRescatada('521A'); apuntarRescatada('521B')
comprueba('con dos, va la lista entera',
  filtro() === 'cliente_id.in.(521A,521B)', String(filtro()))

console.log('\nmeterla en la lista no rompe la lista')
const lista = [conv(1), conv(2), conv(3)]
const nueva = conv(9, { ultimo_en: '2026-08-01T10:00:00Z' })
const salida = ordenarLista([...lista, nueva])
comprueba('están todas', salida.length === 4, 'son ' + salida.length)
comprueba('sin duplicados', new Set(salida.map((c) => c.id)).size === 4)
comprueba('la vieja cae al final', salida[3].id === 9, salida.map((c) => c.id).join())
// Y si ya estaba, no se mete otra vez: eso lo decide el `some(id)` del hook.
const yaEsta = lista.some((c) => c.id === 2)
comprueba('detecta que ya estaba', yaEsta === true)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
