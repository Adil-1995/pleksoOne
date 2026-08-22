-- =====================================================================
--  LumaBot — Multicanal
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  AQUÍ NO VA NINGÚN TOKEN. Ni el de Meta, ni el de Google, ni ninguno.
--  Esta tabla es CONFIGURACIÓN: qué números existen, cómo se llaman, qué
--  saben hacer. Las credenciales siguen en /opt/bot/wa.env con permisos
--  600, que es la única copia. Un token en una tabla que el inbox lee con
--  la anon key es un token publicado.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. COLUMNAS NUEVAS EN `canales`
-- ---------------------------------------------------------------------
ALTER TABLE canales ADD COLUMN IF NOT EXISTS waba_id TEXT;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS prompt_url TEXT;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS catalogo_hoja TEXT;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE canales ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN canales.identificador IS
  'El phone_number_id de Meta para whatsapp_cloud. Es la llave por la que el webhook reconoce de qué número viene cada mensaje.';
COMMENT ON COLUMN canales.prompt_url IS
  'Doc de Google con la parte del prompt PROPIA de este canal: país, moneda, entrega, saludo. NUNCA reglas de comportamiento — esas van en el prompt común, una sola vez.';
COMMENT ON COLUMN canales.catalogo_hoja IS
  'Pestaña del Sheet de catálogo para este canal. Vacío = la de siempre (Productos).';

-- Buscar el canal por el phone_number_id que manda Meta es lo primero que
-- hace CADA mensaje entrante. Sin índice son 4 filas y da igual; con 40
-- canales y unos miles de mensajes al día, no.
CREATE INDEX IF NOT EXISTS idx_canales_identificador ON canales (identificador);
CREATE INDEX IF NOT EXISTS idx_canales_orden ON canales (orden, id);


-- ---------------------------------------------------------------------
-- 2. RLS: el equipo puede configurar canales, no solo leerlos
--
--    Sigue sin haber nada que proteger aquí más allá de "hay que tener
--    sesión": no hay credenciales. Si algún día se añadiera un campo
--    sensible, esta policy hay que revisarla ANTES.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS equipo_crea_canales  ON canales;
DROP POLICY IF EXISTS equipo_edita_canales ON canales;

CREATE POLICY equipo_crea_canales  ON canales
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_edita_canales ON canales
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- NO se da DELETE a propósito. Borrar un canal dejaría conversaciones
-- colgando de un canal_id que ya no existe. Para retirar uno se usa
-- `activo = false`: las conversaciones se siguen viendo y solo deja de
-- poder enviarse.


-- ---------------------------------------------------------------------
-- 3. REALTIME
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'canales'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE canales;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 4. EL CANAL DE CADA CONVERSACIÓN
--
--    `asegurar_conversacion` es la función que llama el webhook en el
--    primer nodo de cada mensaje. Se le añade el canal, para que el
--    canal_id quede grabado desde el minuto uno y no haya que deducirlo
--    después mirando el texto de `conversaciones.canal`.
--
--    Se mantiene la firma vieja de 3 argumentos: si el flujo se
--    desplegara antes que este SQL, o al revés, ninguno de los dos se
--    rompe. Es la misma precaución que con `fijada`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION asegurar_conversacion(
  p_cliente_id TEXT,
  p_nombre     TEXT DEFAULT NULL,
  p_telefono   TEXT DEFAULT NULL,
  p_canal_id   BIGINT DEFAULT NULL
)
RETURNS conversaciones AS $$
DECLARE
  fila conversaciones;
BEGIN
  INSERT INTO conversaciones (cliente_id, nombre, telefono, canal_id)
  VALUES (p_cliente_id, p_nombre, p_telefono, p_canal_id)
  ON CONFLICT (cliente_id) DO UPDATE
    SET nombre    = COALESCE(EXCLUDED.nombre, conversaciones.nombre),
        telefono  = COALESCE(EXCLUDED.telefono, conversaciones.telefono),
        -- El canal se corrige si llega: un cliente que escribe a otro
        -- número nuestro pasa a esa conversación, no se queda en la vieja.
        canal_id  = COALESCE(EXCLUDED.canal_id, conversaciones.canal_id)
  RETURNING * INTO fila;
  RETURN fila;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- 5. EL CANAL QUE YA EXISTE
--    Se completa con su WABA y se le pone nombre de país, que es como se
--    va a llamar cuando haya cuatro.
-- ---------------------------------------------------------------------
UPDATE canales
SET nombre  = 'México — pruebas',
    waba_id = '1686689748986716',
    orden   = 10
WHERE identificador = '1050242784838044';

UPDATE canales SET orden = 90 WHERE tipo = 'evolution';


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT id, nombre, tipo, identificador, waba_id, pais, activo,
       COALESCE(prompt_url, '(usa el prompt común)') AS prompt,
       COALESCE(catalogo_hoja, '(hoja por defecto)') AS catalogo
FROM canales ORDER BY orden, id;
