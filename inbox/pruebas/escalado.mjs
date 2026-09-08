/**
 * ¿Cuándo hay un escalado ABIERTO?
 *
 * Es una comparación de dos fechas y por eso mismo se prueba: la que se
 * escribe sola y nadie mira otra vez. Si `escaladaAbierta` mirase solo
 * `escalada_en`, el contador rojo de la barra no bajaría NUNCA — todas las
 * conversaciones que escalaron alguna vez seguirían contando —, el aviso se
 * volvería ruido en dos días y se aprendería a ignorarlo. Que es
 * exactamente el fallo que esta pantalla viene a arreglar.
 *
 * Y al revés: si mirase solo `escalada_vista_en`, un cliente que vuelve a
 * escalar después de que alguien lo diera por resuelto se quedaría mudo
 * para siempre. Ese es el caso 4.
 *
 *   node pruebas/escalado.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const fuente = readFileSync(join(raiz, 'src/tipos.ts'), 'utf8')
  .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
const { escaladaAbierta } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

let fallos = 0
function comprueba(que, real, esperado) {
  const ok = real === esperado
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + esperado + '\n        real:     ' + real)
}

const T9_00 = '2026-09-08T09:00:00Z'
const T9_04 = '2026-09-08T09:04:00Z'
const T9_20 = '2026-09-08T09:20:00Z'

console.log('\nlos cuatro estados')

comprueba(
  '1. nunca ha escalado: cerrado',
  escaladaAbierta({ escalada_en: null, escalada_vista_en: null }),
  false,
)
comprueba(
  '2. escaló y nadie lo ha mirado: ABIERTO',
  escaladaAbierta({ escalada_en: T9_00, escalada_vista_en: null }),
  true,
)
comprueba(
  '3. escaló y alguien lo resolvió después: cerrado',
  escaladaAbierta({ escalada_en: T9_00, escalada_vista_en: T9_04 }),
  false,
)
comprueba(
  '4. resuelto a las 9:04 y vuelve a escalar a las 9:20: ABIERTO otra vez, solo',
  escaladaAbierta({ escalada_en: T9_20, escalada_vista_en: T9_04 }),
  true,
)

console.log('\nlos bordes que se cuelan')

comprueba(
  'resuelto en el MISMO instante: cuenta como resuelto, no como abierto',
  escaladaAbierta({ escalada_en: T9_00, escalada_vista_en: T9_00 }),
  false,
)
comprueba(
  'una marca de visto SIN escalado no abre nada',
  escaladaAbierta({ escalada_en: null, escalada_vista_en: T9_04 }),
  false,
)
comprueba(
  'las dos fechas con formato distinto (con y sin milisegundos) se comparan igual',
  escaladaAbierta({
    escalada_en: '2026-09-08T09:20:00.000Z',
    escalada_vista_en: '2026-09-08T09:04:00Z',
  }),
  true,
)
comprueba(
  'zonas horarias distintas: 11:20+02:00 es 09:20Z, o sea posterior. ABIERTO',
  escaladaAbierta({
    escalada_en: '2026-09-08T11:20:00+02:00',
    escalada_vista_en: T9_04,
  }),
  true,
)

console.log(fallos ? `\n${fallos} FALLO(S)\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
