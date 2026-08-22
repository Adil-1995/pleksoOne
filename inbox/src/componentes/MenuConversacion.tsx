import { useState } from 'react'
import {
  MoreVertical, BellOff, Bell, Ban, ShieldCheck, Pin, Star, ShoppingCart,
  Tag, Check, Loader2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  usePonerSilenciada, usePonerFavorita, usePonerFijada,
  useMarcarProducto, useEtiquetas, useEtiquetarConversacion, claves,
} from '@/hooks/datos'
import { bloquear as bloquearEnMeta } from '@/lib/envio'
import { clasePunto } from '@/lib/colores'
import {
  nombreProducto, productosDe, estadoPedidoDe, CATALOGO_CONOCIDO,
  CICLO_PEDIDO, PINTA_PEDIDO,
} from '@/lib/productos'
import type { Conversacion } from '@/tipos'
import { Confirmacion } from './Confirmacion'
import { Modal } from './Modal'

type Pantalla = null | 'menu' | 'productos' | 'etiquetas'

/**
 * Las acciones de la conversación, detrás de los tres puntos.
 *
 * Antes eran seis iconos sueltos en la cabecera. Con el nombre y el número a
 * la izquierda no quedaba sitio, y en el móvil el nombre acababa en dos
 * letras. Aquí caben todas con su etiqueta escrita, que además quita el
 * juego de adivinar qué hace cada dibujo.
 *
 * La pausa NO entra aquí: es el control de seguridad del inbox y se queda
 * suelta en la cabecera, a un toque. Todo lo demás sí, porque nada de esto
 * es urgente y con la etiqueta escrita se acierta a la primera.
 */
