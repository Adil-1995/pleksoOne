/**
 * Dos cosas que fallarían en silencio y nadie vería hasta tener el mensaje ya
 * enviado a un cliente:
 *
 *   - `anuncioDe`: lee el `referral` de Meta, que es de un tercero. Si un día
 *     viene con un campo menos, la burbuja del anuncio tiene que desaparecer
 *     o pintar lo que haya, nunca reventar el hilo entero.
 *   - `insertarEmoji`: si el cursor se calcula mal, el emoji cae en el sitio
 *     equivocado. Se ve al releer, y muchas veces se ve tarde.
 *
 * Como las otras pruebas: NO copia el código, lee los ficheros de verdad.
 *
 *   node pruebas/anuncio-y-emojis.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

async function cargar(ruta) {
  const fuente = readFileSync(join(raiz, ruta), 'utf8')
    // Ninguno de los dos ficheros importa nada hoy. El replace está por lo
    // mismo que en comandos-de-barra.mjs: el día que importen algo, esta
    // prueba no puede caerse por una razón que no tiene nada que ver.
    .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
  const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}

const { anuncioDe } = await cargar('src/tipos.ts')
const { insertarEmoji, buscarEmojis, GRUPOS } = await cargar('src/lib/emojis.ts')

let fallos = 0
function comprueba(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  const ok = a === b
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + b + '\n        real:     ' + a)
}

// ── El anuncio de origen ─────────────────────────────────────────────────
console.log('\nanuncioDe — el referral de Meta')

// Un referral real, con el body entero. Esto es lo que dice de qué producto
// venía la conversación, y es justo lo que no se puede recortar.
const cuerpoLargo =
  '¿Usas Waze o Google Maps prácticamente cada vez que manejas? ' +
  'Entonces esto te va a interesar, porque el soporte magnético aguanta ' +
  'el teléfono en cualquier curva y se pone en dos segundos.'

comprueba('lee titular, cuerpo, enlace, id y miniatura',
  anuncioDe({ payload: { referral: {
    headline: 'Soporte magnético para el coche',
    body: cuerpoLargo,
    source_url: 'https://fb.me/anuncio',
    source_id: '120210000000',
    image_url: 'https://scontent.example/i.jpg',
  } } }),
  {
    titular: 'Soporte magnético para el coche',
    cuerpo: cuerpoLargo,
    enlace: 'https://fb.me/anuncio',
    anuncioId: '120210000000',
    miniatura: 'https://scontent.example/i.jpg',
  })

comprueba('el cuerpo sale COMPLETO, sin recortar',
  anuncioDe({ payload: { referral: { body: cuerpoLargo } } }).cuerpo.length,
  cuerpoLargo.length)

comprueba('thumbnail_url gana a image_url (el anuncio de vídeo no trae image_url)',
  anuncioDe({ payload: { referral: {
    body: 'x', thumbnail_url: 'https://t.example/t.jpg', image_url: 'https://i.example/i.jpg',
  } } }).miniatura,
  'https://t.example/t.jpg')

comprueba('un mensaje normal, sin referral, no pinta nada',
  anuncioDe({ payload: { from: '521999', text: { body: 'hola' } } }), null)

comprueba('sin payload tampoco', anuncioDe({ payload: null }), null)
comprueba('payload ausente tampoco', anuncioDe({}), null)

comprueba('un referral que solo trae el clid NO pinta una burbuja vacía',
  anuncioDe({ payload: { referral: { ctwa_clid: 'ARBc...' } } }), null)

comprueba('las cadenas vacías cuentan como ausentes',
  anuncioDe({ payload: { referral: { headline: '   ', body: '', source_url: '' } } }), null)

comprueba('con solo el titular sí se pinta',
  anuncioDe({ payload: { referral: { headline: 'Oferta' } } }),
  { titular: 'Oferta', cuerpo: null, enlace: null, anuncioId: null, miniatura: null })

comprueba('un referral que no es objeto no rompe nada',
  anuncioDe({ payload: { referral: 'vaya' } }), null)

// ── El cursor de los emojis ──────────────────────────────────────────────
console.log('\ninsertarEmoji — dónde cae y dónde queda el cursor')

comprueba('en medio de la frase, no al final',
  insertarEmoji('Hola, gracias', '😊', 4, 4),
  { texto: 'Hola😊, gracias', cursor: 6 })

comprueba('el cursor queda DETRÁS del emoji',
  insertarEmoji('', '👍', 0, 0), { texto: '👍', cursor: 2 })

comprueba('con texto seleccionado, lo sustituye',
  insertarEmoji('Hola mundo', '🔥', 5, 10), { texto: 'Hola 🔥', cursor: 7 })

comprueba('al final del todo',
  insertarEmoji('Listo', '✅', 5, 5), { texto: 'Listo✅', cursor: 6 })

// Un textarea recién montado puede dar posiciones fuera de rango. Que eso
// corte el texto por la mitad sería peor que ignorarlo.
comprueba('una posición pasada de largo se recorta, no destroza el texto',
  insertarEmoji('abc', '🎉', 99, 99), { texto: 'abc🎉', cursor: 5 })

comprueba('una posición negativa se trata como el principio',
  insertarEmoji('abc', '🎉', -5, -5), { texto: '🎉abc', cursor: 2 })

comprueba('desde > hasta no invierte ni borra nada',
  insertarEmoji('abcdef', '⭐', 4, 2), { texto: 'abcd⭐ef', cursor: 5 })

// ── El buscador de emojis ────────────────────────────────────────────────
console.log('\nbuscarEmojis — se busca en español')

comprueba('«gracias» encuentra el que se usa para dar las gracias',
  buscarEmojis('gracias').includes('🙏'), true)
comprueba('«envio» encuentra el paquete', buscarEmojis('envio').includes('📦'), true)
comprueba('sin tildes: «telefono» encuentra el móvil',
  buscarEmojis('telefono').includes('📱'), true)
comprueba('vacío no devuelve nada', buscarEmojis('   '), [])
comprueba('lo que no existe tampoco', buscarEmojis('xyzzy'), [])
comprueba('no repite un emoji que esté en dos sitios', (() => {
  const r = buscarEmojis('a')
  return r.length === new Set(r).size
})(), true)

console.log('\ncatálogo — que no se cuele una fila mal escrita')
const todos = GRUPOS.flatMap((g) => g.emojis)
comprueba('toda fila tiene emoji y palabras',
  todos.every(([e, p]) => typeof e === 'string' && e.length > 0
                       && typeof p === 'string' && p.trim().length > 0), true)
comprueba('las palabras van sin tildes (si no, el buscador no las encuentra)',
  todos.filter(([, p]) => p !== p.normalize('NFD').replace(/[̀-ͯ]/g, '')), [])

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo en orden.')
process.exit(fallos ? 1 : 0)
