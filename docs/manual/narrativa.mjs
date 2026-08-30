// ─────────────────────────────────────────────────────────────────────────
//  LumaBot — narrativa del manual
//
//  ESTE ES EL ÚNICO FICHERO QUE SE EDITA A MANO.
//
//  Todo lo demás (mapa, rutas, tablas, avisos, tabla de riesgo, diagramas)
//  lo genera `generar.mjs` leyendo los workflows vivos por la API de n8n.
//
//  CÓMO NO SE PUDRE
//  ────────────────
//  Cada bloque declara en `ancla` los nodos de los que habla. Al generar,
//  si un ancla ya no existe en el workflow vivo, el build FALLA y no se
//  escribe el HTML. Renombrar un nodo obliga a tocar este fichero.
//  Es exactamente lo que al CLAUDE.md le faltó.
//
//  No se usa YAML a propósito: obligaría a meter una dependencia para
//  parsearlo. Esto es un objeto de JavaScript y se edita igual de bien.
// ─────────────────────────────────────────────────────────────────────────

export const meta = {
  titulo: 'LumaBot — Manual del sistema',
  subtitulo: 'Los cuatro workflows vivos, qué hace cada uno y por dónde se rompe.',
};

// ── IDs de los workflows vivos ───────────────────────────────────────────
// Se listan aquí para que el generador compruebe que siguen activos.
// Si uno deja de estarlo, el build lo dice.
export const VIVOS = [
  'qx1O54zpuyxzfW8V', // receptor
  'CYgKApb26ARGlhVZ', // salida
  'YGqvrxFadgtdS7Lo', // inbox envío
  'qXCipdF2Blm0v6HI', // capi
];

// ─────────────────────────────────────────────────────────────────────────
//  SECCIÓN 1 — MAPA GENERAL
// ─────────────────────────────────────────────────────────────────────────

export const mapa = {
  intro: `
Cuatro workflows atienden todo. Uno recibe de Meta, uno envía a Meta, y dos
son puertas que el inbox llama por HTTP. Solo uno de los cuatro habla con
WhatsApp: <strong>el subflujo de salida es el único punto de salida</strong>,
y esa es la regla que evita tener la clave repetida en diez sitios.

El grafo de llamadas se genera leyendo los nodos, no está escrito a mano:
se cruzan el índice <code>workflow_dependency</code> de n8n y un barrido del
JSON de nodos, y solo se pinta lo que coincide en ambos.`,

  recorrido: `
<p>Lo que le pasa a un mensaje desde que el cliente pulsa enviar:</p>
<ol>
  <li><strong>Meta llama al webhook</strong> <code>POST /wa-cloud-multi</code>.
      Lo primero que hace el flujo es responder 200 — antes de procesar nada.
      Si tardas, Meta reintenta y acaba desactivando el webhook.</li>
  <li><strong>Se valida la firma</strong> <code>X-Hub-Signature-256</code> sobre
      el cuerpo crudo. Si no cuadra, el mensaje se descarta y no pasa nada más.</li>
  <li><strong>Se resuelve el canal</strong> por el <code>phone_number_id</code> que
      manda Meta. No se deduce del texto ni del país del cliente.</li>
  <li><strong>Se guarda el mensaje</strong> en Supabase antes de decidir nada.
      Entre o salga, sea del bot o de un humano. Es la regla 1 y no tiene excepciones.</li>
  <li><strong>Se mira si el bot atiende a este cliente.</strong> Si un humano
      lo pausó, el flujo para aquí y María no dice nada.</li>
  <li><strong>El mensaje entra en un buffer</strong> y espera 6 segundos. Si el
      cliente manda tres mensajes seguidos, se juntan y se contesta una vez.</li>
  <li><strong>Se compone el prompt</strong> (el común más los datos del canal) y
      se lee el catálogo de la hoja.</li>
  <li><strong>El flujo decide si toca ficha</strong> emparejando contra las
      palabras clave del catálogo. Esa decisión no la toma el modelo.</li>
  <li><strong>Si no hay ficha, contesta el AI Agent</strong>, y su respuesta pasa
      por el Filtro Seguridad antes de salir.</li>
  <li><strong>Todo lo que sale va por el subflujo de salida</strong>, que resuelve
      por qué número sale, envía, y registra la fila saliente en Supabase.</li>
</ol>`,
};

// ─────────────────────────────────────────────────────────────────────────
//  SECCIÓN 2 — LO QUE ME MUERDE
// ─────────────────────────────────────────────────────────────────────────

