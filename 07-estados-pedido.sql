-- =====================================================================
--  LumaBot — Tres estados de pedido
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  QUÉ CAMBIA
--    Antes:  interesado → comprado          (el flujo marcaba comprado)
--    Ahora:  interesado → pendiente → validado
--
--    El flujo ya no dice "comprado": dice "he detectado un pedido"
--    (pendiente). Que sea una venta de verdad lo decide una persona
--    (validado). Es la diferencia entre lo que la máquina cree y lo que
--    alguien ha confirmado, y hasta hoy estaban mezcladas en el mismo valor.
--
--  DÓNDE
--    En `conversacion_productos.estado`, NO en una columna nueva.
--    `estado` ya significaba exactamente esto: en qué punto está este
--    producto en esta conversación. Con un `estado_pedido` aparte habría
--    que decidir qué significa estado='interesado' + estado_pedido='validado',
--    y en cuanto hay dos columnas que pueden contradecirse, se contradicen.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. QUIÉN VALIDÓ Y CUÁNDO
--
--    Aparte de marcado_por/marcado_en, que dicen quién tocó la fila la
--    última vez. Esto dice quién dio el visto bueno, que es la pregunta
--    que se hace cuando cuadras caja: no "quién movió esto" sino "quién
--    dijo que esta venta era buena".
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS validado_por UUID
  REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS validado_en TIMESTAMPTZ;

COMMENT ON COLUMN conversacion_productos.validado_por IS
  'Quién validó el pedido. NULL = todavía no está validado, o lo validó el flujo (que no debería).';


-- ---------------------------------------------------------------------
-- 2. EL CHECK Y LA MIGRACIÓN, EN ESTE ORDEN
--
--    Primero se quita la restricción vieja, luego se migran los datos, y
--    solo entonces se pone la nueva. Al revés, el ALTER fallaría contra
--    las filas que todavía dicen 'comprado'.
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos DROP CONSTRAINT IF EXISTS conversacion_productos_estado_check;

-- Los `comprado` pasan a `validado`, no a `pendiente`: vienen de pedidos
-- reales ya registrados, y degradarlos obligaría a revalidar a mano
-- trabajo que ya estaba hecho.
UPDATE conversacion_productos SET estado = 'validado' WHERE estado = 'comprado';

ALTER TABLE conversacion_productos
  ADD CONSTRAINT conversacion_productos_estado_check
  CHECK (estado IN ('interesado', 'pendiente', 'validado'));


-- ---------------------------------------------------------------------
-- 3. EL TRIGGER
--
--    `validado_por` sale de auth.uid(), no de lo que mande el navegador, y
--    solo se toca cuando la fila ENTRA o SALE de 'validado'. Si se
--    reescribiera en cada cambio, una edición posterior cualquiera borraría
--    quién fue el que validó, que es justo el dato que hay que conservar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_conversacion_producto()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado = NOW();
  NEW.marcado_por = auth.uid();
  NEW.marcado_en  = NOW();

  IF NEW.estado = 'validado' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'validado') THEN
    -- Acaba de validarse.
    NEW.validado_por = auth.uid();
    NEW.validado_en  = NOW();
  ELSIF NEW.estado <> 'validado' THEN
    -- Se ha deshecho: el dato de validación deja de ser cierto.
    NEW.validado_por = NULL;
    NEW.validado_en  = NULL;
  ELSE
    -- Sigue validada y se ha tocado otra cosa: no se pierde quién fue.
    NEW.validado_por = OLD.validado_por;
    NEW.validado_en  = OLD.validado_en;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_cp ON conversacion_productos;
CREATE TRIGGER trg_tocar_cp
  BEFORE INSERT OR UPDATE ON conversacion_productos
  FOR EACH ROW EXECUTE FUNCTION tocar_conversacion_producto();


-- ---------------------------------------------------------------------
-- 4. Las 36 filas migradas quedan sin `validado_por`: se validaron antes
--    de que existiera la columna. Se les pone la fecha del último cambio
--    para no dejar un hueco sin explicación, y el autor a NULL, que es la
--    verdad — nadie las validó, venían así.
-- ---------------------------------------------------------------------
UPDATE conversacion_productos
SET validado_en = actualizado
WHERE estado = 'validado' AND validado_en IS NULL;


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'filas por estado' AS que, estado AS detalle, count(*)::text AS valor
FROM conversacion_productos GROUP BY estado

UNION ALL
SELECT 'quedan comprado (debe ser 0)', '', count(*)::text
FROM conversacion_productos WHERE estado = 'comprado'

UNION ALL
SELECT 'validadas con fecha', '', count(*)::text
FROM conversacion_productos WHERE estado = 'validado' AND validado_en IS NOT NULL

UNION ALL
SELECT 'columnas de validación', string_agg(column_name, ', ' ORDER BY column_name), ''
FROM information_schema.columns
WHERE table_name = 'conversacion_productos' AND column_name LIKE 'validado%'

UNION ALL
SELECT 'valores que admite el CHECK', pg_get_constraintdef(oid), ''
FROM pg_constraint WHERE conname = 'conversacion_productos_estado_check';
