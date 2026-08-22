-- =====================================================================
--  LumaBot — Productos por conversación
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
-- =====================================================================
--
--  DOS ESTADOS, NO CUATRO. A propósito.
--
--  `interesado` y `comprado` son los únicos que salen de un evento
--  determinista del flujo:
--    interesado ← "Decidir ficha", que empareja contra las palabras_clave
--                 del catálogo sin pasar por el modelo
--    comprado   ← "Guardar pedido", que solo dispara cuando el flujo
--                 valida el bloque [PEDIDO]
--
--  "negociando" y "descartado" se quedaron fuera porque no hay forma
--  fiable de deducirlos. Lo más parecido que había en el flujo es el nodo
--  `¿Esperando datos?`, que busca TRES cadenas literales dentro del texto
--  libre del modelo ('%para preparar el env%'...). Eso vale para una
--  decisión de un turno, donde fallar cuesta un paso saltado que se
--  corrige solo al mensaje siguiente. Como estado GUARDADO en la ficha de
--  un cliente no vale: el mismo fallo lo aparca en el cajón equivocado
--  para siempre y nadie se entera.
--
--  "frío" tampoco está aquí, y también a propósito: se calcula en el
--  inbox a partir de conversaciones.ultimo_del_cliente. Guardarlo sería
--  mentira al día siguiente.
-- =====================================================================


CREATE TABLE IF NOT EXISTS conversacion_productos (
  id              BIGSERIAL PRIMARY KEY,
  conversacion_id BIGINT NOT NULL REFERENCES conversaciones (id) ON DELETE CASCADE,
  -- El id del catálogo (glowbrush, soporte360, lucessolares, cojinalivia).
  -- Nunca el nombre largo: ese cambia cuando marketing lo retoca y aquí
  -- rompería el histórico.
  producto        TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'interesado'
                  CHECK (estado IN ('interesado','comprado')),
  creado          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversacion_id, producto)
);

COMMENT ON TABLE conversacion_productos IS
  'Qué productos toca cada conversación y en qué punto. Lo rellena el flujo, nunca a mano.';

-- Un cliente puede tener varios productos y sale en todos sus filtros:
-- por eso la unicidad es (conversacion, producto) y no solo conversacion.
CREATE INDEX IF NOT EXISTS idx_cp_producto_estado ON conversacion_productos (producto, estado);
CREATE INDEX IF NOT EXISTS idx_cp_conversacion    ON conversacion_productos (conversacion_id);


-- `actualizado` a mano en cada UPDATE es una promesa que se rompe sola.
CREATE OR REPLACE FUNCTION tocar_conversacion_producto()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tocar_cp ON conversacion_productos;
CREATE TRIGGER trg_tocar_cp
  BEFORE UPDATE ON conversacion_productos
  FOR EACH ROW EXECUTE FUNCTION tocar_conversacion_producto();


-- ---------------------------------------------------------------------
-- RLS. Mismo criterio que el resto: el equipo lo ve todo; sin sesión,
-- nada. La service_role de n8n se salta RLS y no necesita policies.
-- NO hay policy de INSERT ni UPDATE para `authenticated`: esta tabla la
-- rellena el flujo, nunca una persona. Es la regla que pediste, impuesta
-- en la base de datos y no solo en la interfaz.
-- ---------------------------------------------------------------------
ALTER TABLE conversacion_productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipo_lee_conv_prod ON conversacion_productos;
CREATE POLICY equipo_lee_conv_prod ON conversacion_productos
  FOR SELECT TO authenticated USING (true);