export const muerde = `
<h3>1. El nombre de un workflow no significa nada</h3>
<p>Durante meses el receptor que atendía a todos los clientes se llamaba
«Fase 7 MULTICANAL (copia, desactivada)». El nombre es un campo de texto que
nadie valida. <strong>Fíate del ID y del tráfico, nunca del nombre.</strong>
Para saber quién está vivo de verdad:</p>
<pre><code>select e."workflowId", count(*), max(e."startedAt")
from execution_entity e
where e."startedAt" &gt; now() - interval '4 hours'
group by 1 order by 3 desc;</code></pre>

<h3>2. Orden al publicar: el subflujo primero</h3>
<p>Un workflow que llama a otro no se puede publicar si el llamado no lo está.
El orden es siempre <strong>de dentro hacia fuera</strong>:</p>
<pre><code>1. POST /api/v1/workflows/CYgKApb26ARGlhVZ/activate   ← el subflujo de salida
2. POST /api/v1/workflows/qx1O54zpuyxzfW8V/activate   ← después el receptor</code></pre>
<p>Y al revés para apagar: primero el que llama, después el llamado. Si lo haces
al derecho te quedas un rato con un padre vivo apuntando a un hijo muerto.</p>

<h3>3. Por qué un PUT es peligroso</h3>
<p>Un <code>PUT</code> sobre un workflow no edita un campo: <strong>reescribe el
workflow entero</strong>. Sobre un subflujo, eso lo saca de su estado publicado, y
todo lo que lo referencia cae detrás. Nos dejó
<code>/webhook/wa-cloud-multi</code> devolviendo 404 <em>sin un solo error en el
log</em>.</p>
<p><strong>Para renombrar no hace falta un PUT.</strong> Un <code>UPDATE</code> de
la columna <code>name</code> es inerte: el trigger
<code>increment_workflow_version</code> solo incrementa la versión si cambian
<code>nodes</code> o <code>settings</code>, así que un cambio de nombre no toca
<code>webhook_entity</code>, ni <code>active</code>, ni la versión. Comprobado:
los cuatro se renombraron así y el <code>versionCounter</code> no se movió.</p>

<h3>4. Cómo verificar de verdad</h3>
<p><strong>Un 200 del activate no prueba nada</strong>, y <strong>una ejecución en
verde tampoco</strong>. El <code>active</code> de la base de datos puede decir
<code>t</code> justo después de activar y estar en <code>f</code> minutos después.
Las tres pruebas que sí valen, en este orden:</p>
<ol>
  <li><strong><code>webhook_entity</code> tiene filas.</strong> Si el webhook no
      está registrado ahí, la URL no existe por mucho que <code>active</code> diga
      que sí.
      <pre><code>select w."webhookPath", w.method, e.name
from webhook_entity w join workflow_entity e on e.id = w."workflowId";</code></pre></li>
  <li><strong>La URL contesta.</strong> Tiene que devolver <code>1234</code>:
      <pre><code>curl "https://plekso.duckdns.org/webhook/wa-cloud-multi?hub.mode=subscribe&amp;hub.verify_token=$WA_VERIFY_TOKEN&amp;hub.challenge=1234"</code></pre></li>
  <li><strong>Una conversación real de punta a punta</strong>, y mirando la
      <em>salida</em> de los nodos, no su color. Lo que hay que ver:
      <code>Número de salida</code> con <code>por_defecto: false</code>,
      <code>ENVIAR A WHATSAPP</code> devolviendo un <code>wamid</code> real, y
      <code>Devolver resultado</code> con <code>ok: true</code>.</li>
</ol>

<h3>5. Los tres disfraces del corte mudo</h3>
<p>Los tres fallos del 22 de agosto salieron en verde y sin error en el log:</p>
<ul>
  <li><strong>Referenciar un nodo que en esa rama no se ejecutó.</strong> Si un
      nodo usa <code>$('Otro').item.json.x</code>, comprueba que «Otro» está en
      <em>todas</em> las ramas que llegan hasta él.</li>
  <li><strong>Una caída a un valor por defecto que no avisa.</strong> Con un canal
      acierta por casualidad; con dos, ese acierto es azar. Hoy
      <code>Número de salida</code> marca <code>por_defecto</code> y hay un aviso
      colgado de ahí — ese está resuelto.</li>
  <li><strong>Una rama terminal paralela le roba el retorno al subflujo.</strong>
      Un subflujo devuelve al padre lo que salga del <em>último nodo ejecutado</em>.
      Deja el grafo lineal y que todos los caminos acaben en el mismo nodo.</li>
</ul>

<h3>6. Una alerta sin probar no es una alerta</h3>
<p>Los dos avisos a Telegram puestos para cazar el fallo 2 devolvían
<code>{"error":"invalid syntax"}</code> y no llegó ninguno. Y hoy sigue habiendo
avisos que se tragan su propio fallo: mira la tabla de riesgo, la mitad de las
filas rojas son nodos de Telegram que, si Telegram falla, no se lo cuentan a
nadie. <strong>Prueba la alerta provocando el caso.</strong></p>
`;

// ─────────────────────────────────────────────────────────────────────────
//  SECCIÓN 3 — LOS CUATRO WORKFLOWS
// ─────────────────────────────────────────────────────────────────────────

