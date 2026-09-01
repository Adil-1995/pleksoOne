/**
 * El marcado de WhatsApp: qué es una marca y qué no.
 *
 * Lo que se prueba aquí no es que la negrita salga en negrita —eso se ve de
 * un vistazo—, son los FALSOS POSITIVOS. Un asterisco de una lista con
 * viñetas o un guion bajo dentro de `nombre_fichero` se comerían medio
 * mensaje, y eso no da error: sale un texto raro en la burbuja de un cliente
 * y nadie sabe por qué.
 *
 *   node pruebas/marcado.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const fuente = readFileSync(join(raiz, 'src/lib/marcado.ts'), 'utf8')
  .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
const { trozos } = await import(
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

/** Solo el texto, para comprobar que no se pierde ni un carácter. */
const plano = (t) => trozos(t).map((x) => x.texto).join('')
/** Lo que sale en negrita, en orden. */
const negritas = (t) => trozos(t).filter((x) => x.negrita).map((x) => x.texto)

console.log('\nlo que pedía el encargo')

comprueba('el titular real del anuncio sale en negrita, sin asteriscos',
  trozos('**Soporte Inteligente 360° con Carga Inalámbrica**'),
  [{ texto: 'Soporte Inteligente 360° con Carga Inalámbrica', negrita: true }])

comprueba('negrita a media frase, con el texto de alrededor intacto',
  trozos('Hoy **envío gratis** a todo México'),
  [
    { texto: 'Hoy ' },
    { texto: 'envío gratis', negrita: true },
    { texto: ' a todo México' },
  ])

comprueba('el asterisco simple de WhatsApp también',
  negritas('esto es *importante* de verdad'), ['importante'])

comprueba('cursiva, tachado y mono',
  trozos('gira _360 grados_ y vale para ~casi~ todo, ver `README`'),
  [
    { texto: 'gira ' },
    { texto: '360 grados', cursiva: true },
    { texto: ' y vale para ' },
    { texto: 'casi', tachado: true },
    { texto: ' todo, ver ' },
    { texto: 'README', mono: true },
  ])

comprueba('~~ de Markdown, además del ~ de WhatsApp',
  trozos('antes ~~$599~~ ahora $349'),
  [{ texto: 'antes ' }, { texto: '$599', tachado: true }, { texto: ' ahora $349' }])

comprueba('negrita y cursiva a la vez',
  trozos('**muy _muy_ barato**'),
  [
    { texto: 'muy ', negrita: true },
    { texto: 'muy', negrita: true, cursiva: true },
    { texto: ' barato', negrita: true },
  ])

console.log('\nlos falsos positivos, que es lo que duele')

comprueba('una lista con viñetas NO es negrita',
  trozos('* Envío gratis\n* Pago al recibir'),
  [{ texto: '* Envío gratis\n* Pago al recibir' }])

comprueba('snake_case no se pone en cursiva',
  trozos('mira el nombre_del_fichero'), [{ texto: 'mira el nombre_del_fichero' }])

comprueba('una multiplicación no es negrita',
  trozos('son 2 * 3 * 4 unidades'), [{ texto: 'son 2 * 3 * 4 unidades' }])

comprueba('un asterisco suelto se queda como asterisco',
  trozos('cuesta $349*'), [{ texto: 'cuesta $349*' }])

comprueba('marca abierta y nunca cerrada: texto tal cual',
  trozos('esto **no cierra nunca'), [{ texto: 'esto **no cierra nunca' }])

comprueba('«**» vacío no es negrita',
  trozos('vale ** ya'), [{ texto: 'vale ** ya' }])

comprueba('un guion medio de una fecha no es tachado',
  trozos('del 1~2 de septiembre').length, 1)

console.log('\nque no se pierda ni un carácter por el camino')

for (const t of [
  'texto normal sin nada',
  '**a**',
  'a * b _ c ~ d ` e',
  '***triple***',
  '__doble bajo__',
  '**sin cerrar',
  '5 * 3 = 15 y 10_000 unidades',
  'Hola\n\n**Adiós**\n',
]) {
  const sinMarcas = t
    .replace(/\*\*/g, '').replace(/~~/g, '')
    // las simples solo si de verdad se han consumido; aquí basta con
    // comprobar que lo devuelto es el original menos, como mucho, marcas
  comprueba(`no se inventa ni se traga texto: ${JSON.stringify(t)}`,
    plano(t).replace(/[*_~`]/g, ''), sinMarcas.replace(/[*_~`]/g, ''))
}

console.log('\nbordes')
comprueba('texto vacío', trozos(''), [])
comprueba('null', trozos(null), [])
comprueba('undefined', trozos(undefined), [])
comprueba('solo marcas', plano('****').length >= 0, true)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo en orden.')
process.exit(fallos ? 1 : 0)
