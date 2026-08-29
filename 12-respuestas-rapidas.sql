-- =====================================================================
--  LumaBot — Respuestas rápidas (los comandos de «/»)
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================
--
--  QUÉ AÑADE
--    respuestas_rapidas — atajo corto + texto. Se escribe «/» en el campo
--    de mensaje, sale la lista, se elige una y el texto SE INSERTA para
--    poder editarlo antes de mandarlo.
--
--  QUÉ NO AÑADE, A PROPÓSITO
--    Nada de variables tipo {{nombre}} ni adjuntos. Una respuesta rápida
--    es texto que se pega y se edita. En cuanto admite plantillas hay que
--    decidir qué pasa si la variable no existe, y eso es otro encargo.
--
--    Tampoco se guarda en el navegador. El encargo era verlo igual desde
--    el móvil y desde el PC: en localStorage cada aparato tendría su
--    propia lista y nadie se enteraría de que discrepan.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LA TABLA
--
--    `atajo` se guarda SIN la barra. La barra es cómo se invoca, no parte
--    del nombre: guardarla obligaría a limpiarla en cada comparación y un
--    día alguien crearía «//envio» sin darse cuenta.
--
--    `creado_por` queda registrado aunque la respuesta sea del equipo.
--    Saber quién escribió una plantilla que se manda a clientes reales
--    vale para preguntarle, no para restringir.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS respuestas_rapidas (
  id          BIGSERIAL PRIMARY KEY,
  atajo       TEXT NOT NULL,
  texto       TEXT NOT NULL,
  orden       INT  NOT NULL DEFAULT 0,
  creado_por  UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  creado      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sin espacios y sin barras: el filtro de «/» corta por el primer
  -- espacio, así que un atajo con espacio sería imposible de escribir. Se
  -- impone aquí y no en el formulario porque el SQL Editor también escribe
  -- en esta tabla y no pasa por el formulario.
  CONSTRAINT atajo_de_una_pieza CHECK (atajo ~ '^[^[:space:]/]{1,24}$'),
  CONSTRAINT texto_no_vacio     CHECK (length(btrim(texto)) > 0)
);

-- Único sin distinguir mayúsculas, igual que `etiquetas`: «/Envio» y
-- «/envio» son el mismo comando, y tener los dos es peor que no tener
-- ninguno, porque el desplegable enseñaría dos filas idénticas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_respuestas_atajo
  ON respuestas_rapidas (lower(atajo));

-- El orden de la lista. No hay índice para buscar por atajo a propósito:
-- son decenas de filas, se cargan enteras una vez y el filtrado del
-- desplegable se hace en memoria mientras escribes. Un índice ahí no se
-- usaría nunca.
CREATE INDEX IF NOT EXISTS idx_respuestas_orden
  ON respuestas_rapidas (orden, id);

COMMENT ON TABLE respuestas_rapidas IS
  'Respuestas guardadas del equipo. Se invocan con «/» en el campo de mensaje. El texto se INSERTA para poder editarlo, nunca se envía solo.';
COMMENT ON COLUMN respuestas_rapidas.atajo IS
  'Sin la barra: se guarda «envio», se escribe «/envio». Sin espacios ni barras, lo impone un CHECK.';
COMMENT ON COLUMN respuestas_rapidas.creado_por IS
  'Quién la creó. NULL = no se pudo saber. Lo escribe un trigger desde auth.uid(), nunca el navegador. Es informativo: no restringe quién puede editarla.';


-- ---------------------------------------------------------------------
-- 2. QUIÉN Y CUÁNDO, PUESTO POR LA BASE
--
--    Mismo patrón que `tocar_marca_revision`: sale de auth.uid(), no de lo
--    que mande el cliente. Si lo mandara el navegador, cualquiera podría
--    decir que la escribió otro.
--
--    Diferencia con aquel: en UPDATE se CONSERVA el autor original.
--    Editarle el texto a una respuesta del equipo no te convierte en su
--    autor, y si se reescribiera se perdería a quién preguntar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_respuesta_rapida()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creado_por = auth.uid();
  ELSE
    NEW.creado_por = OLD.creado_por;
    NEW.creado     = OLD.creado;
  END IF;
  NEW.actualizado = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_respuesta ON respuestas_rapidas;
