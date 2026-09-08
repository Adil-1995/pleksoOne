/**
 * BANCO DE PRUEBAS de la fila de la lista.  http://localhost:5173/banco-fila.html
 *
 * Monta el componente `Fila` DE VERDAD —el mismo que usa el inbox— con datos
 * inventados, sin sesión y sin tocar Supabase. Sirve para mirar el aspecto en
 * los casos que en producción casi nunca coinciden a la vez: nombre largo,
 * producto largo, los tres distintivos puestos y la pantalla estrecha.
 *
 * No entra en el build de la app: Vite solo empaqueta lo que cuelga de
 * index.html. Este HTML se sirve en `dev` y ahí se queda.
 */
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { Fila } from '@/componentes/ListaConversaciones'
import type { Canal, Conversacion, ProductoConversacion } from '@/tipos'
import '@/index.css'

// Ancho de la pantalla que se simula: ?ancho=430. 375 por defecto, que es
// el iPhone SE y el suelo real de lo que hay que aguantar.
const PARAMS = new URLSearchParams(location.search)
const ANCHO = Number(PARAMS.get('ancho')) || 375
// La regla mide los anchos de verdad y los escribe arriba: ?regla=1. Apagada
// por defecto porque tapa justo lo que se viene a mirar.
const REGLA = PARAMS.get('regla') === '1'
// El tema: ?tema=claro. Hacía falta porque el banco solo se miraba en oscuro
// y el inbox de verdad se usa en CLARO, donde los colores no son los mismos
// (--c-acento pasa de 0 168 132 a 0 138 108 sobre panel blanco).
document.documentElement.setAttribute('data-tema', PARAMS.get('tema') === 'claro' ? 'claro' : 'oscuro')

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const MX: Canal = {
  id: 1, tipo: 'whatsapp_cloud', identificador: '123', nombre: 'México',
  pais: 'mx', ventana_horas: 24, soporta_media: true, soporta_plantillas: true,
  activo: true, bot_activo: true,
} as Canal

const producto = (nombre: string, estado: ProductoConversacion['estado']): ProductoConversacion => ({
  id: 1, conversacion_id: 1, producto: nombre, estado,
  creado: '2026-08-24T09:00:00Z', actualizado: '2026-08-24T09:00:00Z',
  marcado_por: null, marcado_en: null, validado_por: null,
} as ProductoConversacion)

const base: Conversacion = {
  id: 1, cliente_id: '5215591937975', telefono: null, nombre: null,
  ultimo_texto: 'hola', ultimo_en: '2026-08-24T09:14:00Z',
  ultimo_del_cliente: '2026-08-24T09:14:00Z', no_leidos: 0, bot_activo: true,
  ctwa_clid: null, ad_id: null, creado: '2026-08-01T09:00:00Z',
  canal: 'whatsapp_cloud', canal_id: 1, favorita: false, fijada: false,
  silenciada: false, bloqueada: false, bloqueada_en: null, bloqueo_nota: null,
  escalada_en: null, escalada_motivo: null,
  escalada_vista_en: null, escalada_vista_por: null,
  etiquetas: [], conversacion_productos: [],
}

