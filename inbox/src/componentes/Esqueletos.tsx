/**
 * Esqueletos, no ruedas girando.
 * Una rueda dice "espera"; un esqueleto dice "esto es lo que va a aparecer",
 * y la pantalla no da el salto cuando llegan los datos.
 */

export function EsqueletoLista() {
  return (
    <div className="divide-y divide-borde" aria-busy="true" aria-label="Cargando conversaciones">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="esqueleto h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="esqueleto h-3.5" style={{ width: `${35 + ((i * 13) % 30)}%` }} />
              <div className="esqueleto h-3 w-10" />
            </div>
            <div className="esqueleto h-3" style={{ width: `${50 + ((i * 17) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EsqueletoHilo() {
  const anchos = [45, 62, 38, 70, 52, 30, 58]
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Cargando mensajes">
      {anchos.map((w, i) => (
        <div key={i} className={i % 3 === 0 ? 'self-end' : 'self-start'}>
          <div
            className="esqueleto h-10 rounded-lg"
            style={{ width: `${w}%`, minWidth: 120 }}
          />
        </div>
      ))}
    </div>
  )
}

export function Vacio({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <p className="text-texto2">{titulo}</p>
      {detalle && <p className="mt-1 text-sm text-texto2/70">{detalle}</p>}
    </div>
  )
}
