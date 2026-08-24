/**
 * ¿Se guarda el ctwa_clid, y se guarda el del cliente correcto?
 *
 * Lee el código del nodo de `workflows/receptor-multicanal.json` y lo
 * ejecuta, igual que la prueba de las ubicaciones. Los payloads salen de
 * mensajes reales de Supabase.
 *
 *   node pruebas/atribucion-en-el-receptor.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const flujo = JSON.parse(readFileSync(join(raiz, 'workflows/receptor-multicanal.json'), 'utf8'))
const codigoDe = (nombre) => {
  const n = flujo.nodes.find((z) => z.name === nombre)
  if (!n) throw new Error('no existe el nodo ' + nombre)
  return n.parameters.jsCode
}

let fallos = 0
function comprueba(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  const ok = a === b
  if (!ok) fallos++
  console.log((ok ? '  ok   ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + b + '\n        real:     ' + a)
}

const normalizar = (body) => new Function('$json', codigoDe('Normalizar evento'))({ body }).map((i) => i.json)

function atribuir(eventos) {
  const $ = (nombre) => {
    if (nombre === 'Normalizar evento') return { all: () => eventos.map((json) => ({ json })) }
    throw new Error("Node '" + nombre + "' hasn't been executed")
  }
  return new Function('$', codigoDe('Atribución del anuncio'))($).map((i) => i.json)
}

const sobre = (mensajes) => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '123', display_phone_number: '+52 55 0000 0000' },
    contacts: mensajes.map((m) => ({ wa_id: m.from, profile: { name: 'X' } })),
    messages: mensajes,
  } }] }],
})

// Un click-to-WhatsApp real: cliente 5212221050818, copiado de Supabase.
const deAnuncio = {
  id: 'wamid.A', from: '5212221050818', type: 'text', timestamp: '1787443301',
  text: { body: 'Qué precio tienen las *Luces led con carga solar*' },
  referral: {
    source_url: 'https://fb.me/x', source_id: '120250783606930189', source_type: 'ad',
    headline: 'Mini Luces LED Solares', body: 'Envío gratis',
    ctwa_clid: 'AfimBWZ7drwGQaDpTjKq',
  },
}
const suelto = { id: 'wamid.B', from: '5215599887766', type: 'text', timestamp: '1787443301', text: { body: 'hola, info' } }

console.log('ATRIBUCIÓN')
comprueba('un click-to-WhatsApp se atribuye',
  atribuir(normalizar(sobre([deAnuncio]))),
  [{ cliente_id: '5212221050818', ctwa_clid: 'AfimBWZ7drwGQaDpTjKq', ad_id: '120250783606930189' }])

comprueba('quien escribe por su cuenta no genera escritura',
  atribuir(normalizar(sobre([suelto]))), [])

// EL CASO QUE OBLIGA A NO USAR .first(): dos clientes en el mismo POST.
const otroAnuncio = { ...deAnuncio, id: 'wamid.C', from: '5219998887777',
  referral: { ...deAnuncio.referral, ctwa_clid: 'AfOTRODISTINTO123456', source_id: '120250783606999999' } }
comprueba('dos clientes en el mismo POST: cada uno con SU clid',
  atribuir(normalizar(sobre([deAnuncio, otroAnuncio]))),
  [{ cliente_id: '5212221050818', ctwa_clid: 'AfimBWZ7drwGQaDpTjKq', ad_id: '120250783606930189' },
   { cliente_id: '5219998887777', ctwa_clid: 'AfOTRODISTINTO123456', ad_id: '120250783606999999' }])

comprueba('mezcla de anuncio y no-anuncio: solo se escribe el del anuncio',
  atribuir(normalizar(sobre([suelto, deAnuncio]))),
  [{ cliente_id: '5212221050818', ctwa_clid: 'AfimBWZ7drwGQaDpTjKq', ad_id: '120250783606930189' }])

console.log()
console.log('EL CLID NO SE BORRA, Y EL ÚLTIMO ANUNCIO GANA')
comprueba('segundo mensaje del MISMO cliente, ya sin referral -> cero escrituras',
  atribuir(normalizar(sobre([{ id: 'wamid.D', from: '5212221050818', type: 'text',
    timestamp: '1787443999', text: { body: 'sí, lo quiero' } }]))), [])

const segundoAnuncio = { ...deAnuncio, id: 'wamid.E', timestamp: '1787999999',
  referral: { ...deAnuncio.referral, ctwa_clid: 'AfSEGUNDOANUNCIO9876', source_id: '120250999999999999' } }
comprueba('vuelve por OTRO anuncio -> se escribe el nuevo (último gana)',
  atribuir(normalizar(sobre([segundoAnuncio]))),
  [{ cliente_id: '5212221050818', ctwa_clid: 'AfSEGUNDOANUNCIO9876', ad_id: '120250999999999999' }])

console.log()
console.log('BORDES')
comprueba('un referral sin ctwa_clid no escribe nada',
  atribuir(normalizar(sobre([{ ...deAnuncio, referral: { source_id: '120', headline: 'h' } }]))), [])
comprueba('anuncio sin source_id: se guarda el clid y ad_id va a null',
  atribuir(normalizar(sobre([{ ...deAnuncio, referral: { ctwa_clid: 'AfSOLOCLID0000000000' } }]))),
  [{ cliente_id: '5212221050818', ctwa_clid: 'AfSOLOCLID0000000000', ad_id: null }])
comprueba('un cambio de ESTADO no atribuye',
  atribuir([{ tipo_evento: 'estado', cliente_id: '5212221050818', ctwa_clid: 'Afxxx' }]), [])
comprueba('una imagen que viene de anuncio también atribuye',
  atribuir(normalizar(sobre([{ id: 'wamid.F', from: '5211112223333', type: 'image',
    image: { id: 'm1', mime_type: 'image/jpeg' }, timestamp: '1787443301',
    referral: { ctwa_clid: 'AfIMAGEN000000000000', source_id: '999' } }]))),
  [{ cliente_id: '5211112223333', ctwa_clid: 'AfIMAGEN000000000000', ad_id: '999' }])

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLOS')
process.exit(fallos ? 1 : 0)
