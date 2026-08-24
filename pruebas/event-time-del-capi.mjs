/**
 * ¿El Purchase se le reporta a Meta con la fecha en que se VALIDÓ la venta?
 *
 * Ejecuta el código real de 'Construir evento' del workflow del CAPI.
 *   node pruebas/event-time-del-capi.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const flujo = JSON.parse(readFileSync(join(raiz, 'workflows/capi-purchase-validacion.json'), 'utf8'))
const codigo = flujo.nodes.find((n) => n.name === 'Construir evento').parameters.jsCode

let fallos = 0
const comprueba = (que, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log((ok ? '  ok   ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + JSON.stringify(esperado) + '\n        real:     ' + JSON.stringify(real))
}

// Ejecuta el nodo con una respuesta de Supabase y unas líneas tomadas.
function construir({ lineas, ids, conv }) {
  const $ = (n) => {
    if (n === '¿Tomé algo?') return { first: () => ({ json: { lineas, ids, conversacion_id: 1062 } }) }
    throw new Error("Node '" + n + "' hasn't been executed")
  }
  const $json = { statusCode: 200, body: [conv] }
  const $env = {}
  return new Function('$', '$json', '$env', codigo)($, $json, $env)[0].json
}

// La venta real de la conversación 1062: 12 lucessolares, validada el 23.
const VALIDADO = '2026-08-23T16:08:00.123456+00:00'
const conv = {
  cliente_id: '5215591937975', ctwa_clid: 'AfjeLWJPrDYZs5-H9h',
  canal_id: 1, canales: { waba_id: '1686689748986716', nombre: 'México' },
  conversacion_productos: [
    { id: 900, validado_en: VALIDADO },
    { id: 901, validado_en: '2026-08-24T09:00:00+00:00' },   // otra línea, NO tomada
  ],
}
const lineas = [{ id: 900, producto: 'lucessolares', precio: '995', cantidad: 12 }]

console.log('EVENT_TIME')
const r = construir({ lineas, ids: [900], conv })
comprueba('se puede enviar', r.puede, 'si')
comprueba('la fecha sale de validado_en', r.fecha_origen, 'validado_en')
comprueba('y es EXACTAMENTE el instante de la validación',
  r.evento.data[0].event_time, Math.floor(Date.parse(VALIDADO) / 1000))
comprueba('NO es la de ahora', r.evento.data[0].event_time === Math.floor(Date.now() / 1000), false)
comprueba('el importe sigue saliendo del catálogo', r.evento.data[0].custom_data.value, 11940)

console.log()
console.log('SOLO CUENTAN LAS LÍNEAS TOMADAS')
comprueba('una línea de la conversación que NO se tomó no mueve la fecha',
  construir({ lineas, ids: [900], conv }).evento.data[0].event_time,
  Math.floor(Date.parse(VALIDADO) / 1000))
comprueba('con dos líneas tomadas gana la MÁS ANTIGUA',
  construir({ lineas: [{ id: 900, producto: 'a', precio: '10', cantidad: 1 },
                       { id: 901, producto: 'b', precio: '10', cantidad: 1 }],
              ids: [900, 901], conv }).evento.data[0].event_time,
  Math.floor(Date.parse(VALIDADO) / 1000))

console.log()
console.log('BORDES')
const sinFecha = construir({ lineas, ids: [900],
  conv: { ...conv, conversacion_productos: [{ id: 900, validado_en: null }] } })
comprueba('sin validado_en se cae a ahora Y LO DICE', sinFecha.fecha_origen.startsWith('AHORA'), true)
comprueba('la antigüedad en días queda escrita', typeof construir({ lineas, ids: [900], conv }).dias_de_antiguedad, 'number')
comprueba('sin clid sigue sin enviarse',
  construir({ lineas, ids: [900], conv: { ...conv, ctwa_clid: null } }).puede, 'no')

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLOS')
process.exit(fallos ? 1 : 0)