CREATE TRIGGER trg_tocar_respuesta
  BEFORE INSERT OR UPDATE ON respuestas_rapidas
  FOR EACH ROW EXECUTE FUNCTION tocar_respuesta_rapida();


-- ---------------------------------------------------------------------
-- 3. RLS — COMPARTIDAS POR TODO EL EQUIPO
--
--    Igual que `etiquetas` y `marcas_revision`: quien entra al inbox ve y
--    edita las de todos. El motivo es el mismo que el de la marca de
--    revisión: dos personas atendiendo el mismo WhatsApp tienen que
--    contestar lo mismo. Una lista privada por usuario garantiza que la
--    dirección de devoluciones se corrija en un sitio y no en el otro.
--
--    Si algún día hacen falta privadas, se añade una columna `privada` y
--    se cambia el USING. No hay que migrar datos: las de hoy siguen
--    siendo del equipo.
--
--    La service_role se salta esto. n8n no escribe aquí ni debe: estas
--    respuestas las manda una persona a mano.
-- ---------------------------------------------------------------------
ALTER TABLE respuestas_rapidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_ve_respuestas    ON respuestas_rapidas;
DROP POLICY IF EXISTS equipo_crea_respuestas  ON respuestas_rapidas;
DROP POLICY IF EXISTS equipo_edita_respuestas ON respuestas_rapidas;
DROP POLICY IF EXISTS equipo_borra_respuestas ON respuestas_rapidas;

CREATE POLICY equipo_ve_respuestas    ON respuestas_rapidas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY equipo_crea_respuestas  ON respuestas_rapidas
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_edita_respuestas ON respuestas_rapidas
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY equipo_borra_respuestas ON respuestas_rapidas
  FOR DELETE TO authenticated USING (true);


-- ---------------------------------------------------------------------
-- 4. REALTIME
--
--    Mismo motivo que la marca de revisión: «verlo igual desde el móvil y
--    desde el PC». Si creas una respuesta en el PC y el móvil no se entera
--    hasta recargar, escribes «/envio» en el móvil y no sale nada.
--
--    El IF evita el error 42710 al volver a ejecutar el fichero.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'respuestas_rapidas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE respuestas_rapidas;
  END IF;
END $$;

-- Para que el DELETE de Realtime traiga la fila vieja y el frontend sepa
-- cuál quitar de la lista. Sin esto, `payload.old` llega solo con el id.
ALTER TABLE respuestas_rapidas REPLICA IDENTITY FULL;


-- ---------------------------------------------------------------------
-- 5. UNAS CUANTAS PARA EMPEZAR
--
--    ON CONFLICT contra el índice de lower(atajo): volver a ejecutar el
--    fichero no duplica ni pisa lo que hayas editado a mano.
--    Bórralas sin miedo si no te sirven; son un ejemplo, no un dato.
-- ---------------------------------------------------------------------
INSERT INTO respuestas_rapidas (atajo, texto, orden) VALUES
  ('envio',
   'El envío es GRATIS a todo México y llega en 2 a 6 días. Se paga en efectivo al recibir 😊',
   10),
  ('datos',
   E'Para preparar el envío necesito:\n\nNombre y apellido\nCalle y número exterior\nEntre calles\nColonia\nMunicipio o alcaldía\nEstado\nCódigo postal de 5 dígitos\nUna referencia cercana',
   20),
  ('pago',
   'Se paga en efectivo al recibir el paquete, directamente al repartidor. No hay que adelantar nada 😊',
   30),
  ('gracias',
   '¡Gracias por su compra! 😊 En cuanto salga su paquete le confirmamos por aquí.',
   40)
ON CONFLICT (lower(atajo)) DO NOTHING;


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'tabla creada' AS que,
       (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'respuestas_rapidas') AS valor

UNION ALL
SELECT 'atajo único sin distinguir mayúsculas',
       (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'respuestas_rapidas' AND indexname = 'uq_respuestas_atajo')

UNION ALL
SELECT 'policies',
       (SELECT string_agg(cmd, ', ' ORDER BY cmd)
        FROM pg_policies WHERE tablename = 'respuestas_rapidas')

UNION ALL
SELECT 'en la publicación de Realtime',
       (SELECT count(*)::text FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'respuestas_rapidas')

UNION ALL
SELECT 'respuestas guardadas',
       (SELECT count(*)::text FROM respuestas_rapidas);
