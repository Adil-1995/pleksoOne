/**
 * UN CAMPO QUE NO SE PIDE NO DA ERROR: LLEGA `undefined` Y REVIENTA DONDE SE USE.
 *
 * El 8/9/2026 esto tumbó la app entera en producción. Al estrechar el
 * `select` de la lista se dejó de pedir `conversacion_productos.actualizado`,
 * y `productosDe` ordenaba con `b.actualizado.localeCompare(...)`. No hubo
 * error de compilación ni de red: la pantalla se quedó en blanco con
 * «Cannot read properties of undefined (reading 'localeCompare')».
 *
 * Y lo que lo hizo pasar desapercibido: con CERO o UN producto, `sort` ni
 * llama al comparador. Solo reventaba con DOS o más — 30 conversaciones de
 * 4016. Por eso pasó las pruebas y se cayó con datos reales.
 *
 * Estas pruebas cubren las dos mitades:
 *   1. que el `select` de la lista pida lo que el código lee
 *   2. que ordenar no pueda tumbar la pantalla aunque falte el campo
 *
 *   node pruebas/campos-que-faltan.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (f) => readFileSync(join(raiz, f), 'utf8')

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

// ── 1. El select pide lo que el código lee ───────────────────────────────
console.log('\nel select de la lista trae lo que el codigo lee')
const datos = leer('src/hooks/datos.ts')
const select = (datos.match(/conversacion_productos\(([^)]*)\)/) || [, ''])[1]
const campos = select.split(',').map((s) => s.trim())
console.log('        embed actual: conversacion_productos(' + select + ')')

// Lo que se lee de un producto en TODO src/
const productos = leer('src/lib/productos.ts')
for (const campo of ['producto', 'estado', 'actualizado']) {
  const seUsa = new RegExp('\\.' + campo + '\\b').test(productos)
  if (!seUsa) continue
  comprueba('`' + campo + '` se usa en productos.ts y SE PIDE en el select',
    campos.includes(campo), 'el select trae: ' + campos.join(', '))
}

// ── 2. Ordenar no puede tumbar la pantalla ───────────────────────────────
console.log('\nordenar aguanta que falte el campo')
const fuente = productos.replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
const { productosDe } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

const conv = (prods) => ({ conversacion_productos: prods })

let revento = false
try {
  productosDe(conv([
    { producto: 'a', estado: 'interesado' },
    { producto: 'b', estado: 'validado' },
  ]))
} catch (e) { revento = true }
comprueba('DOS productos sin `actualizado` no revientan (el caso de produccion)', !revento)

comprueba('uno solo tampoco', (() => {
  try { return productosDe(conv([{ producto: 'a' }])).length === 1 } catch { return false }
})())
comprueba('ninguno tampoco', (() => {
  try { return productosDe(conv([])).length === 0 } catch { return false }
})())
comprueba('sin la lista siquiera', (() => {
  try { return productosDe({}).length === 0 } catch { return false }
})())

comprueba('y cuando SI viene, ordena por lo mas reciente', (() => {
  const r = productosDe(conv([
    { producto: 'viejo', actualizado: '2026-09-01T00:00:00Z' },
    { producto: 'nuevo', actualizado: '2026-09-08T00:00:00Z' },
  ]))
  return r[0].producto === 'nuevo'
})())

console.log(fallos ? `\n${fallos} FALLO(S)\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
