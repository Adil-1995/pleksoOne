-- =====================================================================
--  LumaBot — Marca de «revisado hasta aquí»
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  QUÉ ES
--
--  Un separador móvil en la lista de conversaciones: «de aquí para arriba
--  está sin mirar, de aquí para abajo ya lo vi». No es un estado de la
--  conversación, es un marcador de por dónde iba la PERSONA.
--
--
--  POR QUÉ UNA TABLA Y NO UNA COLUMNA EN `conversaciones`
--
--  Con `conversaciones.revisado BOOLEAN` la regla «solo una a la vez» sería
--  una CONVENCIÓN del frontend: quitar la anterior y poner la nueva son dos
--  escrituras, y entre las dos —o si una falla, o si marcas desde el móvil
--  y el PC a la vez— quedan dos marcas o ninguna. Nadie se entera hasta que
--  la lista sale con dos rayas amarillas.
--
--  Aquí la regla es la CLAVE PRIMARIA. Una fila por canal, un upsert por
--  `canal_id`: marcar otra conversación no «quita» la anterior, la
--  SUSTITUYE, en una sola escritura atómica. Es imposible tener dos marcas
--  en el mismo canal aunque el frontend se equivoque.
--
--
--  POR QUÉ POR CANAL Y NO UNA GLOBAL
--
--  La lista mezcla los dos números y los ordena por fecha. Una sola marca
--  sobre esa mezcla no dice nada: una conversación del canal 1 por encima
--  de la raya puede ser más nueva que una del canal 2 por debajo. Y al
--  filtrar por canal, la marca del otro número desaparece de la vista y
--  pierdes el sitio.
--
--  Hoy, con 338 conversaciones en el canal 2 y 3 en el 1, se comporta
--  exactamente igual que una marca única. La diferencia aparece el día que
--  se trabajen los dos números de verdad, y ese día ya no se puede cambiar
--  sin migrar datos.
--
--
--  POR QUÉ NO ES POR USUARIO
--
--  Es compartida a propósito: es la marca DEL EQUIPO, no la tuya. Se pidió
--  para verla igual desde el móvil y desde el PC, y con una marca por
--  usuario el segundo que entrara vería la lista sin marcar y no entendería
--  nada. Quién la puso queda en `marcado_por`, que es lo que hace falta
--  saber cuando dos personas se pisan.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LA TABLA
--
--    `canal_id` es PRIMARY KEY, no una columna más: ahí es donde vive la
--    regla de «una sola marca». Ver arriba.
--
--    Los dos ON DELETE CASCADE son deliberados: si se borra un canal o una
--    conversación, la marca que apuntaba ahí no significa nada y no tiene
--    que quedarse señalando al vacío.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marcas_revision (
  canal_id        BIGINT PRIMARY KEY REFERENCES canales (id)        ON DELETE CASCADE,
  conversacion_id BIGINT NOT NULL    REFERENCES conversaciones (id) ON DELETE CASCADE,
  marcado_por     UUID               REFERENCES auth.users (id)     ON DELETE SET NULL,
  marcado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marcas_revision IS
  'Dónde se quedó el equipo repasando la lista. UNA fila por canal como máximo: la clave primaria lo impone, no el frontend. Marcar otra conversación es un upsert sobre canal_id, que sustituye la anterior en una sola escritura. Quitar la marca es borrar la fila.';
COMMENT ON COLUMN marcas_revision.conversacion_id IS
  'La conversación marcada. De ella hacia abajo se da por revisado.';
COMMENT ON COLUMN marcas_revision.marcado_por IS
  'Quién puso la marca. NULL = no se pudo saber. Lo escribe un trigger desde auth.uid(), nunca el navegador.';

-- Buscar por conversación (¿está marcada esta fila?) se hace en el
-- frontend sobre dos filas en memoria, pero el índice hace falta igual: el
-- ON DELETE CASCADE de conversaciones recorre esta columna en cada borrado.
CREATE INDEX IF NOT EXISTS idx_marcas_conv ON marcas_revision (conversacion_id);


-- ---------------------------------------------------------------------
-- 2. QUIÉN Y CUÁNDO, PUESTO POR LA BASE
--
--    Mismo patrón que `tocar_pausa_canal` y `tocar_conversacion_producto`:
--    `marcado_por` sale de auth.uid(), no de lo que mande el cliente. Si lo
--    mandara el navegador, cualquiera podría decir que la marca la puso otro.
--
--    Aquí se reescribe SIEMPRE, sin comparar con OLD: en esta tabla el único
--    cambio posible es mover la marca, y mover la marca es un hecho nuevo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_marca_revision()
RETURNS TRIGGER AS $$
BEGIN
  NEW.marcado_por = auth.uid();
  NEW.marcado_en  = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_marca ON marcas_revision;
CREATE TRIGGER trg_tocar_marca
  BEFORE INSERT OR UPDATE ON marcas_revision
  FOR EACH ROW EXECUTE FUNCTION tocar_marca_revision();


-- ---------------------------------------------------------------------
-- 3. RLS
--
--    Igual que `conversacion_productos`: el equipo entero lee y escribe.
--    DELETE hace falta de verdad — es cómo se quita la marca.
--
--    La service_role se salta esto, así que n8n podría escribir aquí. No lo
--    hace ni debe: esta marca es de una persona, no del flujo.
-- ---------------------------------------------------------------------
ALTER TABLE marcas_revision ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_ve_marcas     ON marcas_revision;
DROP POLICY IF EXISTS equipo_pone_marcas   ON marcas_revision;
DROP POLICY IF EXISTS equipo_mueve_marcas  ON marcas_revision;
DROP POLICY IF EXISTS equipo_quita_marcas  ON marcas_revision;

CREATE POLICY equipo_ve_marcas    ON marcas_revision
  FOR SELECT TO authenticated USING (true);
CREATE POLICY equipo_pone_marcas  ON marcas_revision
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_mueve_marcas ON marcas_revision
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY equipo_quita_marcas ON marcas_revision
  FOR DELETE TO authenticated USING (true);


-- ---------------------------------------------------------------------
-- 4. REALTIME
--
--    Es la mitad del encargo: «la quiero ver igual desde el móvil y desde
--    el PC». Sin esto, marcar en el móvil no movería la raya del PC hasta
--    recargar, y con dos rayas amarillas a la vista durante un rato la
--    marca deja de ser de fiar.
--
--    El IF evita el error 42710 al volver a ejecutar el fichero.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marcas_revision'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marcas_revision;
  END IF;
END $$;

-- Para que el UPDATE/DELETE de Realtime traiga la fila vieja y el frontend
-- sepa qué raya quitar. Sin esto, `payload.old` llega solo con la clave.
ALTER TABLE marcas_revision REPLICA IDENTITY FULL;


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'tabla creada' AS que,
       (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'marcas_revision') AS valor

UNION ALL
SELECT 'canal_id es PRIMARY KEY (la regla de «una sola»)',
       (SELECT string_agg(a.attname, ', ')
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'marcas_revision'::regclass AND i.indisprimary)

UNION ALL
SELECT 'policies',
       (SELECT string_agg(cmd, ', ' ORDER BY cmd)
        FROM pg_policies WHERE tablename = 'marcas_revision')

UNION ALL
SELECT 'en la publicación de Realtime',
       (SELECT count(*)::text FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'marcas_revision')

UNION ALL
SELECT 'marcas puestas ahora mismo',
       (SELECT count(*)::text FROM marcas_revision);