// De lo más benigno a lo más bestia. El último es el caso que hay que mirar.
const CASOS: { titulo: string; conv: Conversacion; canal?: Canal; callada?: boolean; marcada?: boolean }[] = [
  {
    titulo: '1. Lo normal: número, nombre corto, un producto',
    conv: { ...base, nombre: 'Ana', ultimo_texto: 'me interesa, cuánto sale',
      conversacion_productos: [producto('lucessolares', 'interesado')] },
    canal: MX,
  },
  {
    titulo: '2. Sin nombre y sin producto (fila de dos líneas)',
    conv: { ...base, cliente_id: '5218112345678', nombre: null, ultimo_texto: '📍 Ubicación', no_leidos: 3 },
    canal: MX,
  },
  {
    titulo: '3. Nombre LARGO + producto LARGO + pedido pendiente',
    conv: { ...base, cliente_id: '5215512345678',
      nombre: 'María Guadalupe Hernández de la Torre',
      ultimo_texto: 'ya te mandé mi ubicación, ahí es donde vivo',
      no_leidos: 12,
      conversacion_productos: [producto('lucessolares', 'pendiente')] },
    canal: MX,
  },
  {
    titulo: '4. EL PEOR: nombre largo, DOS productos largos, 4 etiquetas, fijada, favorita, marcada, canal pausado',
    conv: { ...base, cliente_id: '5216641234567',
      nombre: 'Juan Carlos Villalobos Santamaría',
      ultimo_texto: 'oye y me lo puedes mandar a Ciudad Juárez o nomás a Monterrey',
      no_leidos: 137, fijada: true, favorita: true,
      etiquetas: [
        { id: 1, nombre: 'Urgente', color: 'rojo', orden: 1 },
        { id: 2, nombre: 'Repetidor', color: 'verde', orden: 2 },
        { id: 3, nombre: 'Mayoreo', color: 'azul', orden: 3 },
        { id: 4, nombre: 'Revisar', color: 'amarillo', orden: 4 },
      ],
      conversacion_productos: [
        producto('lucessolares', 'validado'),
        producto('cojinalivia', 'pendiente'),
      ] },
    canal: MX,
    callada: true,
    marcada: true,
  },
  {
    titulo: '5. FIJADA: una sola chincheta, verde, la del botón',
    conv: { ...base, cliente_id: '5215544332211', nombre: 'Rosa',
      ultimo_texto: '¿me llega mañana?', fijada: true },
    canal: MX,
  },
  {
    titulo: '6. SIN fijar: ninguna chincheta encendida',
    conv: { ...base, cliente_id: '5215577665544', nombre: 'Rosa',
      ultimo_texto: '¿me llega mañana?', fijada: false },
    canal: MX,
  },
  {
    // La mano roja tiene que salir arriba a la derecha, ANTES del BotOff y
    // del marcapáginas. Y el motivo solo en el `title`: aquí se mira que un
    // motivo largo no le robe ancho al nombre.
    titulo: '7. ESCALADA: mano roja arriba a la derecha, motivo solo en el title',
    conv: { ...base, cliente_id: '5214426020912', nombre: 'Verónica',
      ultimo_texto: 'y cuánto tarda en llegar a Chiapas?',
      no_leidos: 2,
      escalada_en: new Date().toISOString(),
      escalada_motivo: 'el cliente pregunta por el coste de envío a una zona que no está en el catálogo y no tengo el dato' },
    canal: MX,
  },
  {
    // EL CASO QUE HAY QUE MIRAR de los dos: escaló, alguien lo resolvió, y
    // NO tiene que salir la mano. Si sale, `escaladaAbierta` está mirando
    // solo `escalada_en` y el contador de la barra no bajará nunca.
    titulo: '7b. ESCALADA Y RESUELTA: sin mano. Si se ve, el aviso no se apaga nunca',
    conv: { ...base, cliente_id: '5214426020913', nombre: 'Verónica (resuelta)',
      ultimo_texto: 'ah vale, gracias',
      escalada_en: '2026-09-08T09:00:00Z',
      escalada_motivo: 'el mismo motivo de arriba',
      escalada_vista_en: '2026-09-08T09:04:00Z' },
    canal: MX,
  },
  {
    // Y el tercero: resuelta ANTES y vuelta a escalar DESPUÉS. La mano
    // tiene que volver sola, sin que nadie toque nada.
    titulo: '7c. REABIERTA: resuelta a las 9:04 y escalada otra vez a las 9:20. Mano SÍ',
    conv: { ...base, cliente_id: '5214426020914', nombre: 'Verónica (reabierta)',
      ultimo_texto: 'oiga, sigo esperando',
      escalada_en: '2026-09-08T09:20:00Z',
      escalada_motivo: 'vuelve a preguntar lo mismo',
      escalada_vista_en: '2026-09-08T09:04:00Z' },
    canal: MX,
  },
  {
    // ⚠️ EL CASO DE VERDAD, medido contra producción el 6/9/2026.
    //
    // Los casos de arriba mienten sin querer: todos tienen producto (así que
    // el carrito se ve) y todos traen una hora larga tipo "24/08/26", que es
    // la celda que ensancha la rejilla a 44 px. En el inbox real la mayoría
    // de las filas NO tienen pedido —el carrito está a `opacity: 0`, solo
    // asoma al pasar por encima— y la hora del día es corta ("11:13", 26 px).
    //
    // Resultado medido en producción: columnas de 26 px, no de 44, y el
    // contador solo en la esquina, sin carrito encima al que ir "al lado".
    titulo: '0. COMO PRODUCCIÓN: sin pedido, hora corta, solo no leídos',
    conv: { ...base, cliente_id: '34641691299', nombre: 'Adil',
      ultimo_texto: 'hola', no_leidos: 1,
      ultimo_en: new Date().toISOString() },
    canal: MX,
  },
  {
    // ⚠️ EL CASO QUE HAY QUE MEDIR, y con las condiciones de producción, no
    // con las cómodas: hora CORTA (26 px, no los 44 de una fecha larga) y
    // nombre corto. Con la fecha larga la rejilla va ancha y todo cabe
    // aunque no quepa de verdad — ese fue el error de medición del 6/9.
    //
    // LOS TRES A LA VEZ, que es lo que pasa en una incidencia real desde
    // que María se pausa sola al escalar:
    //   · carrito AMARILLO   (pedido pendiente)
    //   · triángulo rojo     (incidencia)
    //   · BotOff             (canal pausado)
    //
    // Si algo se va a quedar sin sitio, se ve aquí. Y lo que NO puede
    // perderse es el carrito: es la señal de que hay un pedido esperando.
    titulo: '0c. LOS TRES A LA VEZ, con hora corta: carrito amarillo + incidencia + BotOff',
    conv: { ...base, cliente_id: '5213318302593', nombre: 'Carmen Escobedo',
      ultimo_texto: 'ya te mandé mis datos, ¿cuándo llega?',
      no_leidos: 3,
      ultimo_en: new Date().toISOString(),
      escalada_en: new Date().toISOString(),
      escalada_motivo: 'pregunta por una zona que no está en el catálogo',
      conversacion_productos: [producto('lucessolares', 'pendiente')] },
    canal: MX,
    callada: true,
  },
  {
    // El mismo caso de producción pero con el contador de 3 cifras, que es
    // el único que ensancha la rejilla: "99+" mide ~31 px y pasa a ser la
    // celda más ancha por delante de la hora corta (26 px). Aquí se mira
    // que las tres columnas crezcan A LA VEZ y sigan alineadas.
    titulo: '0b. COMO PRODUCCIÓN con 99+: la rejilla se ensancha a la vez',
    conv: { ...base, cliente_id: '5213318302593', nombre: 'Carmen Escobedo',
      ultimo_texto: 'sigo esperando respuesta', no_leidos: 137,
      ultimo_en: new Date().toISOString() },
    canal: MX,
  },
  {
    // El caso que se pidió mirar: los tres a la vez, sin el ruido del
    // nombre kilométrico del caso 4. Carrito VERDE (validado), contador de
    // no leídos justo debajo y chincheta encendida.
    titulo: '7. Carrito VERDE + no leídos + fijada (los tres a la vez)',
    conv: { ...base, cliente_id: '5218331122334', nombre: 'Lupita',
      ultimo_texto: '¿ya salió mi pedido?', no_leidos: 5, fijada: true,
      conversacion_productos: [producto('lucessolares', 'validado')] },
    canal: MX,
  },
  {
    titulo: '8. Sin canal (no hay chip MX): la hora se queda sola',
    conv: { ...base, cliente_id: '34641691299', nombre: 'Adil',
      ultimo_texto: 'perfecto, gracias', ultimo_en: '2026-08-21T18:02:00Z' },
    canal: undefined,
  },
]

