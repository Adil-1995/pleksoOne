/**
 * El cruce entre el orden GUARDADO y los iconos que existen HOY.
 *
 * Es la parte que se rompe sola con el tiempo: alguien se coloca la barra
 * hoy, y dentro de dos meses hay un filtro nuevo y otro que se quitó. Si el
 * guardado mandara del todo, el filtro nuevo no le aparecería NUNCA a quien
 * tenga un orden viejo — y no daría ningún error, simplemente no estaría.
 *
 *   node pruebas/orden-barra.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const fuente = readFileSync(join(raiz, 'src/hooks/useOrdenBarra.ts'), 'utf8')
  .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
  // El hook usa React y supabase; aquí solo interesa la función pura.
  .replace(/export function useOrdenBarra[\s\S]*$/m, '')
const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
const { ordenarConGuardado } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

let fallos = 0
function comprueba(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  const ok = a === b
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + b + '\n        real:     ' + a)
}

const HOY = ['todas', 'favoritos', 'etiquetas', 'carrito', 'sinleer']

console.log('\nlo normal')
comprueba('sin nada guardado, el orden de fábrica',
  ordenarConGuardado(HOY, null), HOY)
comprueba('guardado vacío, el orden de fábrica',
  ordenarConGuardado(HOY, []), HOY)
comprueba('un orden guardado se respeta tal cual',
  ordenarConGuardado(HOY, ['sinleer', 'carrito', 'todas', 'favoritos', 'etiquetas']),
  ['sinleer', 'carrito', 'todas', 'favoritos', 'etiquetas'])

console.log('\nlo que pasa con el tiempo, que es lo que importa')
comprueba('un icono NUEVO aparece al final aunque haya orden guardado',
  ordenarConGuardado([...HOY, 'incidencias'], ['sinleer', 'carrito', 'todas', 'favoritos', 'etiquetas']),
  ['sinleer', 'carrito', 'todas', 'favoritos', 'etiquetas', 'incidencias'])
comprueba('un icono que YA NO EXISTE se descarta, sin dejar hueco',
  ordenarConGuardado(HOY, ['sinleer', 'fantasma', 'carrito', 'todas', 'favoritos', 'etiquetas']),
  ['sinleer', 'carrito', 'todas', 'favoritos', 'etiquetas'])
comprueba('las dos cosas a la vez',
  ordenarConGuardado(['todas', 'carrito', 'incidencias'], ['carrito', 'fantasma', 'todas']),
  ['carrito', 'todas', 'incidencias'])

console.log('\nbordes')
comprueba('un guardado con TODO desconocido cae al de fábrica',
  ordenarConGuardado(HOY, ['a', 'b', 'c']), HOY)
comprueba('un guardado con repetidos no duplica',
  ordenarConGuardado(['a', 'b'], ['b', 'b', 'a']).filter((x, i, l) => l.indexOf(x) === i).length,
  2)
comprueba('no se pierde ni se inventa ningún icono',
  ordenarConGuardado(HOY, ['carrito']).slice().sort(), HOY.slice().sort())

console.log(fallos ? `\n${fallos} FALLO(S)\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
