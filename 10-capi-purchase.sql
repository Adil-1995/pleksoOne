-- =====================================================================
--  LumaBot — Purchase al CAPI en la VALIDACIÓN, no en la detección
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  Con pago contra entrega, un pedido DETECTADO no es una venta. La venta
--  es cuando un humano la valida en el inbox.
--
--  Va en `conversacion_productos` y no en `pedidos`: `pedidos` vive en el
--  Postgres viejo, no en Supabase, y lo que el inbox valida es esta tabla.
--
--  UNA CONVERSACIÓN = UNA VENTA. La tabla tiene una fila por producto, así
--  que un pedido de dos artículos son dos filas pero UN evento, con el
--  value sumado. Por eso el cerrojo se toma sobre todas las líneas a la vez.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PRECIO Y CANTIDAD
--
--    Los escribe el flujo LEYENDO DEL CATÁLOGO, nunca del texto de María.
--    Si el producto no casa con el catálogo, `precio` se queda NULL y el
--    Purchase no sale: un value inventado es peor que un evento perdido,
--    porque Meta optimiza con él.
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS precio NUMERIC(12,2);
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS cantidad INT;

COMMENT ON COLUMN conversacion_productos.precio IS
  'Precio UNITARIO del catálogo en el momento del pedido. NULL = no se pudo identificar el producto; sin esto el Purchase no se envía.';
COMMENT ON COLUMN conversacion_productos.cantidad IS
  'Unidades. El value del evento es SUMA(precio * cantidad) de las líneas validadas.';


-- ---------------------------------------------------------------------
-- 2. EL RASTRO DEL CAPI
--
--    Tres columnas porque responden tres preguntas distintas. Con solo
--    `capi_enviado_en`, un NULL no distingue "no se intentó nunca" de
--    "se intentó y Meta lo rechazó", que es justo lo que hay que ver
--    cuando faltan ventas en los informes.
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS capi_enviado_en TIMESTAMPTZ;
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS capi_error TEXT;
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS capi_intentos INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN conversacion_productos.capi_enviado_en IS
  'Puesto = reportado a Meta con éxito, o cerrado a mano. Es el CERROJO: se toma con capi_tomar(), que solo devuelve filas si estaba NULL. Se SUELTA si Meta rechaza, para poder reintentar; como el event_id es estable, Meta deduplica y un reintento no puede contar doble.';
COMMENT ON COLUMN conversacion_productos.capi_error IS
  'Último rechazo de Meta. NULL + capi_enviado_en NULL = no se ha intentado. NULL + capi_enviado_en puesto = fue bien. Texto + capi_enviado_en NULL = falló y se puede reintentar.';
COMMENT ON COLUMN conversacion_productos.capi_intentos IS
  'Sube en CADA intento, incluidos los que fallan. Sin esto, un fallo repetido es indistinguible de uno solo.';


-- ---------------------------------------------------------------------
-- 3. TOMAR EL CERROJO
--
--    Un solo UPDATE con el WHERE dentro: es lo que hace que dos
--    pulsaciones simultáneas no manden dos eventos. La segunda se queda
--    esperando el bloqueo de fila, reevalúa el WHERE al liberarse, y ya
--    no encuentra nada que tomar. Comprobado con dos sesiones a la vez.
--
--    Leer primero y decidir después NO vale: las dos verían NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION capi_tomar(p_conversacion_id BIGINT)
RETURNS TABLE(id BIGINT, producto TEXT, precio NUMERIC, cantidad INT) AS $$
  UPDATE conversacion_productos
  SET capi_enviado_en = now(),
      capi_intentos   = capi_intentos + 1
  WHERE conversacion_id = p_conversacion_id
    AND estado = 'validado'
    AND capi_enviado_en IS NULL
  RETURNING id, producto, precio, cantidad;
$$ LANGUAGE sql;

COMMENT ON FUNCTION capi_tomar IS
  'Toma el cerrojo de TODAS las líneas validadas y no reportadas de una conversación, y las devuelve. Cero filas = no hay nada que reportar: se sale sin error y sin enviar.';


-- ---------------------------------------------------------------------
-- 4. CERRAR
--
--    Éxito: se queda el cerrojo puesto y se limpia el error.
--    Fallo : se SUELTA el cerrojo y se apunta el motivo, para que la fila
--            vuelva a aparecer en la consulta de "validados sin reportar"
--            y se pueda reintentar cuando se arregle la causa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION capi_cerrar(p_ids BIGINT[], p_ok BOOLEAN, p_error TEXT)
RETURNS INT AS $$
  WITH u AS (
    UPDATE conversacion_productos
    SET capi_error      = CASE WHEN p_ok THEN NULL ELSE p_error END,
        capi_enviado_en = CASE WHEN p_ok THEN capi_enviado_en ELSE NULL END
    WHERE id = ANY(p_ids)
    RETURNING 1
  )
  SELECT count(*)::INT FROM u;
$$ LANGUAGE sql;


-- ---------------------------------------------------------------------
-- 5. LOS 36 ANTIGUOS SE OLVIDAN
--
--    La ventana de atribución del CAPI es de 7 días: reportar hoy ventas
--    validadas hace semanas no atribuye nada y sí ensucia el dataset.
--    Se cierran con el cerrojo puesto y el motivo escrito, para que no
--    parezcan enviadas de verdad.
-- ---------------------------------------------------------------------
UPDATE conversacion_productos
SET capi_enviado_en = now(),
    capi_error      = 'histórico: validado antes de que el CAPI colgara de la validación, no se reporta'
WHERE estado = 'validado'
  AND capi_enviado_en IS NULL;


-- ---------------------------------------------------------------------
-- 6. ÍNDICE: "¿qué ventas no llegaron a Meta?"
--
--    Parcial a propósito. Aquí sí vale: no es para un ON CONFLICT, que es
--    donde PostgREST no puede usarlos.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cp_capi_pendiente
  ON conversacion_productos (validado_en)
  WHERE estado = 'validado' AND capi_enviado_en IS NULL;


-- ---------------------------------------------------------------------
-- 7. COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'columnas nuevas' AS que,
       string_agg(column_name, ', ' ORDER BY column_name) AS detalle
FROM information_schema.columns
WHERE table_name = 'conversacion_productos'
  AND column_name IN ('precio','cantidad','capi_enviado_en','capi_error','capi_intentos')
UNION ALL
SELECT 'funciones creadas',
       string_agg(proname, ', ' ORDER BY proname)
FROM pg_proc WHERE proname IN ('capi_tomar','capi_cerrar')
UNION ALL
SELECT 'históricos cerrados (deben ser 36)',
       count(*)::text FROM conversacion_productos
WHERE capi_error LIKE 'histórico:%'
UNION ALL
SELECT 'pendientes de reportar (deben ser 0)',
       count(*)::text FROM conversacion_productos
WHERE estado = 'validado' AND capi_enviado_en IS NULL;
