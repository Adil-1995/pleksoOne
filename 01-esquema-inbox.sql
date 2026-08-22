-- =====================================================================
--  LumaBot / Lado Luminoso — Esquema inicial del Inbox
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONVERSACIONES  (una fila por cliente)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversaciones (
  id                 BIGSERIAL PRIMARY KEY,
  cliente_id         TEXT UNIQUE NOT NULL,          -- wa_id de WhatsApp Cloud API
  telefono           TEXT,
  nombre             TEXT,
  ultimo_texto       TEXT,                          -- desnormalizado: la lista se pinta con 1 query
  ultimo_en          TIMESTAMPTZ DEFAULT NOW(),
  ultimo_del_cliente TIMESTAMPTZ,                   -- para calcular la ventana de 24 h
  no_leidos          INT NOT NULL DEFAULT 0,
  bot_activo         BOOLEAN NOT NULL DEFAULT TRUE, -- sustituye al truco de ( y )
  producto_activo    TEXT,                          -- el fix de la v4
  ctwa_clid          TEXT,                          -- atribución Meta CAPI
  ad_id              TEXT,
  creado             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_recientes ON conversaciones (ultimo_en DESC);

-- ---------------------------------------------------------------------
-- 2. MENSAJES  (TODOS los mensajes, entren o salgan, del bot o de un humano)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensajes (
  id            BIGSERIAL PRIMARY KEY,
  cliente_id    TEXT NOT NULL REFERENCES conversaciones(cliente_id) ON DELETE CASCADE,
  direccion     TEXT NOT NULL CHECK (direccion IN ('in','out')),
  autor         TEXT NOT NULL CHECK (autor IN ('cliente','bot','humano','sistema')),
  tipo          TEXT NOT NULL DEFAULT 'text'
                CHECK (tipo IN ('text','image','audio','video','document','location','template','sticker')),
  texto         TEXT,
  media_url     TEXT,
  transcripcion TEXT,                               -- audio ya pasado a texto
  estado        TEXT NOT NULL DEFAULT 'enviado'
                CHECK (estado IN ('pendiente','enviado','entregado','leido','error')),
  msg_id_canal  TEXT,                               -- id de Meta, para deduplicar
  payload       JSONB,                              -- webhook crudo, por si acaso
  creado        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON mensajes (cliente_id, creado DESC);

-- Meta reenvía webhooks. Sin esto verías mensajes duplicados en pantalla.
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_dedup
  ON mensajes (msg_id_canal) WHERE msg_id_canal IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. TRIGGER: mantener la lista de conversaciones al día automáticamente
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_conversacion() RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversaciones SET
    ultimo_texto = COALESCE(NULLIF(NEW.texto,''), '[' || NEW.tipo || ']'),
    ultimo_en    = NEW.creado,
    ultimo_del_cliente = CASE WHEN NEW.direccion = 'in'
                              THEN NEW.creado ELSE ultimo_del_cliente END,
    no_leidos    = CASE WHEN NEW.direccion = 'in'
                        THEN no_leidos + 1 ELSE no_leidos END
  WHERE cliente_id = NEW.cliente_id;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_conversacion ON mensajes;
CREATE TRIGGER trg_tocar_conversacion
AFTER INSERT ON mensajes
FOR EACH ROW EXECUTE FUNCTION tocar_conversacion();

-- ---------------------------------------------------------------------
-- 4. Función de ayuda: crear la conversación si no existe
--    n8n la llama al recibir un mensaje, sin preocuparse de si es nuevo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION asegurar_conversacion(
  p_cliente_id TEXT,
  p_telefono   TEXT DEFAULT NULL,
  p_nombre     TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO conversaciones (cliente_id, telefono, nombre)
  VALUES (p_cliente_id, p_telefono, p_nombre)
  ON CONFLICT (cliente_id) DO UPDATE
    SET nombre   = COALESCE(EXCLUDED.nombre,   conversaciones.nombre),
        telefono = COALESCE(EXCLUDED.telefono, conversaciones.telefono);
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 5. REALTIME  — esto es todo el "tiempo real"
-- ---------------------------------------------------------------------
-- REPLICA IDENTITY FULL hace que los UPDATE lleguen con la fila completa.
-- Sin esto, el toggle del bot no se refleja en las otras pantallas.
ALTER TABLE conversaciones REPLICA IDENTITY FULL;
ALTER TABLE mensajes       REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE mensajes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversaciones;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ---------------------------------------------------------------------
-- 6. SEGURIDAD (RLS)
--    El navegador usa la clave anon + estas políticas.
--    n8n usa la service_role, que se salta RLS. Esa NUNCA va al frontend.
-- ---------------------------------------------------------------------
ALTER TABLE conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_lee_conv    ON conversaciones;
DROP POLICY IF EXISTS equipo_edita_conv  ON conversaciones;
DROP POLICY IF EXISTS equipo_lee_msg     ON mensajes;

-- Cualquier usuario autenticado del equipo ve y edita todo (MVP).
CREATE POLICY equipo_lee_conv   ON conversaciones FOR SELECT TO authenticated USING (true);
CREATE POLICY equipo_edita_conv ON conversaciones FOR UPDATE TO authenticated USING (true);
CREATE POLICY equipo_lee_msg    ON mensajes       FOR SELECT TO authenticated USING (true);

-- OJO: no hay policy de INSERT en mensajes a propósito.
-- El frontend NO escribe mensajes: llama al webhook de n8n y n8n los inserta.
-- Un único punto de salida.

-- ---------------------------------------------------------------------
-- 7. STORAGE para las imágenes
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS media_lectura_publica ON storage.objects;
DROP POLICY IF EXISTS media_subida_equipo   ON storage.objects;

CREATE POLICY media_lectura_publica ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

CREATE POLICY media_subida_equipo ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media');

-- ---------------------------------------------------------------------
-- 8. Datos de prueba, para comprobar que el realtime funciona
-- ---------------------------------------------------------------------
SELECT asegurar_conversacion('5219999999999', '5219999999999', 'Cliente de prueba');

INSERT INTO mensajes (cliente_id, direccion, autor, tipo, texto)
VALUES ('5219999999999', 'in', 'cliente', 'text', 'Hola, ¿cuánto cuesta el cojín?');

-- Debe devolver la conversación con ultimo_texto ya relleno por el trigger:
SELECT cliente_id, nombre, ultimo_texto, no_leidos, bot_activo
FROM conversaciones WHERE cliente_id = '5219999999999';
