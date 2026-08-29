// PASO 2 — Filtro de salida determinista + aviso a Incidencias.
// Parte del workflow VIVO con el paso 1 ya dentro.
const fs = require('fs');
const SP = process.env.SP;

const w = JSON.parse(fs.readFileSync('backup-receptor-VIVO-preFiltroSalida-20260829.json', 'utf8'));

// --- 1) Filtro Seguridad v6 ---
const filtro = w.nodes.find(n => n.name === 'Filtro Seguridad');
if (!filtro) throw new Error('falta Filtro Seguridad');
filtro.parameters.jsCode = fs.readFileSync(SP + '/filtro-v6.js', 'utf8');

// --- 2) tres nodos nuevos ---
const guardarInc = w.nodes.find(n => n.name === 'Guardar incidencia');
if (!guardarInc) throw new Error('falta Guardar incidencia (de donde copio credenciales y columnas)');

const nuevos = [
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'cond-bloqueada',
          leftValue: '={{ $json.bloqueado }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: 'b10c0000-0001-4000-8000-000000000001',
    name: '¿Respuesta bloqueada?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [2100, 1330]
  },
  {
    parameters: { jsCode: fs.readFileSync(SP + '/fila-incidencia-bloqueo.js', 'utf8') },
    id: 'b10c0000-0002-4000-8000-000000000002',
    name: 'Fila incidencia de bloqueo',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2340, 1330]
  },
  {
    // Mismas columnas, misma pestaña y mismas credenciales que 'Guardar incidencia'.
    parameters: JSON.parse(JSON.stringify(guardarInc.parameters)),
    id: 'b10c0000-0003-4000-8000-000000000003',
    name: 'Guardar incidencia de bloqueo',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: guardarInc.typeVersion,
    position: [2580, 1330],
    credentials: JSON.parse(JSON.stringify(guardarInc.credentials)),
    // Si Google falla, no se lleva por delante la respuesta al cliente.
    onError: 'continueRegularOutput'
  }
];

for (const n of nuevos) {
  if (w.nodes.some(x => x.name === n.name)) throw new Error('ya existe un nodo llamado ' + n.name);
  if (w.nodes.some(x => x.id === n.id))     throw new Error('id repetido: ' + n.id);
  w.nodes.push(n);
}

// --- 3) conexiones ---
const C = w.connections;
// La rama nueva se añade DESPUÉS de ¿Pedido completo?: el camino que contesta
// al cliente se encola primero, el registro va detrás.
const salidaFiltro = C['Filtro Seguridad'].main[0];
if (!salidaFiltro.some(x => x.node === '¿Pedido completo?')) throw new Error('Filtro Seguridad ya no apunta a ¿Pedido completo?');
salidaFiltro.push({ node: '¿Respuesta bloqueada?', type: 'main', index: 0 });

C['¿Respuesta bloqueada?']      = { main: [[{ node: 'Fila incidencia de bloqueo', type: 'main', index: 0 }]] };
C['Fila incidencia de bloqueo'] = { main: [[{ node: 'Guardar incidencia de bloqueo', type: 'main', index: 0 }]] };

// --- comprobaciones antes de escribir ---
const nombres = w.nodes.map(n => n.name);
if (new Set(nombres).size !== nombres.length) throw new Error('hay nombres de nodo repetidos');
for (const [src, v] of Object.entries(C))
  for (const rama of (v.main || []))
    for (const x of (rama || []))
      if (!nombres.includes(x.node)) throw new Error('conexión rota: ' + src + ' -> ' + x.node);

console.log('nodos:', w.nodes.length, '(eran 126, +3 =', 126 + 3 + ')');
console.log('salidas de Filtro Seguridad:', salidaFiltro.map(x => x.node).join(' , '));

fs.writeFileSync('paso2-filtro-salida.json', JSON.stringify({
  name: w.name, nodes: w.nodes, connections: w.connections,
  settings: w.settings || {}, staticData: w.staticData || null
}, null, 2));
console.log('escrito: paso2-filtro-salida.json');
