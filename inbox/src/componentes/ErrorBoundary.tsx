import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Copy } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Para saber qué parte de la app reventó. */
  zona?: string
}
interface Estado {
  error: Error | null
  pila: string | null
}

/**
 * Sin esto, cualquier throw durante el render deja la pantalla en negro y la
 * app no se recupera ni volviendo atrás: React desmonta el árbol entero.
 *
 * Con esto, el error se lee en pantalla. Es lo que convierte "no funciona"
 * en algo diagnosticable sin abrir la consola.
 */
export class ErrorBoundary extends Component<Props, Estado> {
  state: Estado = { error: null, pila: null }

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // También a la consola, para tenerlo con el stack completo.
    console.error('[inbox] error en', this.props.zona ?? 'la app', error, info)
    this.setState({ pila: info.componentStack ?? null })
  }

  reintentar = () => this.setState({ error: null, pila: null })

  copiar = () => {
    const t = [
      'Zona: ' + (this.props.zona ?? '—'),
      'Error: ' + (this.state.error?.message ?? ''),
      '',
      this.state.error?.stack ?? '',
      '',
      'Componentes:',
      this.state.pila ?? '',
    ].join('\n')
    navigator.clipboard?.writeText(t).catch(() => {})
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-auto bg-fondo p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-4 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 shrink-0 text-alerta" />
            <div>
              <h2 className="font-semibold text-alerta">Se ha roto algo</h2>
              {this.props.zona && (
                <p className="text-sm text-texto2">en {this.props.zona}</p>
              )}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-alerta/30 bg-alerta/10 p-3">
            <p className="break-words font-mono text-sm text-alerta">
              {this.state.error.message || String(this.state.error)}
            </p>
          </div>

          {this.state.error.stack && (
            <details className="mb-3" open>
              <summary className="cursor-pointer text-sm text-texto2 hover:text-texto">
                Detalle técnico
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-panel p-3 text-[11px] leading-relaxed text-texto2">
                {this.state.error.stack}
              </pre>
            </details>
          )}

          {this.state.pila && (
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-texto2 hover:text-texto">
                Árbol de componentes
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-panel p-3 text-[11px] text-texto2">
                {this.state.pila}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={this.reintentar}
              className="flex items-center gap-2 rounded-lg bg-acento px-4 py-2 text-sm font-medium text-fondo"
            >
              <RotateCcw className="h-4 w-4" /> Reintentar
            </button>
            <button
              onClick={this.copiar}
              className="flex items-center gap-2 rounded-lg border border-borde px-4 py-2 text-sm text-texto2 hover:text-texto"
            >
              <Copy className="h-4 w-4" /> Copiar el error
            </button>
            <a
              href="#/"
              onClick={this.reintentar}
              className="flex items-center gap-2 rounded-lg border border-borde px-4 py-2 text-sm text-texto2 hover:text-texto"
            >
              Volver a la lista
            </a>
          </div>
        </div>
      </div>
    )
  }
}