export const workflows = {

  // ══════════════════════════════════════════════════════════════════════
  qx1O54zpuyxzfW8V: {
    proposito: `
Recibe todo lo que Meta manda de los dos números de WhatsApp: mensajes de
clientes, acuses de entrega y eventos de estado. Es quien decide si María
contesta, qué contesta, y quien guarda el rastro de la conversación.`,

    disparador: `
Dos nodos webhook sobre la misma ruta <code>wa-cloud-multi</code>: el
<code>GET</code> atiende la verificación de Meta (devuelve el
<code>hub.challenge</code>) y el <code>POST</code> recibe los mensajes. Un mismo
path admite los dos porque la clave primaria de <code>webhook_entity</code> es
(<code>webhookPath</code>, <code>method</code>).`,

    bloques: [
      {
        titulo: 'Puerta: responder a Meta y validar la firma',
        ancla: ['Webhook mensajes (POST)', 'Responder 200 a Meta', 'Validar firma', '¿Firma válida?', 'Normalizar evento'],
        texto: `Responde 200 <em>antes</em> de procesar. Luego valida
        <code>X-Hub-Signature-256</code> sobre el cuerpo crudo — nunca sobre
        <code>JSON.stringify($json.body)</code>, porque al reserializar cambian
        emojis y tildes y la firma deja de cuadrar en mensajes reales. Si no
        cuadra, cae en «Descartar: no autorizado» y ahí acaba.`,
      },
      {
        titulo: 'Bifurcación: ¿esto es un mensaje o un acuse de estado?',
        ancla: ['¿Qué tipo de evento?', 'Traducir estado de Meta', '¿Tiene equivalente?', 'Actualizar estado'],
        texto: `La mayor parte del tráfico son acuses (entregado, leído), no
        mensajes. Esos van por la rama corta: se traduce el estado de Meta al
        vocabulario propio y se hace un PATCH sobre <code>mensajes</code>. Ojo con
        el nodo «Sin equivalente»: el CHECK de la columna no admite todos los
        estados que manda Meta, y los que no encajan se descartan.`,
      },
      {
        titulo: 'Identidad: de qué número nuestro viene',
        ancla: ['Buscar canal', 'Resolver canal', '¿Canal conocido?', 'Avisar canal desconocido'],
        texto: `La llave es el <code>phone_number_id</code> de <code>metadata</code>,
        el único dato fiable de quién recibió el mensaje. Si el número no está dado
        de alta en <code>canales</code>, el mensaje <strong>se guarda igual</strong>
        y se avisa por Telegram. Nunca se pierde nada por no tener fila de
        configuración.`,
      },
      {
        titulo: 'Guardar antes de decidir',
        ancla: ['Asegurar conversación', 'Preparar fila del mensaje', 'Guardar mensaje entrante', 'Datos del mensaje guardado'],
        texto: `Regla 1 del proyecto. <code>asegurar_conversacion</code> es una RPC
        que crea la conversación si no existe, y después se inserta la fila en
        <code>mensajes</code>. Un entrante se guarda como <code>entregado</code>:
        el estado <code>recibido</code> no existe en el CHECK.`,
      },
      {
        titulo: 'Interruptor: ¿atiende el bot a este cliente?',
        ancla: ['Leer estado de la conversación', 'Interpretar estado', '¿El bot atiende a este cliente?', 'Humano al mando: no responder'],
        texto: `Lee <code>conversaciones.bot_activo</code>. «Interpretar estado»
        traduce la respuesta HTTP a un booleano que el IF no pueda malinterpretar,
        y deja escrito el motivo. Trabaja con el array (<code>[]</code> = 0 filas,
        <code>[x]</code> = 1) en vez de usar
        <code>Accept: application/vnd.pgrst.object+json</code>, que n8n no reconoce
        como JSON y dejaría el cuerpo como cadena.
        <strong>Cuidado:</strong> si el GET falla, asume que el bot atiende. Ver la
        tabla de riesgo.`,
      },
      {
        titulo: 'Buffer: juntar mensajes seguidos',
        ancla: ['Guardar en buffer', 'Esperar 6 segundos', '¿Llegaron más mensajes?', '¿Soy el último?', 'Vaciar buffer', 'Juntar mensajes'],
        texto: `El cliente que manda tres mensajes seguidos recibe una respuesta,
        no tres. Cada mensaje espera 6 segundos y comprueba si llegó otro detrás;
        solo el último sigue. Vive en <code>buffer_mensajes</code>, en el Postgres
        viejo, indexado por <code>numero</code>.`,
      },
      {
        titulo: 'Contexto y prompt',
        ancla: ['Leer contexto crudo', 'Leer contexto', '¿Esperando datos?', 'Añadir contexto', 'Leer Prompt', 'Leer prompt del canal', 'Componer prompt'],
        texto: `El prompt se compone en dos capas y <strong>nunca al revés</strong>:
        el común (quién es María, cómo habla, qué no puede hacer) y detrás los datos
        del canal (moneda, entrega, saludo), etiquetados como datos para que quede
        claro que ahí no van reglas. «¿Esperando datos?» busca tres cadenas
        literales en el historial para saber si María pidió ya la dirección; si lo
        dice de otra forma, falla en silencio — vale para una decisión de un turno,
        no valdría como estado guardado.`,
      },
      {
        titulo: 'La ficha la decide el flujo, no el modelo',
        ancla: ['Leer Catálogo', 'Preparar Catálogo', 'Leer historial del cliente', 'Decidir ficha', '¿Ficha directa?', 'Ficha ya?'],
        texto: `Se empareja el mensaje contra las <code>palabras_clave</code> del
        catálogo. El producto <strong>nunca</strong> sale de una regex sobre el texto
        del modelo: el texto del modelo vale como pista, jamás como dato. Y un
        empate es una duda: si dos productos encajan igual, no se marca nada. Un
        hueco se ve y se investiga; un producto inventado se cuela en los filtros y
        nadie lo nota.`,
      },
      {
        titulo: 'El modelo, y el filtro que revisa lo que dice',
        ancla: ['AI Agent', 'OpenAI Chat Model', 'Postgres Chat Memory', 'Filtro Seguridad', 'Hay que escalar?', '¿Respuesta bloqueada?'],
        texto: `Si no tocaba ficha, contesta el AI Agent con memoria en
        <code>n8n_chat_histories</code>. Su respuesta pasa por «Filtro Seguridad»,
        que descarta lo que mencione dos o más productos (nunca se enumera el
        catálogo) y cuenta como firma solo las palabras <em>exclusivas</em> de un
        producto: contar cualquier palabra de 5+ letras bloqueaba respuestas buenas,
        porque «carga» está en dos productos.`,
      },
      {
        titulo: 'Pedido: se guarda, se avisa, y silencio al cliente',
        ancla: ['¿Pedido completo?', 'Preparar pedido', 'Guardar pedido', 'Apagar tras el pedido', 'Avisar al dueño - Pedido', '¿Producto identificado?', 'Marcar pedido pendiente'],
        texto: `Cuando llegan los datos del pedido: se guarda en
        <code>pedidos</code>, se apaga el bot para ese cliente, se avisa a Telegram
        y <strong>no se le dice nada al cliente</strong>. Es deliberado. El efecto
        secundario es que si el aviso de Telegram falla, nadie se entera de la venta
        — es la fila más grave de la tabla de riesgo.`,
      },
      {
        titulo: 'Media y audio',
        ancla: ['MEDIA ¿trae adjunto?', 'MEDIA pedir URL a Graph', 'MEDIA descargar', 'MEDIA subir a Storage', 'MEDIA guardar adjunto', 'MEDIA fallo', 'TRANSCRIBIR con Whisper', 'AUDIO decidir'],
        texto: `Imágenes, audio y vídeo se bajan de Graph, se suben al Storage de
        Supabase y se cuelgan del mensaje en <code>adjuntos</code>. El audio además
        pasa por Whisper y, si se entiende, <strong>ese texto es el que ve María</strong>,
        como si el cliente lo hubiera escrito. Toda la cadena converge en «MEDIA
        fallo», que emite el mismo contrato que el camino bueno para que «AUDIO
        decidir» no tenga que saber por dónde se rompió. Es el mejor manejo de
        errores del sistema.`,
      },
      {
        titulo: 'Salida: todo por el mismo sitio',
        ancla: ['Preparar: respuesta', 'ENVIAR respuesta', 'Preparar: ficha directa', 'ENVIAR ficha directa', 'Preparar: oferta con foto', 'ENVIAR oferta con foto', 'Preparar: leído + escribiendo', 'MARCAR leído + escribiendo'],
        texto: `Cinco nodos «ENVIAR» distintos, y los cinco llaman al mismo subflujo.
        Ninguno habla con la API de WhatsApp por su cuenta.`,
      },
      {
        titulo: 'Atribución del anuncio',
        ancla: ['Atribución del anuncio', 'Guardar atribución'],
        texto: `El <code>ctwa_clid</code> llega en <code>messages[0].referral</code> y
        <strong>solo en el primer mensaje</strong> del cliente. Si no se captura ahí,
        el pedido queda sin atribuir y el Purchase al CAPI no se puede reportar.`,
      },
    ],

    supabase: `Escribe en <code>conversaciones</code> (RPC
    <code>asegurar_conversacion</code>, y PATCH para la atribución),
    <code>mensajes</code> (insert del entrante, PATCH de estado y de adjunto),
    <code>adjuntos</code> (insert y PATCH de la transcripción),
    <code>conversacion_productos</code> (interesado / comprado) y el
    <strong>Storage</strong> para los ficheros.
    <br><strong>Y además escribe en el Postgres viejo</strong>, que no es Supabase:
    <code>buffer_mensajes</code>, <code>pedidos</code>, <code>fichas_enviadas</code>
    y <code>n8n_chat_histories</code>. Ver discrepancias.`,

    telegram: {
      'Avisar al dueño': 'Cuando el Filtro Seguridad decide que hay que escalar a un humano.',
      'Avisar al dueño - Pedido': 'Cuando se ha guardado un pedido. Es el único aviso de una venta: al cliente no se le dice nada.',
      'Avisar canal desconocido': 'Cuando entra un mensaje por un número que no está dado de alta en canales.',
      'AUDIO ilegible: aviso Telegram': 'Cuando llega un audio que Whisper no ha podido transcribir.',
    },

    fallo: `
    <p><strong>Se para</strong> si falla la validación de firma, «Asegurar
    conversación», «Guardar mensaje entrante», el buffer o «Guardar pedido»:
    esos nodos no llevan <code>onError</code>, así que la ejecución muere y sale
    en rojo en la lista. Eso es lo bueno — se ve.</p>
    <p><strong>Sigue</strong> en 24 nodos marcados
    <code>onError: continueRegularOutput</code>. La ejecución sale verde y algo no
    ha pasado. Cuáles y qué se pierde en cada uno, en la tabla de riesgo.</p>
    <p><strong>Avisa</strong> solo en cuatro sitios, y los cuatro avisos se tragan
    su propio fallo.</p>`,
  },

  // ══════════════════════════════════════════════════════════════════════
  CYgKApb26ARGlhVZ: {
    proposito: `
El único punto de salida a WhatsApp. Todo lo que el sistema le dice a un cliente
pasa por aquí: las respuestas de María, las fichas, las fotos, los acuses de
lectura y los mensajes que escribe un humano desde el inbox.`,

    disparador: `
No tiene webhook. Arranca con <code>executeWorkflowTrigger</code> («Cuando me
llaman»), invocado por el receptor y por el webhook de envío del inbox.`,

    bloques: [
      {
        titulo: 'Validar lo que le piden',
        ancla: ['Cuando me llaman', 'Validar petición'],
        texto: `Comprueba que la petición trae lo que necesita. El
        <code>cliente_id</code> se exige para todo: cuando no se exigía para
        <code>marcar_leido</code>, un <code>cliente_id</code> vacío devolvía cero
        filas y caía al número por defecto sin decir nada.`,
      },
      {
        titulo: 'Por qué número sale',
        ancla: ['Canal de la conversación', 'Número de salida', '¿Cayó al número por defecto?', 'Avisar número por defecto', '¿Canal habilitado?', 'Canal desactivado: no se envía'],
        texto: `Sale por el mismo número por el que entró la conversación, que es
        el único que el cliente reconoce. Contestar desde otro es, para el cliente,
        un desconocido escribiéndole. Si no se puede averiguar, cae al de
        <code>wa.env</code> — <strong>y lo marca</strong>, porque con un solo número
        acierta y con dos ese acierto es casualidad. Un canal desactivado no envía
        nada.`,
      },
      {
        titulo: 'Enviar y registrar',
        ancla: ['Construir mensaje Cloud API', 'ENVIAR A WHATSAPP (único punto de salida)', 'Preparar fila saliente', 'Registrar salida', '¿Falló el envío?', 'Avisar incidencia por Telegram'],
        texto: `El envío es el único nodo del sistema con <code>retryOnFail</code>.
        Después se registra la fila saliente en <code>mensajes</code> con
        <code>on_conflict=canal,msg_id_canal</code> para no duplicar. «¿Falló el
        envío?» lee el <code>ok</code> que calcula «Preparar fila saliente» y manda
        el aviso: <strong>este es el único sitio del sistema donde un fallo de una
        API externa se comprueba de verdad y se avisa.</strong>`,
      },
      {
        titulo: 'Acuse de lectura',
        ancla: ['¿Solo marcar como leído?', 'Marcar como leído', 'Leído (no se registra)', 'Avisar fallo de confirmación'],
        texto: `El check azul y el «escribiendo…» van por una rama aparte que no
        registra nada en <code>mensajes</code>. Tiene rama de error propia.`,
      },
      {
        titulo: 'Cierre lineal',
        ancla: ['Devolver resultado', 'Guardar adjunto saliente', 'Conversación atendida: no_leidos a 0', 'Sin adjunto que registrar'],
        texto: `Todos los caminos acaban en «Devolver resultado», que emite
        <code>{ok, wamid, error}</code>. Es a propósito: un subflujo devuelve al
        padre lo que salga del último nodo ejecutado, y una rama terminal paralela
        le robaría el retorno y dejaría al padre con cero items, en verde.`,
      },
    ],

    supabase: `<code>conversaciones</code> (RPC <code>asegurar_conversacion</code>,
    GET del canal, PATCH de <code>no_leidos</code> a 0), <code>mensajes</code>
    (insert de la fila saliente con upsert por <code>canal,msg_id_canal</code>) y
    <code>adjuntos</code> (insert del adjunto saliente).`,

    telegram: {
      'Avisar incidencia por Telegram': 'Cuando el envío a WhatsApp ha fallado. Es el aviso de que un cliente NO ha recibido su mensaje.',
      'Avisar número por defecto': 'Cuando no se pudo resolver el canal y el mensaje salió por el número de wa.env.',
      'Avisar fallo de confirmación': 'Cuando falla el marcar como leído en Meta.',
    },

    fallo: `
    <p><strong>Se para</strong> si fallan «Asegurar conversación», «Preparar fila
    saliente» o «Registrar salida». Ojo con este último: el mensaje <em>ya se ha
    enviado</em> al cliente, así que si el registro muere, el cliente lo tiene y
    Supabase no — y el inbox no lo enseña.</p>
    <p><strong>Sigue</strong> en 7 nodos.</p>
    <p><strong>Avisa</strong> en tres sitios, y es el workflow que mejor lo hace:
    el fallo de envío se comprueba explícitamente en vez de darse por bueno.</p>`,
  },

  // ══════════════════════════════════════════════════════════════════════
  YGqvrxFadgtdS7Lo: {
    proposito: `
La puerta por la que el inbox manda mensajes y bloquea clientes. El frontend usa
la clave anónima y no tiene permiso de INSERT en <code>mensajes</code>: escribe
llamando aquí.`,

    disparador: `<code>POST /inbox-enviar</code>, llamado por el inbox desde el
    navegador. No lo llama ningún workflow de n8n.`,

    bloques: [
      {
        titulo: 'Autenticación',
        ancla: ['Petición del inbox', 'Sacar el token', 'Verificar sesión en Supabase', 'Comprobar sesión', '¿Sesión válida?', 'Responder 401'],
        texto: `El token del usuario se valida contra <code>/auth/v1/user</code> de
        Supabase, que es la autoridad. Comprobado empíricamente: token inventado,
        ausente o con el <code>exp</code> manipulado dan 403.
        <strong>Falla cerrado</strong>: si Supabase no responde 200, la sesión no
        vale. Eso está bien hecho.`,
      },
      {
        titulo: 'Validar y enviar',
        ancla: ['Validar y traducir', '¿Petición correcta?', 'Responder 400', 'Punto único de salida', 'Responder 200'],
        texto: `Traduce la petición del inbox al contrato del subflujo de salida y
        lo llama. No habla con WhatsApp por su cuenta.`,
      },
      {
        titulo: 'Bloquear en WhatsApp',
        ancla: ['¿Es bloqueo?', 'Bloquear en Meta', 'Leer respuesta de bloqueo', 'Guardar bloqueo', 'Responder al bloqueo'],
        texto: `Bloquea o desbloquea contra Graph y traduce los errores de Meta a
        castellano: el 131047 («solo se puede bloquear a quien te haya escrito en
        las últimas 24 h») es el que el equipo verá de verdad. El PATCH solo toca
        <code>bloqueada</code> si Meta ha dicho que sí — la base de datos no puede
        decir «bloqueada» de alguien que sigue pudiendo escribir.`,
      },
    ],

    supabase: `Lee <code>/auth/v1/user</code> para validar la sesión y hace PATCH
    sobre <code>conversaciones</code> para marcar el bloqueo. Los mensajes no los
    escribe él: los escribe el subflujo de salida.`,

    telegram: {},

    fallo: `
    <p><strong>Se para</strong> en los nodos de validación sin marca de error.</p>
    <p><strong>Sigue</strong> en 3 nodos, pero el de la sesión falla cerrado, que es
    lo correcto.</p>
    <p><strong>No avisa a Telegram por ningún sitio.</strong> Todo lo que sale mal
    se le devuelve al inbox por HTTP, así que quien lo ve es la persona que estaba
    delante. Si nadie estaba mirando, no queda rastro fuera de la ejecución.</p>`,
  },

  // ══════════════════════════════════════════════════════════════════════
  qXCipdF2Blm0v6HI: {
    proposito: `
Reporta a Meta el evento Purchase cuando una venta se valida en el inbox, para
que el algoritmo de los anuncios sepa qué anuncio acabó en dinero. Se reporta
con la fecha en que se validó la venta, no la del pedido.`,

    disparador: `<code>POST /capi-purchase</code>, llamado por el inbox al validar
    una venta.`,

    bloques: [
      {
        titulo: 'Autenticación',
        ancla: ['Petición del inbox', 'Sacar el token', 'Verificar sesión en Supabase', 'Comprobar sesión', '¿Sesión válida?', 'Responder 401'],
        texto: `Idéntico al del webhook de envío, y también falla cerrado.`,
      },
      {
        titulo: 'El cerrojo',
        ancla: ['Tomar el cerrojo', '¿Tomé algo?', '¿Hay líneas?', 'Responder: nada que reportar'],
        texto: `<code>capi_tomar</code> reserva las líneas a reportar de forma
        atómica. Sin cerrojo, dos validaciones simultáneas mandarían el mismo
        Purchase dos veces y la conversión se contaría doble.`,
      },
      {
        titulo: 'Construir y enviar el evento',
        ancla: ['Leer conversación y canal', 'Construir evento', '¿Se puede enviar?', 'Enviar a Meta CAPI', '¿Meta lo aceptó?', '¿Fue bien?'],
        texto: `Necesita el <code>ctwa_clid</code> que el receptor guardó del primer
        mensaje. El SHA-256 que pide el CAPI está escrito en JavaScript puro porque
        n8n bloquea el módulo <code>crypto</code> en su sandbox.`,
      },
      {
        titulo: 'Cerrar el cerrojo',
        ancla: ['Cerrar con éxito', 'Motivo del fallo', 'Cerrar con fallo', 'Avisar a Incidencias', 'Responder: enviado', 'Responder: no enviado'],
        texto: `<code>capi_cerrar</code> con <code>p_ok: true</code> marca las líneas
        como reportadas; con <code>p_ok: false</code> suelta el cerrojo para que se
        reintente. <strong>Los dos cierres se tragan su error</strong>, y cada uno
        falla hacia un lado distinto: ver la tabla de riesgo.`,
      },
    ],

    supabase: `RPC <code>capi_tomar</code> y <code>capi_cerrar</code>, y lectura de
    <code>conversaciones</code> para sacar el <code>ctwa_clid</code> y el canal.`,

    telegram: {
      'Avisar a Incidencias': 'Cuando un Purchase no se ha podido reportar a Meta. Va al chat de Incidencias, no al de Pedidos.',
    },

    fallo: `
    <p><strong>Se para</strong> en la toma del cerrojo y en el envío a Meta si no
    llevan marca.</p>
    <p><strong>Sigue</strong> en 4 nodos.</p>
    <p><strong>Avisa</strong> a Incidencias cuando no se pudo reportar — pero ese
    aviso también se traga su propio fallo.</p>`,
  },
};