-- ---------------------------------------------------------------------
-- Realtime: que marcar un pedido se vea en el inbox sin recargar.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversacion_productos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversacion_productos;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- CARGA INICIAL
--
-- El cruce no se puede hacer en SQL: `fichas_enviadas`, `pedidos` y
-- `alias_lid` viven en el Postgres viejo (appdb) y `conversaciones` aquí.
-- Son dos bases distintas. Así que se resolvió fuera y se emite literal,
-- que además deja ver exactamente qué entra.
--
-- De 1474 filas de fichas_enviadas salen 740 pares únicos (cliente,
-- producto) tras resolver los LIDs contra alias_lid — la misma persona
-- estaba dos veces, con teléfono y con LID. De esos 740, solo 168
-- pertenecen a alguna de las 183 conversaciones del inbox; los otros 572
-- son de clientes sin fila en `conversaciones` y no se pueden colgar de
-- nada. Tampoco se perdería nada: un filtro del inbox solo puede enseñar
-- conversaciones que estén en el inbox.
--
-- El producto de los `comprado` NO sale de pedidos.producto: ese campo lo
-- escribe una regex sobre el texto del modelo y venía sucio en 33 de 40
-- ("... cantidad: 12 precio: $995"). Sale de emparejar contra el catálogo,
-- igual que las fichas.
-- ---------------------------------------------------------------------
INSERT INTO conversacion_productos (conversacion_id, producto, estado) VALUES
  (2, 'glowbrush', 'interesado'),
  (2, 'soporte360', 'interesado'),
  (11, 'lucessolares', 'comprado'),
  (12, 'lucessolares', 'interesado'),
  (13, 'soporte360', 'interesado'),
  (14, 'lucessolares', 'comprado'),
  (15, 'lucessolares', 'interesado'),
  (16, 'lucessolares', 'interesado'),
  (17, 'glowbrush', 'interesado'),
  (17, 'soporte360', 'interesado'),
  (18, 'lucessolares', 'interesado'),
  (19, 'soporte360', 'interesado'),
  (21, 'soporte360', 'interesado'),
  (22, 'soporte360', 'comprado'),
  (23, 'cojinalivia', 'interesado'),
  (24, 'cojinalivia', 'comprado'),
  (25, 'lucessolares', 'interesado'),
  (26, 'lucessolares', 'interesado'),
  (27, 'cojinalivia', 'comprado'),
  (28, 'soporte360', 'interesado'),
  (29, 'lucessolares', 'interesado'),
  (30, 'cojinalivia', 'interesado'),
  (32, 'soporte360', 'comprado'),
  (33, 'cojinalivia', 'interesado'),
  (34, 'soporte360', 'interesado'),
  (35, 'lucessolares', 'comprado'),
  (37, 'lucessolares', 'interesado'),
  (38, 'soporte360', 'interesado'),
  (39, 'soporte360', 'interesado'),
  (40, 'soporte360', 'comprado'),
  (41, 'soporte360', 'interesado'),
  (42, 'soporte360', 'comprado'),
  (43, 'lucessolares', 'interesado'),
  (43, 'soporte360', 'comprado'),
  (44, 'lucessolares', 'interesado'),
  (45, 'glowbrush', 'interesado'),
  (46, 'lucessolares', 'comprado'),
  (47, 'glowbrush', 'interesado'),
  (48, 'lucessolares', 'comprado'),
  (49, 'soporte360', 'interesado'),
  (50, 'soporte360', 'interesado'),
  (51, 'lucessolares', 'interesado'),
  (51, 'soporte360', 'interesado'),
  (52, 'cojinalivia', 'interesado'),
  (53, 'lucessolares', 'interesado'),
  (54, 'cojinalivia', 'interesado'),
  (55, 'soporte360', 'interesado'),
  (56, 'cojinalivia', 'interesado'),
  (57, 'lucessolares', 'interesado'),
  (58, 'soporte360', 'interesado'),
  (59, 'cojinalivia', 'interesado'),
  (60, 'soporte360', 'interesado'),
  (61, 'soporte360', 'interesado'),
  (62, 'soporte360', 'comprado'),
  (63, 'lucessolares', 'interesado'),
  (64, 'lucessolares', 'interesado'),
  (65, 'lucessolares', 'interesado'),
  (66, 'lucessolares', 'interesado'),
  (67, 'soporte360', 'interesado'),
  (68, 'lucessolares', 'interesado'),
  (69, 'lucessolares', 'interesado'),
  (70, 'lucessolares', 'interesado'),
  (71, 'soporte360', 'comprado'),
  (73, 'lucessolares', 'interesado'),
  (73, 'soporte360', 'comprado'),
  (74, 'cojinalivia', 'interesado'),
  (74, 'soporte360', 'interesado'),
  (76, 'lucessolares', 'comprado'),
  (78, 'soporte360', 'interesado'),
  (79, 'lucessolares', 'interesado'),
  (81, 'lucessolares', 'interesado'),
  (82, 'cojinalivia', 'interesado'),
  (83, 'soporte360', 'comprado'),
  (84, 'soporte360', 'interesado'),
  (85, 'lucessolares', 'interesado'),
  (86, 'soporte360', 'interesado'),
  (87, 'lucessolares', 'interesado'),
  (88, 'lucessolares', 'interesado'),
  (89, 'lucessolares', 'interesado'),
  (91, 'cojinalivia', 'interesado'),
  (92, 'soporte360', 'interesado'),
  (94, 'soporte360', 'interesado'),
  (95, 'lucessolares', 'interesado'),
  (96, 'soporte360', 'interesado'),
  (97, 'soporte360', 'comprado'),
  (98, 'soporte360', 'interesado'),
  (99, 'lucessolares', 'interesado'),
  (100, 'lucessolares', 'comprado'),
  (101, 'soporte360', 'interesado'),
  (102, 'cojinalivia', 'interesado'),
  (103, 'soporte360', 'interesado'),
  (104, 'lucessolares', 'interesado'),
  (105, 'lucessolares', 'comprado'),
  (106, 'soporte360', 'interesado'),
  (107, 'lucessolares', 'interesado'),
  (108, 'soporte360', 'interesado'),
  (109, 'lucessolares', 'interesado'),
  (110, 'lucessolares', 'interesado'),
  (111, 'lucessolares', 'interesado'),
  (112, 'cojinalivia', 'comprado'),
  (114, 'lucessolares', 'interesado'),
  (115, 'cojinalivia', 'interesado'),
  (116, 'glowbrush', 'interesado'),
  (117, 'lucessolares', 'interesado'),
  (118, 'lucessolares', 'comprado'),
  (119, 'lucessolares', 'interesado'),
  (120, 'soporte360', 'interesado'),
  (122, 'lucessolares', 'comprado'),
  (123, 'lucessolares', 'interesado'),
  (124, 'lucessolares', 'interesado'),
  (125, 'cojinalivia', 'interesado'),
  (126, 'lucessolares', 'comprado'),
  (127, 'lucessolares', 'comprado'),
  (127, 'soporte360', 'interesado'),
  (128, 'soporte360', 'interesado'),
  (129, 'lucessolares', 'interesado'),
  (130, 'cojinalivia', 'interesado'),
  (131, 'cojinalivia', 'interesado'),
  (132, 'lucessolares', 'interesado'),
  (133, 'lucessolares', 'comprado'),
  (134, 'cojinalivia', 'interesado'),
  (135, 'soporte360', 'interesado'),
  (136, 'lucessolares', 'interesado'),
  (137, 'lucessolares', 'interesado'),
  (138, 'lucessolares', 'interesado'),
  (139, 'lucessolares', 'comprado'),
  (140, 'lucessolares', 'interesado'),
  (142, 'soporte360', 'interesado'),
  (143, 'lucessolares', 'interesado'),
  (144, 'cojinalivia', 'interesado'),
  (145, 'soporte360', 'interesado'),
  (146, 'cojinalivia', 'comprado'),
  (147, 'soporte360', 'interesado'),
  (148, 'lucessolares', 'interesado'),
  (149, 'soporte360', 'interesado'),
  (150, 'soporte360', 'interesado'),
  (152, 'lucessolares', 'interesado'),
  (152, 'soporte360', 'interesado'),
  (154, 'lucessolares', 'interesado'),
  (156, 'lucessolares', 'comprado'),
  (157, 'lucessolares', 'interesado'),
  (158, 'lucessolares', 'interesado'),
  (159, 'soporte360', 'comprado'),
  (160, 'soporte360', 'interesado'),
  (161, 'soporte360', 'comprado'),
  (162, 'lucessolares', 'interesado'),
  (163, 'lucessolares', 'interesado'),
  (163, 'soporte360', 'comprado'),
  (164, 'lucessolares', 'interesado'),
  (165, 'lucessolares', 'comprado'),
  (166, 'cojinalivia', 'comprado'),
  (167, 'soporte360', 'interesado'),
  (168, 'lucessolares', 'interesado'),
  (169, 'cojinalivia', 'comprado'),
  (170, 'cojinalivia', 'interesado'),
  (171, 'lucessolares', 'comprado'),
  (172, 'soporte360', 'interesado'),
  (173, 'lucessolares', 'interesado'),
  (174, 'soporte360', 'interesado'),
  (175, 'soporte360', 'interesado'),
  (176, 'cojinalivia', 'interesado'),
  (178, 'lucessolares', 'interesado'),
  (179, 'lucessolares', 'interesado'),
  (180, 'lucessolares', 'interesado'),
  (183, 'soporte360', 'interesado'),
  (184, 'lucessolares', 'interesado'),
  (185, 'lucessolares', 'comprado'),
  (186, 'soporte360', 'interesado'),
  (187, 'cojinalivia', 'interesado'),
  (188, 'cojinalivia', 'interesado'),
  (189, 'soporte360', 'comprado'),
  (190, 'lucessolares', 'comprado')
