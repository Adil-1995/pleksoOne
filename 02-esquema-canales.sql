-- =====================================================================
--  LumaBot / Lado Luminoso — Fase 4, paso 1
--  Canales, adjuntos y suscripciones push.
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================
--
--  REGLA DE ORO de este esquema:
--  el frontend NUNCA pregunta "¿esto es WhatsApp?". Pregunta por
--  CAPACIDADES: ¿soporta media? ¿cuántas horas dura la ventana?
--  Añadir Instagram mañana tiene que ser INSERT INTO canales, nada más.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CANALES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canales (
  id                 BIGSERIAL PRIMARY KEY,
  tipo               TEXT NOT NULL,           -- whatsapp_cloud | instagram | messenger | evolution
  identificador      TEXT NOT NULL,           -- phone_number_id, page_id... lo que identifique el canal
  nombre             TEXT NOT NULL,           -- lo que ve el equipo: "WhatsApp Pruebas"
  pais               TEXT,                    -- MX, ES...
  ventana_horas      INT  NOT NULL DEFAULT 24,-- 0 = sin ventana. WhatsApp 24, Instagram 24, email 0
  soporta_media      BOOLEAN NOT NULL DEFAULT TRUE,
  soporta_plantillas BOOLEAN NOT NULL DEFAULT FALSE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  creado             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo, identificador)
);

COMMENT ON COLUMN canales.ventana_horas IS
  'Horas que dura la ventana de servicio. 0 = sin límite. El frontend avisa cuando quedan <2h.';

-- El número de pruebas que ya está en producción.
INSERT INTO canales (tipo, identificador, nombre, pais, ventana_horas,
                     soporta_media, soporta_plantillas, activo)
VALUES ('whatsapp_cloud', '1050242784838044', 'WhatsApp Pruebas', 'MX', 24, TRUE, TRUE, TRUE)
ON CONFLICT (tipo, identificador) DO UPDATE
  SET nombre = EXCLUDED.nombre, activo = EXCLUDED.activo;


-- ---------------------------------------------------------------------
-- 2. conversaciones.canal_id
--    El campo `canal` (texto) NO se borra: sigue siendo la regla 4 y
--    n8n lo escribe. canal_id es la versión normalizada para el inbox.
-- ---------------------------------------------------------------------
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS canal_id BIGINT REFERENCES canales(id);

-- Rellenar las existentes emparejando por el texto del campo viejo.
-- Las 180 migradas de Evolution no tienen canal WhatsApp Cloud propio,
-- así que se crea una fila de canal para ellas y así ninguna queda huérfana.
INSERT INTO canales (tipo, identificador, nombre, pais, ventana_horas,
                     soporta_media, soporta_plantillas, activo)
VALUES ('evolution', 'plekso', 'Evolution (retirado)', 'MX', 0, TRUE, FALSE, FALSE)
ON CONFLICT (tipo, identificador) DO NOTHING;

UPDATE conversaciones c
SET canal_id = ca.id
FROM canales ca
WHERE c.canal_id IS NULL
  AND ca.tipo = c.canal;

-- Red de seguridad: lo que no haya emparejado va al canal de pruebas,
-- para que NINGUNA conversación quede sin canal.
UPDATE conversaciones
SET canal_id = (SELECT id FROM canales
                WHERE tipo = 'whatsapp_cloud' AND identificador = '1050242784838044')
WHERE canal_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_canal ON conversaciones (canal_id);


-- ---------------------------------------------------------------------
-- 3. ADJUNTOS
--    Un mensaje puede tener varios. La transcripción vive aquí, no en
--    mensajes, porque es del audio concreto.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adjuntos (
  id            BIGSERIAL PRIMARY KEY,
  mensaje_id    BIGINT NOT NULL REFERENCES mensajes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL
                CHECK (tipo IN ('image','audio','video','document','sticker')),
  storage_path  TEXT NOT NULL,          -- ruta dentro del bucket, NO la URL completa
  tamano        BIGINT,                 -- bytes
  duracion      INT,                    -- segundos, solo audio y vídeo
  transcripcion TEXT,                   -- audio ya pasado a texto (Fase 5)
  miniatura     TEXT,                   -- storage_path de la miniatura
  creado        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adj_mensaje ON adjuntos (mensaje_id);


-- ---------------------------------------------------------------------
-- 4. PUSH_SUSCRIPCIONES
--    Vacía por ahora: las push se harán con Capacitor, no con Web Push.
--    La tabla se crea ya para no volver a tocar el esquema después.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_suscripciones (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  claves     JSONB NOT NULL,            -- {p256dh, auth} en web; token FCM/APNs en Capacitor
  creado     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, endpoint)
);


-- ---------------------------------------------------------------------
-- 5. REALTIME para las tablas nuevas que el inbox necesita ver
-- ---------------------------------------------------------------------
ALTER TABLE adjuntos REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE adjuntos;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;


-- ---------------------------------------------------------------------
-- 6. RLS en las tres
-- ---------------------------------------------------------------------
ALTER TABLE canales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjuntos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_suscripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_lee_canales  ON canales;
DROP POLICY IF EXISTS equipo_lee_adjuntos ON adjuntos;
DROP POLICY IF EXISTS push_propias_lee    ON push_suscripciones;
DROP POLICY IF EXISTS push_propias_crea   ON push_suscripciones;
DROP POLICY IF EXISTS push_propias_borra  ON push_suscripciones;

-- Canales: el equipo los lee. Escribirlos es tarea de administración (service_role).
CREATE POLICY equipo_lee_canales ON canales
  FOR SELECT TO authenticated USING (true);

-- Adjuntos: solo lectura desde el navegador. Los crea n8n al recibir media.
CREATE POLICY equipo_lee_adjuntos ON adjuntos
  FOR SELECT TO authenticated USING (true);

-- Push: cada usuario gestiona SOLO las suyas. Aquí sí hay dueño.
CREATE POLICY push_propias_lee ON push_suscripciones
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());
CREATE POLICY push_propias_crea ON push_suscripciones
  FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());
CREATE POLICY push_propias_borra ON push_suscripciones
  FOR DELETE TO authenticated USING (usuario_id = auth.uid());


-- ---------------------------------------------------------------------
-- 7. COMPROBACIONES — mira esta salida antes de dar el paso por bueno
-- ---------------------------------------------------------------------
SELECT '1. canales dados de alta' AS comprobacion;
SELECT id, tipo, identificador, nombre, pais, ventana_horas,
       soporta_media, soporta_plantillas, activo
FROM canales ORDER BY id;

SELECT '2. conversaciones por canal (NINGUNA puede quedar sin canal)' AS comprobacion;
SELECT COALESCE(ca.nombre, '### SIN CANAL ###') AS canal,
       COUNT(*) AS conversaciones
FROM conversaciones c
LEFT JOIN canales ca ON ca.id = c.canal_id
GROUP BY 1 ORDER BY 2 DESC;

SELECT '3. huérfanas (tiene que dar 0)' AS comprobacion;
SELECT COUNT(*) AS sin_canal FROM conversaciones WHERE canal_id IS NULL;

SELECT '4. tablas nuevas y su RLS' AS comprobacion;
SELECT tablename, rowsecurity AS rls_activo
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('canales','adjuntos','push_suscripciones')
ORDER BY tablename;
