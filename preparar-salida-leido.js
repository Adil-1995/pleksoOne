const fs=require("fs");
const d=JSON.parse(fs.readFileSync("backup-salida-VIVO-20260822-preLeido.json","utf8"));
const N=n=>{const x=d.nodes.find(y=>y.name===n); if(!x) throw new Error("no existe nodo: "+n); return x;};
const hechos=[];

// ---------- 1. RECABLEADO: resolver el canal ANTES del reparto ----------
// Asegurar conversación va primero porque "Canal de la conversación" lee la
// fila: si no existe todavía (cliente nuevo escrito desde el inbox), no
// habría canal que resolver y caeríamos al número por defecto.
d.connections["Validar petición"]        = { main:[[{node:"Asegurar conversación",type:"main",index:0}]] };
d.connections["Asegurar conversación"]   = { main:[[{node:"Canal de la conversación",type:"main",index:0}]] };
d.connections["Canal de la conversación"]= { main:[[{node:"Número de salida",type:"main",index:0}]] };
d.connections["Número de salida"]        = { main:[[
  {node:"¿Solo marcar como leído?",type:"main",index:0},
  {node:"¿Cayó al número por defecto?",type:"main",index:0},
]]};
d.connections["¿Solo marcar como leído?"]= { main:[
  [{node:"Marcar como leído",type:"main",index:0}],
  [{node:"¿Canal habilitado?",type:"main",index:0}],
]};
hechos.push("recableado: Validar → Asegurar → Canal → Número → reparto");

// ---------- 2. El IF ya no recibe a Validar petición en $json ----------
N("¿Solo marcar como leído?").parameters.conditions.conditions[0].leftValue =
  "={{ $('Validar petición').first().json.accion }}";
hechos.push("¿Solo marcar como leído?: referencia explícita a Validar petición");

// ---------- 3. Marcar como leído: referencias explícitas + sin tragarse nada ----------
const ml=N("Marcar como leído");
ml.parameters.jsonBody =
  "={{ JSON.stringify(Object.assign({ messaging_product: \"whatsapp\", status: \"read\", " +
  "message_id: $('Validar petición').first().json.wa_message_id }, " +
  "$('Validar petición').first().json.typing ? { typing_indicator: { type: \"text\" } } : {})) }}";
// neverError hacía que un 4xx de Meta no contara como fallo. Fuera.
delete ml.parameters.options.response.response.neverError;
// El error deja de comerse en silencio, pero NO tumba la respuesta al
// cliente: sale por la salida de error y avisa. Un check azul perdido no
// puede costar una venta.
ml.onError = "continueErrorOutput";
hechos.push("Marcar como leído: refs explícitas, sin neverError, error a rama propia");

// ---------- 4. Nodos nuevos ----------
const TG = (nombre,pos,texto) => ({
  parameters:{ method:"POST",
    url:"=https://api.telegram.org/bot{{ $env.TG_INCIDENCIAS_TOKEN }}/sendMessage",
    sendBody:true, specifyBody:"json",
    jsonBody:"={{ JSON.stringify({ chat_id: $env.TG_INCIDENCIAS_CHAT, text: "+texto+" }) }}",
    options:{} },
  type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:pos,
  id:"tg-"+nombre.replace(/[^a-z]/gi,"").toLowerCase(), name:nombre,
  onError:"continueRegularOutput",   // avisar nunca puede romper el flujo
});

d.nodes.push({
  parameters:{ conditions:{ options:{caseSensitive:true,leftValue:"",typeValidation:"loose",version:2},
    conditions:[{id:"pd", leftValue:"={{ $json.por_defecto ? \"si\" : \"no\" }}",
      rightValue:"si", operator:{type:"string",operation:"equals"}}], combinator:"and" }, options:{} },
  type:"n8n-nodes-base.if", typeVersion:2.2, position:[520,700],
  id:"if-por-defecto", name:"¿Cayó al número por defecto?",
});

d.nodes.push(TG("Avisar número por defecto",[800,700],
  "\"⚠️ SALIDA POR EL NÚMERO POR DEFECTO\n\" + " +
  "\"No se pudo resolver el canal de la conversación, así que se contesta por el de wa.env.\n\" + " +
  "\"cliente: \" + $('Validar petición').first().json.cliente_id + \"\n\" + " +
  "\"phone_id usado: \" + $('Número de salida').first().json.phone_id"));

d.nodes.push(TG("Avisar fallo de confirmación",[300,-120],
  "\"⚠️ Falló marcar como leído / escribiendo\n\" + " +
  "\"cliente: \" + $('Validar petición').first().json.cliente_id + \"\n\" + " +
  "\"phone_id: \" + $('Número de salida').first().json.phone_id"));

d.connections["¿Cayó al número por defecto?"] = { main:[
  [{node:"Avisar número por defecto",type:"main",index:0}], [] ]};
d.connections["Marcar como leído"] = { main:[
  [{node:"Leído (no se registra)",type:"main",index:0}],
  [{node:"Avisar fallo de confirmación",type:"main",index:0}] ]};
hechos.push("nodos nuevos: ¿Cayó al número por defecto? + 2 avisos a Telegram");

fs.writeFileSync("fase8-salida-leido-multicanal.json", JSON.stringify({
  name:d.name, nodes:d.nodes, connections:d.connections, settings:d.settings||{}
},null,2));
console.log("CAMBIOS:"); hechos.forEach(h=>console.log("  - "+h));
console.log("\nnodos: "+d.nodes.length+" (antes 22)");