// ─────────────────────────────────────────────────────────────────────────
//  SECCIÓN 4 — TABLA DE RIESGO
//
//  Una entrada por cada nodo con onError=continueRegularOutput.
//  El generador comprueba que están TODOS: si aparece uno nuevo en el
//  workflow y no está aquí, el build lo marca como «SIN ANALIZAR».
//
//  gravedad: critico | alto | medio | bajo
// ─────────────────────────────────────────────────────────────────────────

export const riesgos = {

  // ── CRÍTICOS ──────────────────────────────────────────────────────────
  'qx1O54zpuyxzfW8V::Avisar al dueño - Pedido': {
    gravedad: 'critico',
    pierde: 'El aviso de una venta. El pedido SÍ queda guardado en «pedidos», pero nadie recibe el ping.',
    entero: 'NO. Y es el peor caso del sistema: al cliente no se le dice nada por diseño, así que no hay ni un mensaje que delate que hubo pedido. La venta se queda esperando a que alguien mire el inbox.',
  },
  'qx1O54zpuyxzfW8V::Leer estado de la conversación': {
    gravedad: 'critico',
    pierde: 'Saber si un humano pausó a este cliente. «Interpretar estado» asume bot_activo = true si el GET no responde bien.',
    entero: 'NO. El motivo se escribe en el item («no se pudo leer el estado») pero no sale por ningún sitio. María se pone a contestarle a un cliente que alguien había apartado a mano.',
  },
  'qx1O54zpuyxzfW8V::Check ficha': {
    gravedad: 'critico',
    pierde: 'La recomprobación de la pausa a mitad de flujo. «Check ficha (adaptar)» dice literalmente: si no se puede leer, asumimos NO pausado y seguimos.',
    entero: 'NO. Mismo fallo abierto que el de arriba, pero justo antes de mandar una ficha.',
  },
  'qx1O54zpuyxzfW8V::¿Sigue activo?': {
    gravedad: 'critico',
    pierde: 'La recomprobación de la pausa antes de enviar la respuesta del modelo.',
    entero: 'NO. Falla abierto: si Supabase no contesta, se envía.',
  },
  'qx1O54zpuyxzfW8V::Check oferta': {
    gravedad: 'critico',
    pierde: 'La recomprobación de la pausa antes de mandar una oferta con foto.',
    entero: 'NO. Falla abierto.',
  },
  'qx1O54zpuyxzfW8V::Check final': {
    gravedad: 'critico',
    pierde: 'La última recomprobación de la pausa antes de que salga nada.',
    entero: 'NO. Falla abierto. Es la última red antes del cliente.',
  },
  'CYgKApb26ARGlhVZ::Avisar incidencia por Telegram': {
    gravedad: 'critico',
    pierde: 'El aviso de que un mensaje NO llegó al cliente.',
    entero: 'NO. Doble fallo: el cliente no tiene el mensaje y tú no sabes que no lo tiene. La fila sí queda en «mensajes» con estado fallido, pero hay que ir a mirarla.',
  },
  'qXCipdF2Blm0v6HI::Cerrar con éxito': {
    gravedad: 'critico',
    pierde: 'La marca de que el Purchase ya se reportó. El cerrojo se queda sin cerrar.',
    entero: 'NO. Y el efecto es que el mismo Purchase se vuelve a mandar en la siguiente validación: conversión duplicada en Meta y datos de anuncios corrompidos, que es dinero mal gastado en pujas.',
  },

  // ── ALTOS ─────────────────────────────────────────────────────────────
  'qx1O54zpuyxzfW8V::Guardar atribución': {
    gravedad: 'alto',
    pierde: 'El ctwa_clid del anuncio, que solo llega en el primer mensaje del cliente.',
    entero: 'NO. Nodo terminal. La conversación queda sin atribuir para siempre y el Purchase al CAPI ya no se podrá reportar: la venta existe pero Meta nunca sabrá qué anuncio la trajo.',
  },
  'qx1O54zpuyxzfW8V::Avisar canal desconocido': {
    gravedad: 'alto',
    pierde: 'El único aviso de que entra tráfico por un número sin dar de alta.',
    entero: 'NO. Los mensajes se siguen guardando, pero nadie se entera de que hay un número sin configurar contestando mal o sin catálogo.',
  },
  'qx1O54zpuyxzfW8V::Leer prompt del canal': {
    gravedad: 'alto',
    pierde: 'Los datos del canal (moneda, entrega, saludo). «Componer prompt» se queda con la cadena vacía y sigue.',
    entero: 'NO. María contesta con el prompt común solamente: precios sin moneda del país, condiciones de entrega genéricas. Suena bien y está mal.',
  },
  'qx1O54zpuyxzfW8V::Leer historial del cliente': {
    gravedad: 'alto',
    pierde: 'El historial con el que «Decidir ficha» decide.',
    entero: 'NO. Sin historial puede volver a mandar una ficha ya enviada, que es justo el bug que se corrigió en la v4.',
  },
  'qx1O54zpuyxzfW8V::Leer contexto crudo': {
    gravedad: 'alto',
    pierde: 'El contexto de la conversación. «Leer contexto» devuelve texto vacío.',
    entero: 'NO. María contesta como si acabara de conocer al cliente, en mitad de una conversación.',
  },
  'qx1O54zpuyxzfW8V::Avisar al dueño': {
    gravedad: 'alto',
    pierde: 'El aviso de escalar a un humano.',
    entero: 'NO. El Filtro Seguridad decidió que esto lo tiene que ver una persona, y esa persona no se entera.',
  },
  'qx1O54zpuyxzfW8V::AUDIO ilegible: ¿sigue activo?': {
    gravedad: 'alto',
    pierde: 'La comprobación de pausa en la rama de audio ilegible.',
    entero: 'NO. Falla abierto, igual que sus hermanos.',
  },
  'CYgKApb26ARGlhVZ::Avisar número por defecto': {
    gravedad: 'alto',
    pierde: 'El aviso de que un mensaje salió por el número equivocado.',
    entero: 'NO. Y este aviso existe precisamente porque el fallo silencioso de agosto costó una tarde. Si el aviso muere, vuelve el mismo agujero: el cliente recibe un mensaje de un número que no reconoce.',
  },
  'YGqvrxFadgtdS7Lo::Guardar bloqueo': {
    gravedad: 'alto',
    pierde: 'La marca local de que el cliente está bloqueado.',
    entero: 'NO. Meta lo tiene bloqueado y el inbox lo enseña como normal. La base de datos y la realidad discrepan sin que nadie lo sepa.',
  },
  'qXCipdF2Blm0v6HI::Cerrar con fallo': {
    gravedad: 'alto',
    pierde: 'La liberación del cerrojo tras un fallo.',
    entero: 'NO. Las líneas se quedan tomadas y el Purchase no se reintenta nunca: se pierde la conversión en silencio.',
  },
  'qXCipdF2Blm0v6HI::Avisar a Incidencias': {
    gravedad: 'alto',
    pierde: 'El aviso de que un Purchase no llegó a Meta.',
    entero: 'NO. Es el único aviso de esa rama.',
  },

  // ── MEDIOS ────────────────────────────────────────────────────────────
  'qx1O54zpuyxzfW8V::Marcar interesado': {
    gravedad: 'medio',
    pierde: 'La marca de «interesado» en conversacion_productos.',
    entero: 'NO. Nodo terminal. El embudo pierde una fila: parece que a nadie le interesó ese producto.',
  },
  'qx1O54zpuyxzfW8V::Marcar pedido pendiente': {
    gravedad: 'medio',
    pierde: 'La marca de «comprado» en conversacion_productos.',
    entero: 'NO. Nodo terminal. El pedido está en «pedidos» pero el producto no queda asociado a la conversación.',
  },
  'qx1O54zpuyxzfW8V::MEDIA guardar adjunto': {
    gravedad: 'medio',
    pierde: 'La fila del adjunto. El fichero sí está subido al Storage.',
    entero: 'NO, pero el inbox no lo enseña: hay un fichero huérfano en el bucket.',
  },
  'qx1O54zpuyxzfW8V::MEDIA marcar en el mensaje': {
    gravedad: 'medio',
    pierde: 'La marca en «mensajes» de que ese mensaje lleva adjunto.',
    entero: 'NO. El adjunto existe pero el mensaje no lo sabe.',
  },
  'qx1O54zpuyxzfW8V::MEDIA buscar mensaje': {
    gravedad: 'medio',
    pierde: 'El mensaje al que colgar el adjunto.',
    entero: 'Parcialmente: hay una rama «MEDIA sin mensaje al que colgarse», pero no manda aviso.',
  },
  'qx1O54zpuyxzfW8V::TRANSCRIBIR guardar': {
    gravedad: 'medio',
    pierde: 'La transcripción guardada en «adjuntos».',
    entero: 'NO. El flujo sigue con el texto en memoria, así que María contesta bien esta vez; lo que se pierde es el registro para después.',
  },
  'qx1O54zpuyxzfW8V::AUDIO ilegible: aviso Telegram': {
    gravedad: 'medio',
    pierde: 'El aviso de un audio que no se pudo transcribir.',
    entero: 'NO, pero la rama sigue y el cliente recibe igualmente el mensaje de «no te he entendido».',
  },
  'qx1O54zpuyxzfW8V::Guardar incidencia': {
    gravedad: 'medio',
    pierde: 'La fila en la hoja de Incidencias.',
    entero: 'NO. Nodo terminal. Se pierde el registro para analizar después; no afecta a la conversación.',
  },
  'qx1O54zpuyxzfW8V::Guardar incidencia de bloqueo': {
    gravedad: 'medio',
    pierde: 'El registro de una respuesta bloqueada por el Filtro Seguridad.',
    entero: 'NO. Nodo terminal. Se pierde la señal de que el filtro está actuando y con qué frecuencia.',
  },
  'CYgKApb26ARGlhVZ::Canal de la conversación': {
    gravedad: 'medio',
    pierde: 'El canal de la conversación, así que «Número de salida» cae al de wa.env.',
    entero: 'SÍ, si Telegram funciona: «¿Cayó al número por defecto?» lo detecta y avisa. Pero el cliente ya ha recibido el mensaje desde un número que no reconoce.',
  },
  'CYgKApb26ARGlhVZ::Guardar adjunto saliente': {
    gravedad: 'medio',
    pierde: 'La fila del adjunto que se acaba de mandar.',
    entero: 'NO. El cliente tiene la foto y el inbox no la enseña.',
  },
  'CYgKApb26ARGlhVZ::Conversación atendida: no_leidos a 0': {
    gravedad: 'medio',
    pierde: 'La puesta a cero del contador de no leídos.',
    entero: 'NO. La conversación se queda marcada como pendiente en el inbox aunque ya se contestó. Ruido, no pérdida.',
  },
  'YGqvrxFadgtdS7Lo::Bloquear en Meta': {
    gravedad: 'medio',
    pierde: 'El bloqueo en WhatsApp.',
    entero: 'SÍ. «Leer respuesta de bloqueo» comprueba el statusCode y traduce el error, y se le devuelve al inbox. La persona que pulsó el botón lo ve.',
  },

  // ── BAJOS ─────────────────────────────────────────────────────────────
  'CYgKApb26ARGlhVZ::ENVIAR A WHATSAPP (único punto de salida)': {
    gravedad: 'bajo',
    pierde: 'El mensaje al cliente.',
    entero: 'SÍ. Es el único nodo del sistema con reintento, y su fallo se comprueba explícitamente en «¿Falló el envío?» y se avisa. Así es como deberían estar todos.',
  },
  'CYgKApb26ARGlhVZ::Avisar fallo de confirmación': {
    gravedad: 'bajo',
    pierde: 'El aviso de que no se pudo marcar como leído.',
    entero: 'NO, pero lo único que se pierde es el check azul.',
  },
  'qx1O54zpuyxzfW8V::TRANSCRIBIR con Whisper': {
    gravedad: 'bajo',
    pierde: 'La transcripción del audio.',
    entero: 'SÍ. «TRANSCRIBIR leer resultado» y «AUDIO decidir» tratan el fallo y la rama acaba avisando al cliente de que no se le entendió.',
  },
  'qx1O54zpuyxzfW8V::Buscar canal': {
    gravedad: 'bajo',
    pierde: 'La fila del canal. «Resolver canal» lo trata como canal desconocido.',
    entero: 'SÍ, avisa por Telegram. El efecto secundario es que durante una caída de Supabase avisaría por cada mensaje.',
  },
  'YGqvrxFadgtdS7Lo::Verificar sesión en Supabase': {
    gravedad: 'bajo',
    pierde: 'La validación de la sesión.',
    entero: 'SÍ, y falla CERRADO: «Comprobar sesión» exige statusCode 200 y rol authenticated, así que un fallo devuelve 401. Correcto.',
  },
  'qXCipdF2Blm0v6HI::Verificar sesión en Supabase': {
    gravedad: 'bajo',
    pierde: 'La validación de la sesión.',
    entero: 'SÍ, falla cerrado igual que el del inbox.',
  },
};

