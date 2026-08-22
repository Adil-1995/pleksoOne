-- =====================================================================
--  LumaBot — Favoritos, etiquetas, silenciar y bloquear
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================
--
--  QUÉ AÑADE
--    1. conversaciones.favorita     — la estrella
--    4. conversaciones.silenciada   — entra y se guarda, pero María calla
--       conversaciones.bloqueada    — bloqueo real en Meta, el mensaje ni llega
--    2. etiquetas + conversacion_etiquetas — muchos a muchos, con colores
--
--  QUÉ NO AÑADE, A PROPÓSITO
--    Nada de "estado del pedido" ni "pausada": eso ya vive en `pedidos` y en
--    `bot_activo`. Duplicarlo en etiquetas garantiza que un día discrepen.
--    Las etiquetas son para lo que no cabe en ningún otro sitio:
--    reclamación, cliente difícil, pendiente de pago.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CONVERSACIONES: columnas nuevas
-- ---------------------------------------------------------------------
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS favorita   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS silenciada BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS bloqueada  BOOLEAN NOT NULL DEFAULT FALSE;

-- Cuándo se bloqueó y qué dijo Meta. Se guarda porque el bloqueo vive en DOS
-- sitios (aquí y en la Cloud API) y cuando dos sistemas guardan lo mismo,
-- antes o después discrepan. Esto permite ver cuál va retrasado.
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS bloqueada_en TIMESTAMPTZ;
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS bloqueo_nota TEXT;

COMMENT ON COLUMN conversaciones.silenciada IS
  'El mensaje entra y se guarda, pero María no responde y no salta alerta. Reversible en un clic.';
COMMENT ON COLUMN conversaciones.bloqueada IS
  'Bloqueo real en la Cloud API: el mensaje ni llega. Sincronizado con POST/DELETE /{PHONE_ID}/block_users.';
COMMENT ON COLUMN conversaciones.bloqueo_nota IS
  'Última respuesta de Meta al bloquear o desbloquear. Para saber por qué falló sin abrir los logs de n8n.';

-- Índices PARCIALES: los tres campos son casi siempre false, así que solo
-- interesa indexar las filas que valen true. Ocupan casi nada.
CREATE INDEX IF NOT EXISTS idx_conv_favorita   ON conversaciones (ultimo_en DESC) WHERE favorita;
CREATE INDEX IF NOT EXISTS idx_conv_silenciada ON conversaciones (ultimo_en DESC) WHERE silenciada;
CREATE INDEX IF NOT EXISTS idx_conv_bloqueada  ON conversaciones (ultimo_en DESC) WHERE bloqueada;


