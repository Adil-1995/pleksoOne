import type { Conversacion, EstadoProducto } from '@/tipos'

/**
 * Nombres bonitos de los productos, SOLO para pintar.
 *
 * La verdad del catálogo vive en el Google Sheet, que el frontend no puede
 * leer (lo lee n8n con una cuenta de servicio). Esto es un espejo de los
 * nombres, nada más: el `id` que se guarda en `conversacion_productos` es el
 * mismo que usa el catálogo, y ese es el que manda.
 *
 * Si añades un producto al Sheet y no lo añades aquí, el filtro sigue
 * funcionando y enseña el id tal cual. Se ve raro y se arregla en dos
 * segundos — que es exactamente el fallo que quieres: visible, no silencioso.
 */
const NOMBRES: Record<string, string> = {
  lucessolares: 'Mini Luces LED Solares',
  soporte360:   'Soporte 360°',
  cojinalivia:  'Cojín Alivia',
  glowbrush:    'GlowBrush',
}

export function nombreProducto(id: string): string {
  return NOMBRES[id] ?? id
}

/**
 * Los productos que el inbox sabe nombrar.
 *
 * Sirve para marcar a mano una compra de algo cuya ficha nunca se envió: sin
 * esto, el selector solo podría ofrecer lo que ya está en la conversación, y
 * el cliente que llama por teléfono para pedir otra cosa se quedaría fuera.
 */
export const CATALOGO_CONOCIDO = Object.keys(NOMBRES)

export const ETIQUETA_ESTADO: Record<EstadoProducto, string> = {
  interesado: 'Interesados',
  pendiente:  'Pendientes',
  validado:   'Validados',
}

/**
 * Cómo se pinta cada estado de pedido.
 *
 * El color es el mensaje: AMARILLO es "esto lo dice la máquina, míralo" y
 * VERDE es "alguien lo ha confirmado". Un pendiente que lleva días amarillo
 * se ve de lejos en la lista, que es todo el objetivo de separarlos.
 *
 * `interesado` no tiene carrito: todavía no hay pedido que enseñar.
 */
export const PINTA_PEDIDO: Record<EstadoProducto, { color: string; texto: string; detalle: string }> = {
  interesado: {
    color: '',
    texto: 'Sin pedido',
    detalle: 'Recibió la ficha y nada más.',
  },
  pendiente: {
    color: 'text-amber-400',
    texto: 'Pedido pendiente',
    detalle: 'El flujo ha detectado un pedido. Falta que alguien lo dé por bueno.',
  },
  validado: {
    color: 'text-acento',
    texto: 'Pedido validado',
    detalle: 'Confirmado por una persona. Cuenta como venta.',
  },
}

/** El ciclo del carrito: sin pedido → pendiente → validado → sin pedido. */
export const CICLO_PEDIDO: EstadoProducto[] = ['interesado', 'pendiente', 'validado']

export function siguienteEstado(actual: EstadoProducto): EstadoProducto {
  const i = CICLO_PEDIDO.indexOf(actual)
  return CICLO_PEDIDO[(i + 1) % CICLO_PEDIDO.length]
}

/**
 * El estado de pedido de una conversación entera, para pintar UN icono
 * cuando hay varios productos. Manda el más avanzado: si algo está validado
 * la conversación es una venta, aunque haya otro producto solo interesado.
 */
export function estadoPedidoDe(productos: { estado: EstadoProducto }[]): EstadoProducto {
  if (productos.some((p) => p.estado === 'validado')) return 'validado'
  if (productos.some((p) => p.estado === 'pendiente')) return 'pendiente'
  return 'interesado'
}

/** Los productos de una conversación, ya ordenados por lo más reciente. */
export function productosDe(c: Conversacion) {
  return [...(c.conversacion_productos ?? [])].sort((a, b) =>
    b.actualizado.localeCompare(a.actualizado))
}

/** Todos los productos que aparecen de verdad en los datos, con su cuenta. */
export function catalogoPresente(conversaciones: Conversacion[]) {
  const cuenta = new Map<string, number>()
  for (const c of conversaciones) {
    for (const p of c.conversacion_productos ?? []) {
      cuenta.set(p.producto, (cuenta.get(p.producto) ?? 0) + 1)
    }
  }
  return [...cuenta.entries()]
    .map(([id, n]) => ({ id, nombre: nombreProducto(id), conversaciones: n }))
    .sort((a, b) => b.conversaciones - a.conversaciones || a.nombre.localeCompare(b.nombre))
}