function Regla() {
  const [txt, setTxt] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => {
      const filas = [...document.querySelectorAll('[role="button"]')]
      const lineas = filas.slice(0, 5).map((f, i) => {
        const hijos = [...f.children].filter((c) => c.tagName === 'DIV')
        const acciones = hijos[2]
        if (!acciones) return 'fila ' + (i + 1) + ' sin acciones'
        // Los 6 huecos de la rejilla en orden: pin, favorito, carrito,
        // canal, hora, no leídos. Miramos el CENTRO de cada uno: lo que hay
        // que ver es que la columna de abajo cae bajo la de arriba.
        const centroDe = (el: Element | undefined) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return Math.round(r.left + r.width / 2 - acciones.getBoundingClientRect().left)
        }
        const cajas = [...acciones.children]
        const favorito = cajas[1], carrito = cajas[2], hora = cajas[4], noLeidos = cajas[5]
        return [
          'fila ' + (i + 1),
          'favorito@' + centroDe(favorito),
          'hora@' + centroDe(hora),
          '| carrito@' + centroDe(carrito),
          'noleidos@' + centroDe(noLeidos),
        ].join(' ')
      })
      setTxt(lineas.join(String.fromCharCode(10)))
    }, 600)
    return () => window.clearTimeout(t)
  }, [])
  return <pre className="mb-3 whitespace-pre-wrap text-[9px] leading-tight text-amber-300">{txt}</pre>
}

function Banco() {
  return (
    <div className="min-h-full overflow-hidden bg-fondo p-3 text-texto" style={{ width: ANCHO }}>
      <p className="mb-3 text-xs text-texto2">
        {ANCHO} px · la HORA bajo el favorito, los NO LEÍDOS bajo el carrito,
        el chip del canal bajo la chincheta
      </p>
      {REGLA && <Regla />}
      {CASOS.map((c, i) => (
        <div key={i} className="mb-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-texto2">{c.titulo}</p>
          <div className="rounded-lg border border-borde">
            <Fila
              conv={c.conv}
              canal={c.canal}
              callada={!!c.callada}
              activa={false}
              ultima={false}
              resaltada={false}
              marcada={!!c.marcada}
              abierta={false}
              onClick={() => {}}
              onMarcar={() => {}}
              onDeslizar={() => {}}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={cliente}><Banco /></QueryClientProvider>,
)
