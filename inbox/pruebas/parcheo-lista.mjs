/**
 * EL PARCHEO DE LA LISTA POR REALTIME.
 *
 * Este es el sitio donde un fallo NO se ve: la lista sigue pintándose, sin
 * error y sin hueco, solo que con un dato viejo. Y cuando se nota es porque
 * se te ha pasado un cliente. Así que se prueba lo que no puede fallar:
 *
 *   1. que un mensaje nuevo aparezca en la lista
 *   2. que el contador de no leídos no se quede desfasado
 *   3. que la conversación suba al principio
 *   4. que el carrito y las etiquetas NO se borren al parchear
 *   5. que cuando no se pueda parchear, se diga (null) para que se recargue
 *
 *   node pruebas/parcheo-lista.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
let fuente = readFileSync(join(raiz, 'src/hooks/datos.ts'), 'utf8')
  .replace(/^import[^\n]*?from\s+'[^']+'\s*$/gm, '')
// Solo interesan las dos funciones puras; lo demás usa React y supabase.
const desde = fuente.indexOf('export function ordenarLista')
const hasta = fuente.indexOf('function separar')
fuente = fuente.slice(desde, hasta)
const { code } = transformSync(fuente, { loader: 'ts', format: 'esm' })
const { ordenarLista, parchearConversacion } = await import(
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
  ultimo_texto: 'hola', ultimo_en: '2026-09-08T10:00:00Z',
  no_leidos: 0, fijada: false,
  etiquetas: [{ id: 9, nombre: 'Incidencia' }],
  conversacion_productos: [{ producto: 'lucessolares', estado: 'pendiente' }],
  ...extra,
})

const LISTA = [
  conv(1, { ultimo_en: '2026-09-08T12:00:00Z' }),
  conv(2, { ultimo_en: '2026-09-08T11:00:00Z' }),
  conv(3, { ultimo_en: '2026-09-08T10:00:00Z' }),
]

console.log('\nlas cuatro que no pueden fallar')

// 1 y 3: llega un mensaje a la MÁS VIEJA
{
  const r = parchearConversacion(LISTA, {
    id: 3, ultimo_texto: 'me interesa', ultimo_en: '2026-09-08T13:00:00Z', no_leidos: 1,
  })
  comprueba('1. el texto nuevo entra en la lista',
    r[0].ultimo_texto === 'me interesa', JSON.stringify(r[0].ultimo_texto))
  comprueba('3. y esa conversación SUBE al principio',
    r[0].id === 3 && r.map((c) => c.id).join() === '3,1,2', r.map((c) => c.id).join())
}

// 2: el contador
{
  const r = parchearConversacion(LISTA, { id: 2, no_leidos: 7 })
  comprueba('2. el contador de no leídos se pone al día',
    r.find((c) => c.id === 2).no_leidos === 7)
  const r2 = parchearConversacion(r, { id: 2, no_leidos: 0 })
  comprueba('   y vuelve a cero al abrirla',
    r2.find((c) => c.id === 2).no_leidos === 0)
}

// 4: los embeds
{
  const r = parchearConversacion(LISTA, { id: 1, ultimo_texto: 'otra cosa' })
  const c = r.find((x) => x.id === 1)
  comprueba('4. el CARRITO no se borra al parchear',
    c.conversacion_productos?.[0]?.estado === 'pendiente', JSON.stringify(c.conversacion_productos))
  comprueba('   ni las ETIQUETAS',
    c.etiquetas?.[0]?.nombre === 'Incidencia', JSON.stringify(c.etiquetas))
}

console.log('\ncuando NO se puede parchear, se pide recargar (null)')
comprueba('conversación que no está en la lista (nueva, o entra ahora)',
  parchearConversacion(LISTA, { id: 99, ultimo_texto: 'x' }) === null)
comprueba('lista todavía sin cargar',
  parchearConversacion(undefined, { id: 1 }) === null)
comprueba('evento sin fila',
  parchearConversacion(LISTA, undefined) === null)
comprueba('evento sin id',
  parchearConversacion(LISTA, { ultimo_texto: 'x' }) === null)

console.log('\nel orden, que es lo que hace que suba')
comprueba('las fijadas siguen arriba aunque otra sea más nueva',
  ordenarLista([
    conv(1, { ultimo_en: '2026-09-08T23:00:00Z' }),
    conv(2, { ultimo_en: '2026-09-08T09:00:00Z', fijada: true }),
  ]).map((c) => c.id).join() === '2,1')
comprueba('parchear no pierde ni duplica filas',
  parchearConversacion(LISTA, { id: 2, no_leidos: 1 }).length === 3)
comprueba('y no toca las demás',
  parchearConversacion(LISTA, { id: 2, no_leidos: 1 }).find((c) => c.id === 1).ultimo_texto === 'hola')

console.log(fallos ? `\n${fallos} FALLO(S)\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
