-- =====================================================================
--  LumaBot — Un dataset de Meta por canal
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  AQUÍ NO VA NINGÚN TOKEN. Un dataset_id es un identificador público,
--  igual que el waba_id que ya está en esta tabla: no abre nada por sí
--  solo. Para escribir en él hace falta CAPI_TOKEN, que sigue en
--  /opt/bot/wa.env con permisos 600 y no se copia a ninguna tabla.
--
--  ---------------------------------------------------------------------
--  POR QUÉ ESTA COLUMNA
--
--  El Purchase al CAPI mandaba los eventos a UN dataset global, leído de
--  $env.CAPI_DATASET (= 2044273926400221), el mismo para los dos canales.
--  Pero un dataset de mensajería pertenece a UNA cuenta de WhatsApp
--  Business, y el evento lleva dentro `user_data.whatsapp_business_account_id`
--  con el waba_id del canal que vendió. Si el dataset que recibe no es el
--  de esa WABA, Meta lo rechaza entero:
--
--    code 100 / error_subcode 2804132
--    "No hay ninguna cuenta de WhatsApp Business vinculada a este conjunto
--     de datos"
--
--  Y lo rechaza EN SILENCIO desde el punto de vista de n8n: la ejecución
--  sale `success`. Las 10 últimas del 3/9/2026 estaban todas en verde con
--  el evento tirado a la basura (ejec. 27494, fbtrace Ah55aP9gmST935927C2vMgr).
--
--  El mapeo correcto lo da la propia Meta, no nosotros:
--    GET /{WABA_ID}/dataset  →  {"data":[{"id":"..."}]}
--
--  ---------------------------------------------------------------------
--  POR QUÉ EN LA TABLA Y NO EN wa.env
--
--  Porque hay DOS canales y va a haber más. Una variable de entorno es un
--  valor único: en cuanto hay dos números, o eliges mal para uno o duplicas
--  la variable y el flujo tiene que decidir cuál, que es la misma decisión
--  pero escondida en una expresión. El waba_id ya vive aquí y se lee en el
--  mismo join; el dataset es su pareja y viaja al lado (regla 4: lo que
--  distingue a un canal, en la fila del canal).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LA COLUMNA
-- ---------------------------------------------------------------------
ALTER TABLE canales ADD COLUMN IF NOT EXISTS dataset_id TEXT;

COMMENT ON COLUMN canales.dataset_id IS
  'Dataset de Meta al que se mandan los Purchase del CAPI de ESTE canal. Se obtiene con POST /{WABA_ID}/dataset (o GET para recuperarlo si ya existe) y es propio de la WABA: mandar el evento a otro dataset da error 100/2804132. Sin él no se envía nada — no hay repliegue a un valor por defecto a propósito.';


-- ---------------------------------------------------------------------
-- 2. LOS DOS CANALES DE HOY
--
--    Se emparejan por `waba_id`, NO por `id`. El dataset es una propiedad
--    de la cuenta de WhatsApp Business, así que la WABA es la llave real;
--    el `id` es nuestro y podría no coincidir en otra instalación o tras
--    restaurar un backup.
--
--    Creados el 30/8/2026 con POST /{WABA_ID}/dataset. Verificados contra
--    Meta el 3/9/2026 con GET /{WABA_ID}/dataset.
-- ---------------------------------------------------------------------

-- Canal 1 · «México — pruebas» · dataset "Test WhatsApp Business Account Event Data"
UPDATE canales
   SET dataset_id = '1672235741574223'
 WHERE waba_id = '1686689748986716';

-- Canal 2 · «Numero MX_2» · dataset "Lado Luminoso Event Data"
UPDATE canales
   SET dataset_id = '1623190315916336'
 WHERE waba_id = '1100299049179241';


-- ---------------------------------------------------------------------
-- 3. COMPROBACIÓN
--
--    Un canal activo de tipo whatsapp_cloud con waba_id y sin dataset_id
--    es un canal que NO va a reportar ni una venta. Que salte aquí, al
--    pegar el SQL, y no dentro de una ejecución en verde tres semanas
--    después.
-- ---------------------------------------------------------------------
SELECT id, nombre, waba_id, dataset_id,
       CASE
         WHEN dataset_id IS NULL OR dataset_id = '' THEN '⚠️  SIN DATASET — el CAPI no reportará este canal'
         ELSE 'ok'
       END AS estado_capi
  FROM canales
 WHERE activo AND tipo = 'whatsapp_cloud'
 ORDER BY orden, id;
