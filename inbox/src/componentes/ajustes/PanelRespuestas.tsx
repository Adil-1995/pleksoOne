import { useState } from 'react'
import { Plus, Trash2, Check, X, Loader2 } from 'lucide-react'
import { useRespuestas, useGestionRespuestas } from '@/hooks/datos'
import { ATAJO_VALIDO, normalizarAtajo } from '@/lib/respuestas'
import { Confirmacion } from '../Confirmacion'
import type { RespuestaRapida } from '@/tipos'

export function PanelRespuestas() {
  const { data: respuestas, isPending } = useRespuestas()
  const { crear, editar, borrar } = useGestionRespuestas()

  const [atajoNuevo, setAtajoNuevo] = useState('')
  const [textoNuevo, setTextoNuevo] = useState('')
  const [editando, setEditando] = useState<number | null>(null)
  const [borrando, setBorrando] = useState<RespuestaRapida | null>(null)

  const errorCrear = crear.error instanceof Error ? crear.error.message : null
  const atajoLimpio = normalizarAtajo(atajoNuevo)
  const atajoMal = atajoLimpio.length > 0 && !ATAJO_VALIDO.test(atajoLimpio)
  const puedeCrear = atajoLimpio.length > 0 && !atajoMal && textoNuevo.trim().length > 0

  async function anadir() {
    if (!puedeCrear) return
    try {
      await crear.mutateAsync({ atajo: atajoLimpio, texto: textoNuevo })
      setAtajoNuevo(''); setTextoNuevo('')
    } catch { /* el error se pinta debajo */ }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-texto2">
        Lo que escribes una y otra vez, guardado. En el campo de mensaje escribe{' '}
        <code className="text-texto">/</code> y sale la lista; sigue escribiendo para
        filtrar. Al elegir una, el texto <strong className="text-texto">se inserta</strong>{' '}
        para que puedas retocarlo — no se envía solo.
      </p>
      <p className="mb-4 text-sm text-texto2">
        Son del equipo: las ve y las edita todo el que entra al inbox. Dos personas
        atendiendo el mismo WhatsApp tienen que contestar lo mismo.
      </p>

      {/* ── Crear ── */}
      <div className="mb-6 rounded-lg border border-borde bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-sm text-texto2">/</span>
          <input
            value={atajoNuevo}
            onChange={(e) => setAtajoNuevo(e.target.value)}
            placeholder="envio"
            maxLength={24}
            className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 font-mono text-sm outline-none placeholder:text-texto2"
          />
        </div>
        <textarea
          value={textoNuevo}
          onChange={(e) => setTextoNuevo(e.target.value)}
          placeholder="El texto que se insertará en el mensaje"
          rows={3}
          className="mt-2 w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-sm outline-none placeholder:text-texto2"
        />
        <div className="mt-2 flex items-center gap-2">
          {atajoMal && (
            <p className="flex-1 text-xs text-alerta">
              El atajo no puede llevar espacios ni barras.
            </p>
          )}
          <button
            onClick={anadir}
            disabled={!puedeCrear || crear.isPending}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-acento px-3 py-2 text-sm font-medium text-fondo disabled:opacity-40"
          >
            {crear.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear
          </button>
        </div>
        {errorCrear && <p className="mt-2 text-xs text-alerta">{errorCrear}</p>}
      </div>

      {/* ── Lista ── */}
      {isPending && <p className="text-sm text-texto2">Cargando…</p>}

      {!isPending && !(respuestas ?? []).length && (
        <p className="rounded-lg border border-dashed border-borde px-4 py-8 text-center text-sm text-texto2">
          Todavía no hay ninguna respuesta guardada.
        </p>
      )}

      <ul className="space-y-2">
        {(respuestas ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-borde bg-panel p-3">
            {editando === r.id ? (
              <FilaEdicion
                respuesta={r}
                guardando={editar.isPending}
                error={editar.error instanceof Error ? editar.error.message : null}
                onGuardar={async (atajo, texto) => {
                  try {
                    await editar.mutateAsync({ id: r.id, atajo, texto })
                    setEditando(null)
                  } catch { /* se queda abierto con el error visible */ }
                }}
                onCancelar={() => setEditando(null)}
              />
            ) : (
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setEditando(r.id)}
                  className="min-w-0 flex-1 text-left"
                  title="Cambiar el atajo o el texto"
                >
                  <span className="rounded bg-acento/15 px-1.5 py-0.5 font-mono text-xs text-acento">
                    /{r.atajo}
                  </span>
                  {/* whitespace-pre-wrap: una respuesta con saltos de línea
                      —la de pedir los datos del envío— se ve como se enviará,
                      no aplastada en una sola línea. */}
                  <span className="mt-1.5 block whitespace-pre-wrap break-words text-sm text-texto2">
                    {r.texto}
                  </span>
                </button>
                <button
                  onClick={() => setBorrando(r)}
                  className="shrink-0 rounded p-1.5 text-texto2 hover:bg-alerta/15 hover:text-alerta"
                  aria-label={'Borrar /' + r.atajo}
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
        titulo="¿Borrar esta respuesta?"
        detalle={borrando ? '/' + borrando.atajo : undefined}
        cuerpo={
          <>
            Deja de estar disponible con <code className="text-texto">/</code> para todo
            el equipo. No afecta a ningún mensaje ya enviado.
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
  respuesta, guardando, error, onGuardar, onCancelar,
}: {
  respuesta: RespuestaRapida
  guardando: boolean
  error: string | null
  onGuardar: (atajo: string, texto: string) => void
  onCancelar: () => void
}) {
  const [atajo, setAtajo] = useState(respuesta.atajo)
  const [texto, setTexto] = useState(respuesta.texto)

  const limpio = normalizarAtajo(atajo)
  const mal = limpio.length > 0 && !ATAJO_VALIDO.test(limpio)
  const puede = limpio.length > 0 && !mal && texto.trim().length > 0

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-sm text-texto2">/</span>
        <input
          autoFocus
          value={atajo}
          onChange={(e) => setAtajo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancelar() }}
          maxLength={24}
          className="min-w-0 flex-1 rounded-lg bg-panel2 px-3 py-2 font-mono text-sm outline-none"
        />
        <button
          onClick={() => puede && onGuardar(limpio, texto)}
          disabled={!puede || guardando}
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
      {/* Sin «Enter guarda» a propósito: el texto lleva saltos de línea y
          Enter tiene que poder hacer su trabajo dentro del textarea. */}
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancelar() }}
        rows={4}
        className="mt-2 w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-sm outline-none"
      />
      {mal && <p className="mt-2 text-xs text-alerta">El atajo no puede llevar espacios ni barras.</p>}
      {error && <p className="mt-2 text-xs text-alerta">{error}</p>}
    </div>
  )
}
