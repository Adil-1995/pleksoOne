import { useState } from 'react'
import { Plus, Trash2, Check, X, Loader2 } from 'lucide-react'
import { useEtiquetas, useContarEtiquetas, useGestionEtiquetas } from '@/hooks/datos'
import { COLORES_ETIQUETA, clasePunto, clasePastilla, nombreColor } from '@/lib/colores'
import { Confirmacion } from '../Confirmacion'
import type { Etiqueta } from '@/tipos'

export function PanelEtiquetas() {
  const { data: etiquetas, isPending } = useEtiquetas()
  const { data: cuenta } = useContarEtiquetas()
  const { crear, editar, borrar } = useGestionEtiquetas()

  const [nombreNuevo, setNombreNuevo] = useState('')
  const [colorNuevo, setColorNuevo] = useState<string>('azul')
  const [editando, setEditando] = useState<number | null>(null)
  const [borrando, setBorrando] = useState<Etiqueta | null>(null)

  const errorCrear = crear.error instanceof Error ? crear.error.message : null

  async function anadir() {
    const n = nombreNuevo.trim()
    if (!n) return
    try {
      await crear.mutateAsync({ nombre: n, color: colorNuevo })
      setNombreNuevo('')
    } catch { /* el error se pinta debajo */ }
  }

  return (
    <div>
        <p className="mb-4 text-sm text-texto2">
          Las etiquetas son para lo que no cabe en ningún otro sitio: reclamación,
          cliente difícil, pendiente de pago. Quién está pausado ya lo dice el botón
          de María, y el estado del pedido vive en <code className="text-texto">pedidos</code>.
        </p>

        {/* ── Crear ── */}
        <div className="mb-6 rounded-lg border border-borde bg-panel p-3">
          <div className="flex gap-2">
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') anadir() }}
              placeholder="Nombre de la etiqueta"
              maxLength={40}
              className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-texto2"
            />
            <button
              onClick={anadir}
              disabled={!nombreNuevo.trim() || crear.isPending}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-acento px-3 py-2 text-sm font-medium text-fondo disabled:opacity-40"
            >
              {crear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear
            </button>
          </div>
          <ElegirColor valor={colorNuevo} onCambio={setColorNuevo} />
          {errorCrear && <p className="mt-2 text-xs text-alerta">{errorCrear}</p>}
        </div>

        {/* ── Lista ── */}
        {isPending && <p className="text-sm text-texto2">Cargando…</p>}

        {!isPending && !(etiquetas ?? []).length && (
          <p className="rounded-lg border border-dashed border-borde px-4 py-8 text-center text-sm text-texto2">
            Todavía no hay ninguna etiqueta.
          </p>
        )}

        <ul className="space-y-2">
          {(etiquetas ?? []).map((e) => (
            <li key={e.id} className="rounded-lg border border-borde bg-panel p-3">
              {editando === e.id ? (
                <FilaEdicion
                  etiqueta={e}
                  guardando={editar.isPending}
                  onGuardar={async (nombre, color) => {
                    try {
                      await editar.mutateAsync({ id: e.id, nombre, color })
                      setEditando(null)
                    } catch { /* se queda abierto con el error visible */ }
                  }}
                  onCancelar={() => setEditando(null)}
                  error={editar.error instanceof Error ? editar.error.message : null}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <span className={['h-3 w-3 shrink-0 rounded-full', clasePunto(e.color)].join(' ')} />
                  <button
                    onClick={() => setEditando(e.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                    title="Cambiar nombre o color"
                  >
                    {e.nombre}
                  </button>
                  <span className="shrink-0 text-xs text-texto2">
                    {cuenta?.[e.id] ?? 0} {(cuenta?.[e.id] ?? 0) === 1 ? 'conversación' : 'conversaciones'}
                  </span>
                  <button
                    onClick={() => setBorrando(e)}
                    className="shrink-0 rounded p-1.5 text-texto2 hover:bg-alerta/15 hover:text-alerta"
                    aria-label={'Borrar ' + e.nombre}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      <Confirmacion
        abierto={borrando !== null}
        peligrosa
        titulo="¿Borrar esta etiqueta?"
        detalle={borrando?.nombre}
        cuerpo={
          <>
            Se quitará de{' '}
            <strong className="text-texto">
              {cuenta?.[borrando?.id ?? -1] ?? 0}{' '}
              {(cuenta?.[borrando?.id ?? -1] ?? 0) === 1 ? 'conversación' : 'conversaciones'}
            </strong>
            . Las conversaciones no se tocan, solo pierden la etiqueta.
          </>
        }
        textoConfirmar="Sí, borrar"
        trabajando={borrar.isPending}
        error={borrar.error instanceof Error ? borrar.error.message : null}
        onConfirmar={async () => {
          if (!borrando) return
          try { await borrar.mutateAsync(borrando.id); setBorrando(null) } catch { /* visible */ }
        }}
        onCancelar={() => setBorrando(null)}
      />
    </div>
  )
}

function FilaEdicion({
  etiqueta, guardando, error, onGuardar, onCancelar,
}: {
  etiqueta: Etiqueta
  guardando: boolean
  error: string | null
  onGuardar: (nombre: string, color: string) => void
  onCancelar: () => void
}) {
  const [nombre, setNombre] = useState(etiqueta.nombre)
  const [color, setColor] = useState(etiqueta.color)

  return (
    <div>
      <div className="flex gap-2">
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onGuardar(nombre, color)
            if (e.key === 'Escape') onCancelar()
          }}
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={() => onGuardar(nombre, color)}
          disabled={!nombre.trim() || guardando}
          className="shrink-0 rounded-lg bg-acento p-2 text-fondo disabled:opacity-40"
          aria-label="Guardar"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          onClick={onCancelar}
          className="shrink-0 rounded-lg p-2 text-texto2 hover:bg-panel2"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ElegirColor valor={color} onCambio={setColor} />
      {error && <p className="mt-2 text-xs text-alerta">{error}</p>}
    </div>
  )
}

/**
 * Paleta CERRADA. Nueve colores y ni uno más — el mismo listado que impone el
 * CHECK de la tabla. Sin selector libre: con uno, en un mes hay catorce azules
 * que nadie distingue y las etiquetas dejan de servir para reconocer nada.
 */
function ElegirColor({ valor, onCambio }: { valor: string; onCambio: (c: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {COLORES_ETIQUETA.map((c) => (
        <button
          key={c}
          onClick={() => onCambio(c)}
          title={nombreColor(c)}
          aria-label={nombreColor(c)}
          aria-pressed={valor === c}
          className={[
            'flex h-7 w-7 items-center justify-center rounded-full transition-transform',
            valor === c ? 'scale-110 ring-2 ring-texto ring-offset-2 ring-offset-panel' : 'hover:scale-105',
          ].join(' ')}
        >
          <span className={['h-4 w-4 rounded-full', clasePunto(c)].join(' ')} />
        </button>
      ))}
      <span className={['ml-auto rounded-full px-2 py-0.5 text-[11px] ring-1', clasePastilla(valor)].join(' ')}>
        así se verá
      </span>
    </div>
  )
}