export function MenuConversacion({ conv }: { conv: Conversacion }) {
  const [pantalla, setPantalla] = useState<Pantalla>(null)
  const [confirmando, setConfirmando] = useState<null | 'bloquear' | 'desbloquear'>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const silenciar = usePonerSilenciada()
  const favorita = usePonerFavorita()
  const fijada = usePonerFijada()
  const marcar = useMarcarProducto()
  const etiquetar = useEtiquetarConversacion()
  const { data: etiquetas } = useEtiquetas()
  const qc = useQueryClient()

  const productos = productosDe(conv)
  const estadoPedido = estadoPedidoDe(productos)
  const puestas = new Set((conv.etiquetas ?? []).map((e) => e.id))

  const yaPuestos = new Set(productos.map((p) => p.producto))
  const opcionesProducto = [
    ...productos.map((p) => ({ id: p.producto, estado: p.estado })),
    ...CATALOGO_CONOCIDO.filter((id) => !yaPuestos.has(id)).map((id) => ({ id, estado: null as null })),
  ]

  async function confirmarBloqueo() {
    const quiero = confirmando === 'bloquear'
    setTrabajando(true)
    setError(null)
    const r = await bloquearEnMeta(conv.cliente_id, quiero)
    setTrabajando(false)
    if (!r.ok) {
      setError(r.error ?? 'No se pudo completar en WhatsApp')
      return
    }
    setConfirmando(null)
    qc.invalidateQueries({ queryKey: claves.conversaciones })
  }

  const cerrar = () => setPantalla(null)

  return (
    <>
      <button
        onClick={() => setPantalla('menu')}
        className="rounded-full p-2 text-texto2 hover:bg-panel2"
        aria-label="Acciones de la conversación"
        aria-expanded={pantalla !== null}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/* ── Menú principal ── */}
      <Modal
        abierto={pantalla === 'menu'}
        titulo={conv.nombre || conv.cliente_id}
        onCerrar={cerrar}
      >
        {/* La pausa NO está aquí: vive suelta en la cabecera, a un toque.
            Es el control de seguridad del inbox y meterlo en un menú lo
            ponía a dos. */}
        <div className="py-1">
          <Opcion
            icono={Pin}
            color={conv.fijada ? 'text-acento' : 'text-texto2'}
            titulo={conv.fijada ? 'Dejar de fijar' : 'Fijar arriba'}
            detalle="Las fijadas van por encima de las demás, sin importar la fecha."
            marcado={!!conv.fijada}
            cargando={fijada.isPending}
            onClick={() => { fijada.mutate({ clienteId: conv.cliente_id, valor: !conv.fijada }); cerrar() }}
          />

          <Opcion
            icono={Star}
            color={conv.favorita ? 'text-amber-400' : 'text-texto2'}
            titulo={conv.favorita ? 'Quitar de favoritos' : 'Marcar como favorita'}
            marcado={!!conv.favorita}
            cargando={favorita.isPending}
            onClick={() => { favorita.mutate({ clienteId: conv.cliente_id, valor: !conv.favorita }); cerrar() }}
          />

          <Opcion
            icono={ShoppingCart}
            color={PINTA_PEDIDO[estadoPedido].color || 'text-texto2'}
            titulo="Estado del pedido"
            detalle={PINTA_PEDIDO[estadoPedido].texto + ' · ' + PINTA_PEDIDO[estadoPedido].detalle}
            onClick={() => setPantalla('productos')}
          />

          <Opcion
            icono={Tag}
            color={puestas.size ? 'text-acento' : 'text-texto2'}
            titulo="Etiquetas"
            detalle={puestas.size
              ? (conv.etiquetas ?? []).map((e) => e.nombre).join(', ')
              : 'Sin etiquetas'}
            onClick={() => setPantalla('etiquetas')}
          />

          <div className="my-1 border-t border-borde" />

          <Opcion
            icono={conv.silenciada ? Bell : BellOff}
            color={conv.silenciada ? 'text-acento' : 'text-aviso'}
            titulo={conv.silenciada ? 'Quitar el silencio' : 'Silenciar'}
            detalle={conv.silenciada
              ? 'Vuelve a la bandeja y María responde otra vez.'
              : 'Los mensajes se guardan, pero María no responde. Reversible.'}
            cargando={silenciar.isPending}
            onClick={() => { silenciar.mutate({ clienteId: conv.cliente_id, valor: !conv.silenciada }); cerrar() }}
          />

          <Opcion
            icono={conv.bloqueada ? ShieldCheck : Ban}
            color={conv.bloqueada ? 'text-acento' : 'text-alerta'}
            titulo={conv.bloqueada ? 'Desbloquear' : 'Bloquear en WhatsApp'}
            detalle={conv.bloqueada
              ? 'Volverá a poder escribirte.'
              : 'Sus mensajes dejan de llegar. Se hace en WhatsApp, no solo aquí.'}
            peligrosa={!conv.bloqueada}
            onClick={() => {
              setError(null)
              setConfirmando(conv.bloqueada ? 'desbloquear' : 'bloquear')
              cerrar()
            }}
          />
        </div>
      </Modal>

      {/* ── Productos ── */}
      <Modal
        abierto={pantalla === 'productos'}
        titulo="Estado del pedido"
        onCerrar={cerrar}
      >
        <div className="divide-y divide-borde">
          {opcionesProducto.map(({ id, estado: e }) => (
            <div key={id} className="px-4 py-3">
              <div className="mb-2 truncate text-sm font-medium">
                {nombreProducto(id)}
                {e === null && (
                  <span className="ml-2 text-[11px] font-normal text-texto2">
                    no está en esta conversación
                  </span>
                )}
              </div>
              {/* Los tres estados escritos, sin ciclar: aquí hay sitio para
                  decir qué significa cada uno, y elegir directamente evita
                  pulsar dos veces para llegar al que quieres. */}
              <div className="flex gap-1.5">
                {CICLO_PEDIDO.map((op) => {
                  const puesto = (e ?? 'interesado') === op && !(e === null && op !== 'interesado')
                  return (
                    <button
                      key={op}
                      onClick={() => {
                        marcar.mutate({ conversacionId: conv.id, producto: id, estado: op })
                        cerrar()
                      }}
                      title={PINTA_PEDIDO[op].detalle}
                      className={[
                        'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ring-1 transition-colors',
                        puesto
                          ? 'bg-acento text-fondo ring-acento'
                          : 'bg-panel2 text-texto2 ring-transparent hover:text-texto',
                      ].join(' ')}
                    >
                      {op === 'interesado' ? 'Sin pedido' : op === 'pendiente' ? 'Pendiente' : 'Validado'}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Etiquetas ── */}
      <Modal abierto={pantalla === 'etiquetas'} titulo="Etiquetas" onCerrar={cerrar}>
        <div className="py-1">
          {!(etiquetas ?? []).length && (
            <p className="px-4 py-4 text-sm text-texto2">
              Todavía no hay etiquetas. Créalas desde el icono de etiquetas del inbox.
            </p>
          )}
          {(etiquetas ?? []).map((e) => {
            const puesta = puestas.has(e.id)
            return (
              <button
                key={e.id}
                onClick={() => etiquetar.mutate({ conversacionId: conv.id, etiqueta: e, poner: !puesta })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel2"
              >
                <span className={['h-3 w-3 shrink-0 rounded-full', clasePunto(e.color)].join(' ')} />
                <span className="min-w-0 flex-1 truncate text-sm">{e.nombre}</span>
                {puesta && <Check className="h-4 w-4 shrink-0 text-acento" />}
              </button>
            )
          })}
        </div>
      </Modal>

      <Confirmacion
        abierto={confirmando !== null}
        peligrosa={confirmando === 'bloquear'}
        titulo={confirmando === 'bloquear' ? '¿Bloquear a este cliente?' : '¿Desbloquear a este cliente?'}
        detalle={`+${conv.cliente_id}${conv.nombre ? '   ·   ' + conv.nombre : ''}`}
        cuerpo={
          confirmando === 'bloquear' ? (
            <>
              Se bloquea en WhatsApp de verdad: sus mensajes dejarán de llegar y no
              podrás escribirle. Se puede deshacer desde aquí.
              <br /><br />
              <span className="text-texto2">
                WhatsApp solo deja bloquear a quien te haya escrito en las últimas 24 h.
                Si ha pasado más tiempo, Meta lo rechazará.
              </span>
            </>
          ) : (
            <>Volverá a poder escribirte y tú a él.</>
          )
        }
        textoConfirmar={confirmando === 'bloquear' ? 'Sí, bloquear' : 'Sí, desbloquear'}
        trabajando={trabajando}
        error={error}
        onConfirmar={confirmarBloqueo}
        onCancelar={() => { if (!trabajando) { setConfirmando(null); setError(null) } }}
      />
    </>
  )
}

function Opcion({
  icono: Icono, color, titulo, detalle, marcado, peligrosa, cargando, onClick,
}: {
  icono: typeof Pin
  color: string
  titulo: string
  detalle?: string
  marcado?: boolean
  peligrosa?: boolean
  cargando?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={cargando}
      className={[
        'flex w-full items-start gap-3 px-4 py-3 text-left disabled:opacity-50',
        peligrosa ? 'hover:bg-alerta/10' : 'hover:bg-panel2',
      ].join(' ')}
    >
      {cargando
        ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-texto2" />
        : <Icono className={['mt-0.5 h-5 w-5 shrink-0', color, marcado ? 'fill-current' : ''].join(' ')} />}
      <span className="min-w-0 flex-1">
        <span className={['block text-sm', peligrosa ? 'text-alerta' : ''].join(' ')}>{titulo}</span>
        {detalle && <span className="block text-[11px] leading-tight text-texto2">{detalle}</span>}
      </span>
      {marcado && <Check className="mt-0.5 h-4 w-4 shrink-0 text-acento" />}
    </button>
  )
}
