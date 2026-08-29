// PASO 3 — La ficha la decide el flujo: Decidir ficha aprende de la conversación.
const fs = require('fs');
const SP = process.env.SP;
const w = JSON.parse(fs.readFileSync('backup-receptor-VIVO-preFichaFlujo-20260829.json', 'utf8'));

// --- 1) Decidir ficha v2 ---
const ficha = w.nodes.find(n => n.name === 'Decidir ficha');
if (!ficha) throw new Error('falta Decidir ficha');
ficha.parameters.jsCode = fs.readFileSync(SP + '/ficha-v2.js', 'utf8');

// --- 2) el nodo que lee el historial ---
// Copia exacta del patrón de 'Leer contexto crudo', que ya lee esta misma
// tabla para este mismo cliente: fullResponse + neverError + continueRegularOutput.
const modelo = w.nodes.find(n => n.name === 'Leer contexto crudo');
if (!modelo) throw new Error('falta Leer contexto crudo (el patrón a copiar)');

const nuevo = {
  parameters: {
    url: "={{ $env.SUPABASE_URL }}/rest/v1/mensajes?cliente_id=eq.{{ $('Variables').first().json.numero_cliente }}&direccion=eq.in&order=creado.desc&limit=20&select=texto,creado",
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey',        value: '={{ $env.SUPABASE_SERVICE_ROLE }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_ROLE }}' }
    ]},
    options: { response: { response: { fullResponse: true, neverError: true } } }
  },
  id: 'b10c0000-0004-4000-8000-000000000004',
  name: 'Leer historial del cliente',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: modelo.typeVersion,
  position: [3352, 240],
  onError: 'continueRegularOutput'
};
if (w.nodes.some(n => n.name === nuevo.name)) throw new Error('ya existe ' + nuevo.name);
w.nodes.push(nuevo);

// --- 3) intercalarlo, en LÍNEA: Preparar Catálogo -> Leer historial -> Decidir ficha ---
const C = w.connections;
const salida = C['Preparar Catálogo'].main[0];
if (salida.length !== 1 || salida[0].node !== 'Decidir ficha')
  throw new Error('Preparar Catálogo ya no va derecho a Decidir ficha: ' + JSON.stringify(salida));
C['Preparar Catálogo'].main[0] = [{ node: 'Leer historial del cliente', type: 'main', index: 0 }];
C['Leer historial del cliente'] = { main: [[{ node: 'Decidir ficha', type: 'main', index: 0 }]] };

// --- comprobaciones ---
const nombres = w.nodes.map(n => n.name);
if (new Set(nombres).size !== nombres.length) throw new Error('nombres repetidos');
for (const [src, v] of Object.entries(C))
  for (const rama of (v.main || []))
    for (const x of (rama || []))
      if (!nombres.includes(x.node)) throw new Error('conexión rota: ' + src + ' -> ' + x.node);
// Decidir ficha no usa $json, por eso se puede intercalar un nodo delante sin romperlo
if (/\$json/.test(ficha.parameters.jsCode)) throw new Error('OJO: Decidir ficha usa $json y le acabo de cambiar la entrada');

console.log('nodos:', w.nodes.length);
console.log('Preparar Catálogo ->', C['Preparar Catálogo'].main[0].map(x => x.node).join(','));
console.log('Leer historial    ->', C['Leer historial del cliente'].main[0].map(x => x.node).join(','));

fs.writeFileSync('paso3-ficha-por-el-flujo.json', JSON.stringify({
  name: w.name, nodes: w.nodes, connections: w.connections,
  settings: w.settings || {}, staticData: w.staticData || null
}, null, 2));
console.log('escrito: paso3-ficha-por-el-flujo.json');
