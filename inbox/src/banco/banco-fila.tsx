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
    titulo: '5. Sin canal (no hay chip MX): la hora se queda sola',
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
        // (vacío), hora, canal. Miramos el CENTRO de cada uno.
        const centroDe = (el) => {
          if (!el) return null
          const r = el.getBoundingClientRect()
          return Math.round(r.left + r.width / 2 - acciones.getBoundingClientRect().left)
        }
        const cajas = [...acciones.children]
        const favorito = cajas[1], carrito = cajas[2], hora = cajas[4], canal = cajas[5]
        return [
          'fila ' + (i + 1),
          'favorito@' + centroDe(favorito),
          'hora@' + centroDe(hora),
          '| carrito@' + centroDe(carrito),
          'canal@' + centroDe(canal),
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
        {ANCHO} px · la HORA bajo el favorito, el chip del canal bajo el carrito
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