-- ---------------------------------------------------------------------
-- 2. ETIQUETAS
--
--    El color se guarda como NOMBRE, no como hex. Dos razones:
--    - La paleta queda cerrada de verdad: el CHECK la impone en la base de
--      datos, no solo en el desplegable del frontend.
--    - El mismo nombre puede pintarse distinto en claro y en oscuro. Con un
--      hex fijo, una etiqueta legible en modo oscuro se vuelve ilegible en
--      claro y no hay forma de arreglarlo sin migrar datos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etiquetas (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL,
  color   TEXT NOT NULL
          CHECK (color IN ('rojo','naranja','ambar','verde','turquesa','azul','violeta','rosa','gris')),
  orden   INT  NOT NULL DEFAULT 0,
  creado  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Único sin distinguir mayúsculas: "Reclamación" y "reclamación" son la misma
-- etiqueta, y tener las dos es exactamente igual de inútil que no tener ninguna.
CREATE UNIQUE INDEX IF NOT EXISTS uq_etiquetas_nombre ON etiquetas (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_etiquetas_orden ON etiquetas (orden, id);

CREATE TABLE IF NOT EXISTS conversacion_etiquetas (
  conversacion_id BIGINT NOT NULL REFERENCES conversaciones (id) ON DELETE CASCADE,
  etiqueta_id     BIGINT NOT NULL REFERENCES etiquetas (id)      ON DELETE CASCADE,
  creado          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversacion_id, etiqueta_id)
);

-- La clave primaria ya indexa (conversacion_id, etiqueta_id). Este es el
-- índice del otro lado, que es el que usa el filtro "enséñame las de esta
-- etiqueta".
CREATE INDEX IF NOT EXISTS idx_conv_etq_etiqueta ON conversacion_etiquetas (etiqueta_id);


-- ---------------------------------------------------------------------
-- 3. RLS
--    Mismo criterio que el resto del esquema: el equipo autenticado lo ve y
--    lo toca todo; sin sesión no se ve nada. La service_role de n8n se salta
--    RLS y no necesita ninguna de estas policies.
-- ---------------------------------------------------------------------
ALTER TABLE etiquetas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversacion_etiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_lee_etiquetas   ON etiquetas;
DROP POLICY IF EXISTS equipo_crea_etiquetas  ON etiquetas;
DROP POLICY IF EXISTS equipo_edita_etiquetas ON etiquetas;
DROP POLICY IF EXISTS equipo_borra_etiquetas ON etiquetas;

CREATE POLICY equipo_lee_etiquetas   ON etiquetas FOR SELECT TO authenticated USING (true);
CREATE POLICY equipo_crea_etiquetas  ON etiquetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_edita_etiquetas ON etiquetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY equipo_borra_etiquetas ON etiquetas FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS equipo_lee_conv_etq   ON conversacion_etiquetas;
DROP POLICY IF EXISTS equipo_pone_conv_etq  ON conversacion_etiquetas;
DROP POLICY IF EXISTS equipo_quita_conv_etq ON conversacion_etiquetas;

CREATE POLICY equipo_lee_conv_etq   ON conversacion_etiquetas FOR SELECT TO authenticated USING (true);
CREATE POLICY equipo_pone_conv_etq  ON conversacion_etiquetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY equipo_quita_conv_etq ON conversacion_etiquetas FOR DELETE TO authenticated USING (true);


-- ---------------------------------------------------------------------
-- 4. REALTIME
--    El inbox se entera de los cambios por Realtime. Si estas tablas no
--    están en la publicación, poner una etiqueta desde otro móvil no se ve
--    aquí hasta recargar.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'etiquetas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE etiquetas;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversacion_etiquetas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversacion_etiquetas;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 5. ETIQUETAS DE ARRANQUE
--    Solo si la tabla está vacía, para no resucitar las que borres luego.
--    Son ejemplos de lo que NO cabe en bot_activo ni en pedidos.
-- ---------------------------------------------------------------------
INSERT INTO etiquetas (nombre, color, orden)
SELECT * FROM (VALUES
  ('Reclamación',       'rojo',     10),
  ('Cliente difícil',   'naranja',  20),
  ('Pendiente de pago', 'ambar',    30),
  ('Mayorista',         'violeta',  40),
  ('Seguimiento',       'azul',     50)
) AS v(nombre, color, orden)
WHERE NOT EXISTS (SELECT 1 FROM etiquetas);


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'columnas nuevas' AS que,
       string_agg(column_name, ', ' ORDER BY column_name) AS detalle
FROM information_schema.columns
WHERE table_name = 'conversaciones'
  AND column_name IN ('favorita','silenciada','bloqueada','bloqueada_en','bloqueo_nota')

UNION ALL
SELECT 'etiquetas creadas', string_agg(nombre, ', ' ORDER BY orden) FROM etiquetas

UNION ALL
SELECT 'policies', string_agg(policyname, ', ' ORDER BY policyname)
FROM pg_policies
WHERE tablename IN ('etiquetas','conversacion_etiquetas')

UNION ALL
SELECT 'en realtime', string_agg(tablename, ', ' ORDER BY tablename)
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('etiquetas','conversacion_etiquetas');