// ─────────────────────────────────────────────────────────────────────────
//  SECCIÓN 5 — DISCREPANCIAS
//  Cosas donde el código no cuadra con lo que se supone que hace.
// ─────────────────────────────────────────────────────────────────────────

export const discrepancias = [
  {
    titulo: 'La identidad todavía depende del canal en tres tablas',
    gravedad: 'alto',
    ancla: ['Leer fichas enviadas', 'Marcar ficha directa', 'Guardar pedido'],
    texto: `La regla 3 dice que la identidad es <code>cliente_id</code>, nunca el
    teléfono ni el LID. Pero <code>pedidos</code> se inserta con una columna
    <code>telefono</code>, y <code>fichas_enviadas</code> usa una
    <code>clave</code> que el propio SQL admite en un comentario:
    <em>«OJO: fichas_enviadas.clave todavia usa LID/telefono del mundo viejo»</em>.
    Mientras siga así, un cliente que cambie de número es dos clientes para las
    fichas y para los pedidos.`,
  },
  {
    titulo: 'El sistema escribe en dos bases de datos, no en una',
    gravedad: 'alto',
    ancla: ['Guardar en buffer', 'Vaciar buffer', 'Guardar pedido', 'Postgres Chat Memory'],
    texto: `La migración a Supabase está a medias y no se ve en ningún sitio.
    Conversaciones, mensajes, adjuntos y canales viven en Supabase Cloud; pero
    <code>buffer_mensajes</code>, <code>pedidos</code>, <code>fichas_enviadas</code>
    y <code>n8n_chat_histories</code> siguen en el Postgres del contenedor
    <code>bot-postgres-1</code>, con nodos <code>postgres</code> y SQL a mano.
    Son dos backups distintos, dos modos de fallo distintos y ninguna transacción
    que los cruce: un pedido puede guardarse en Postgres y su marca de producto
    fallar en Supabase, y quedan descuadrados sin que nadie lo note.`,
  },
  {
    titulo: 'La pausa manual falla abierta en cinco sitios',
    gravedad: 'critico',
    ancla: ['Interpretar estado', 'Check ficha (adaptar)', '¿Sigue activo? (adaptar)', 'Check oferta (adaptar)', 'Check final (adaptar)'],
    texto: `Pausar el bot es la única herramienta que tiene un humano para
    recuperar una conversación que María está estropeando. Pero las cinco
    comprobaciones de la pausa asumen «no pausado» si no pueden leer Supabase.
    El comentario del código lo dice sin rodeos: <em>«Si no se puede leer,
    asumimos NO pausado y seguimos»</em>. Una función de seguridad tiene que
    fallar cerrada: si no se sabe si el cliente está pausado, lo prudente es
    callarse, no hablar. Los nodos de sesión del inbox y del CAPI sí fallan
    cerrados — el criterio no es el mismo en todo el sistema.`,
  },
  {
    titulo: 'El modelo de publicación de n8n no está en uso',
    gravedad: 'medio',
    ancla: [],
    texto: `El CLAUDE.md describe un flujo de publicar/despublicar con cascada, y
    esa historia es real. Pero hoy, en esta instancia (n8n 2.34.6),
    <code>workflow_published_version</code> y
    <code>workflow_publication_trigger_status</code> están <strong>vacías</strong>:
    va con el modelo clásico de <code>active</code>. Lo que quita las filas de
    <code>webhook_entity</code> es desactivar, no despublicar.
    <br><strong>Lo que no se ha probado:</strong> desactivar un subflujo que tenga
    un llamador vivo. Al apagar el subflujo antiguo se apagó primero su único
    llamador activo, así que ese caso no se reprodujo y no se puede afirmar que sea
    inofensivo. El peligro del <code>PUT</code> sigue en pie por otra razón: un PUT
    reescribe el workflow entero.`,
  },
  {
    titulo: 'Un aviso que se traga su propio error no es un aviso',
    gravedad: 'alto',
    ancla: ['Avisar al dueño', 'Avisar al dueño - Pedido', 'Avisar canal desconocido', 'Avisar incidencia por Telegram', 'Avisar número por defecto', 'Avisar a Incidencias'],
    texto: `Los ocho nodos de Telegram del sistema llevan
    <code>onError: continueRegularOutput</code>. Eso significa que si Telegram
    falla —o si la expresión que compone el mensaje se rompe, que ya pasó una vez
    con <code>{"error":"invalid syntax"}</code>— el aviso desaparece sin dejar
    rastro y la ejecución sale verde. La red de seguridad tiene el mismo modo de
    fallo silencioso que aquello de lo que protege.`,
  },
  {
    titulo: '«¿Esperando datos?» busca tres frases literales',
    gravedad: 'medio',
    ancla: ['¿Esperando datos?'],
    texto: `Para saber si María ya pidió la dirección, se buscan tres cadenas
    literales (<code>'%para preparar el env%'</code> y dos más) en el último
    mensaje del historial. Si el modelo lo dice de otra forma, falla en silencio.
    Está asumido y es aceptable porque es una decisión de un turno que se
    autocorrige al mensaje siguiente — pero conviene saber que ahí hay una regex
    contra texto libre de un modelo.`,
  },
  {
    titulo: 'El indicador de «escribiendo…» se manda antes de saber si habrá respuesta',
    gravedad: 'bajo',
    ancla: ['Preparar: leído + escribiendo', 'MARCAR leído + escribiendo', 'Añadir contexto'],
    texto: `El check azul y el «escribiendo…» salen en «Añadir contexto», mucho
    antes de saber si esto va a acabar en pedido. Cuando acaba en pedido, el bot
    se calla a propósito: el cliente ve el doble check y «escribiendo…», y luego
    nada. El indicador caduca solo a los 25 segundos. Moverlo detrás de
    «¿Pedido completo?» arreglaría eso pero retrasaría el check azul en todos los
    mensajes normales.`,
  },
];
