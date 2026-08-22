/** @type {import('tailwindcss').Config} */

// Cada color sale de una variable CSS de src/index.css. El `<alpha-value>`
// es lo que mantiene vivas las opacidades que ya usa la app (bg-acento/15,
// text-texto2/60...). Si aquí se pusiera el hex directamente, cambiar de
// tema obligaría a tocar todos los componentes.
const v = (nombre) => `rgb(var(--c-${nombre}) / <alpha-value>)`

export default {
  // El tema se pone con data-tema en <html>, no con la clase `dark`: hay
  // TRES estados (claro, oscuro, seguir al sistema) y una clase booleana no
  // sabe distinguir "oscuro porque lo eligió" de "oscuro porque el móvil lo está".
  darkMode: ['selector', '[data-tema="oscuro"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fondo:         v('fondo'),
        panel:         v('panel'),
        panel2:        v('panel2'),
        borde:         v('borde'),
        propio:        v('propio'),        // burbuja nuestra
        'propio-texto': v('propio-texto'), // legible sobre ella, cambie el tema que cambie
        ajeno:         v('ajeno'),         // burbuja del cliente
        acento:        v('acento'),
        texto:         v('texto'),
        texto2:        v('texto2'),
        alerta:        v('alerta'),
        aviso:         v('aviso'),
        leido:         v('leido'),
      },
      boxShadow: {
        burbuja: 'var(--sombra-burbuja)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
      keyframes: {
        latido: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
        // El acuse de recibo al cambiar un pedido. En iOS no hay vibración
        // posible, así que este salto es el único aviso que llega a todas
        // partes: tiene que notarse sin llegar a molestar.
        latidoCorto: {
          '0%':   { transform: 'scale(1)' },
          '45%':  { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        latido: 'latido 1.4s ease-in-out infinite',
        'latido-corto': 'latidoCorto .32s ease-out',
      },
    },
  },
  plugins: [],
}