ON CONFLICT (conversacion_id, producto) DO NOTHING;


-- ---------------------------------------------------------------------
-- conversaciones.producto_activo
--
-- Se leía en cuatro sitios y no se escribía en ninguno: siempre null. Y
-- los cuatro eran pass-through — nadie decidía nada con él. Ya he quitado
-- las lecturas del flujo y del inbox.
--
-- La columna la dejo en pie: borrar columnas es tuyo, no mío. Cuando
-- quieras, descomenta. `conversacion_productos` ya dice lo mismo y mejor,
-- porque distingue producto por producto en vez de guardar solo el último.
--
--   ALTER TABLE conversaciones DROP COLUMN IF EXISTS producto_activo;
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'filas por estado' AS que, estado AS detalle, count(*)::text AS valor
FROM conversacion_productos GROUP BY estado

UNION ALL
SELECT 'filas por producto', producto, count(*)::text
FROM conversacion_productos GROUP BY producto

UNION ALL
SELECT 'total', '', count(*)::text FROM conversacion_productos

UNION ALL
SELECT 'conversaciones con productos', '', count(DISTINCT conversacion_id)::text
FROM conversacion_productos

UNION ALL
SELECT 'con más de un producto', '', count(*)::text FROM (
  SELECT conversacion_id FROM conversacion_productos
  GROUP BY conversacion_id HAVING count(*) > 1
) t;
