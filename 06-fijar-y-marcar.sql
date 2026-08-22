-- =====================================================================
--  LumaBot — Fijar conversaciones y marcar comprado a mano
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. FIJAR
--    Distinto de `favorita`: favorita es "esta me importa", fijada es
--    "esta va arriba del todo". Se pueden combinar.
-- ---------------------------------------------------------------------
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS fijada BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN conversaciones.fijada IS
  'Va arriba de la lista, por encima del orden por fecha. Independiente de favorita.';

-- El índice lleva ultimo_en dentro porque el orden real es
-- (fijada DESC, ultimo_en DESC): así sale ordenado sin pasar por el sort.
CREATE INDEX IF NOT EXISTS idx_conv_fijada ON conversaciones (ultimo_en DESC) WHERE fijada;


-- ---------------------------------------------------------------------
-- 2. QUIÉN MARCÓ Y CUÁNDO
--
--    NULL en marcado_por = lo puso el flujo (n8n usa la service_role, que
--    no tiene auth.uid()). Un UUID = lo corrigió una persona. Poder
--    distinguirlo es justo el motivo de guardarlo: si un día los números
--    no cuadran, lo primero que hay que saber es cuántos vienen del
--    pedido automático y cuántos de una corrección a mano.
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS marcado_por UUID
  REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE conversacion_productos ADD COLUMN IF NOT EXISTS marcado_en TIMESTAMPTZ;

COMMENT ON COLUMN conversacion_productos.marcado_por IS
  'Quién escribió esta fila. NULL = el flujo de n8n. UUID = una persona desde el inbox.';


-- ---------------------------------------------------------------------
-- 3. EL TRIGGER LO RELLENA SOLO
--
--    No se fía del cliente: `marcado_por` sale de auth.uid(), no de lo que
--    mande el navegador. Con la service_role auth.uid() es NULL y la fila
--    queda marcada como del flujo, que es la verdad.
--
--    Se reescribe en CADA escritura a propósito: si el flujo vuelve a
--    tocar una fila que alguien había corregido, el dato tiene que decir
--    que ahora la última palabra la tuvo el flujo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_conversacion_producto()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado  = NOW();
  NEW.marcado_por  = auth.uid();
  NEW.marcado_en   = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_cp ON conversacion_productos;
CREATE TRIGGER trg_tocar_cp
  BEFORE INSERT OR UPDATE ON conversacion_productos
  FOR EACH ROW EXECUTE FUNCTION tocar_conversacion_producto();


-- ---------------------------------------------------------------------
-- 4. POLICIES
--
--    Hasta ahora esta tabla solo la escribía la service_role, a propósito.
--    Se abre para que el equipo pueda CORREGIR, que es lo que se pidió:
--    el pedido automático sigue funcionando igual y esto va encima.
--
--    Se dan INSERT, UPDATE y DELETE porque las tres cosas hacen falta:
--    marcar un producto que el flujo no detectó, cambiar el estado, y
--    deshacer una marca puesta por error.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS equipo_marca_conv_prod   ON conversacion_productos;
DROP POLICY IF EXISTS equipo_corrige_conv_prod ON conversacion_productos;
DROP POLICY IF EXISTS equipo_borra_conv_prod   ON conversacion_productos;

CREATE POLICY equipo_marca_conv_prod   ON conversacion_productos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_corrige_conv_prod ON conversacion_productos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY equipo_borra_conv_prod   ON conversacion_productos
  FOR DELETE TO authenticated USING (true);


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'columna fijada' AS que,
       (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'conversaciones' AND column_name = 'fijada') AS valor

UNION ALL
SELECT 'columnas de marcado',
       (SELECT string_agg(column_name, ', ' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_name = 'conversacion_productos'
          AND column_name IN ('marcado_por','marcado_en'))

UNION ALL
SELECT 'policies de conversacion_productos',
       (SELECT string_agg(cmd, ', ' ORDER BY cmd)
        FROM pg_policies WHERE tablename = 'conversacion_productos')

UNION ALL
SELECT 'filas marcadas por el flujo',
       (SELECT count(*)::text FROM conversacion_productos WHERE marcado_por IS NULL)

UNION ALL
SELECT 'filas marcadas por una persona',
       (SELECT count(*)::text FROM conversacion_productos WHERE marcado_por IS NOT NULL);
