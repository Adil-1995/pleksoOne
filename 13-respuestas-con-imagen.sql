-- =====================================================================
--  LumaBot — Imágenes en las respuestas rápidas
--  Pegar entero en el SQL Editor de Supabase y pulsar Run.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
--
--  Continúa 12-respuestas-rapidas.sql. NO borra ni reescribe nada de lo
--  que ya hay: las respuestas de hoy siguen exactamente igual, solo que
--  ahora pueden llevar una imagen además del texto.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LAS COLUMNAS
--
--    Se guarda la RUTA del Storage, no la URL.
--
--    La URL pública lleva dentro el dominio del proyecto
--    (kiiiwtuwuauhomadmplv.supabase.co). Guardarla ataría cada fila a este
--    proyecto concreto: el día que se restaure un backup en otro, o que
--    cambie el dominio, todas las imágenes apuntarían a un sitio que ya no
--    existe y no habría forma de recomponerlas. La ruta —
--    «respuestas/1787391234-ficha.jpg» — sobrevive a las dos cosas, y la
--    URL se calcula en el momento con getPublicUrl().
--
--    Es además lo que ya hace `adjuntos.storage_path`: mismo criterio en
--    las dos tablas, para no tener que recordar cuál guarda qué.
--
--    UNA sola imagen por respuesta, no varias. Una respuesta rápida es lo
--    que escribes una y otra vez; en cuanto admite un álbum hay que decidir
--    en qué orden se insertan, qué pasa si el canal solo deja mandar una, y
--    eso es otro encargo. Si algún día hacen falta varias, se añade una
--    tabla `respuesta_adjuntos` y estas columnas se migran a ella.
-- ---------------------------------------------------------------------
ALTER TABLE respuestas_rapidas
  ADD COLUMN IF NOT EXISTS imagen_path   TEXT,
  ADD COLUMN IF NOT EXISTS imagen_nombre TEXT,
  ADD COLUMN IF NOT EXISTS imagen_tamano INTEGER;

COMMENT ON COLUMN respuestas_rapidas.imagen_path IS
  'Ruta dentro del bucket «media», NO la URL. Ej: respuestas/1787391234-ficha.jpg. La URL se calcula con getPublicUrl(). NULL = respuesta solo de texto.';
COMMENT ON COLUMN respuestas_rapidas.imagen_nombre IS
  'Nombre real del fichero, para enseñarlo en Ajustes y como nombre al reenviarlo.';
COMMENT ON COLUMN respuestas_rapidas.imagen_tamano IS
  'Bytes. Informativo: sirve para avisar en Ajustes de que una imagen es enorme antes de que alguien la mande.';


-- ---------------------------------------------------------------------
-- 2. UNA RESPUESTA VACÍA NO PUEDE EXISTIR
--
--    Hasta ahora `texto_no_vacio` exigía texto siempre. Con imágenes eso
--    deja de valer: una respuesta que es SOLO una foto —la ficha del
--    producto, el mapa de la zona de reparto— es perfectamente legítima.
--
--    Pero relajarlo a secas dejaría crear filas completamente vacías, que
--    saldrían en el desplegable de «/» como una línea en blanco que al
--    elegirla no hace nada. Así que la regla nueva es: texto O imagen, al
--    menos una de las dos.
--
--    `texto` se queda NOT NULL a propósito, con cadena vacía cuando solo
--    hay imagen. Hacerlo nullable obligaría a comprobar el null en cada
--    sitio del frontend que hoy lee `r.texto` dando por hecho que es una
--    cadena, y no gana nada: '' y NULL significan lo mismo aquí.
--
--    El CHECK de la ruta evita el caso tonto pero real de guardar '' en
--    imagen_path: la fila diría que tiene imagen, getPublicUrl() devolvería
--    una URL sin fichero y en el desplegable saldría un hueco roto.
-- ---------------------------------------------------------------------
ALTER TABLE respuestas_rapidas DROP CONSTRAINT IF EXISTS texto_no_vacio;
ALTER TABLE respuestas_rapidas DROP CONSTRAINT IF EXISTS contenido_no_vacio;
ALTER TABLE respuestas_rapidas DROP CONSTRAINT IF EXISTS imagen_path_no_vacia;

ALTER TABLE respuestas_rapidas
  ADD CONSTRAINT contenido_no_vacio
  CHECK (length(btrim(texto)) > 0 OR imagen_path IS NOT NULL);

ALTER TABLE respuestas_rapidas
  ADD CONSTRAINT imagen_path_no_vacia
  CHECK (imagen_path IS NULL OR length(btrim(imagen_path)) > 0);


-- ---------------------------------------------------------------------
-- 3. DÓNDE VIVEN LOS FICHEROS
--
--    En el bucket «media», bajo el prefijo «respuestas/». Es el MISMO
--    bucket que ya usa el compositor para lo que se envía (ver subirMedia()
--    en inbox/src/lib/envio.ts), y no uno nuevo, por dos motivos:
--
--      - Es público. Tiene que serlo: cuando se manda una imagen, n8n le
--        pasa a Meta una URL y son los servidores de Meta los que la
--        descargan. Una URL firmada caduca y un bucket privado le daría un
--        403 a Meta.
--      - Ya tiene sus policies puestas y probadas. Un bucket nuevo
--        significa policies nuevas, y una policy de Storage mal puesta
--        falla con «Object not found» en vez de con un 403 — o sea, en
--        silencio y pareciendo otra cosa (ver 03-storage-media.sql).
--
--    OJO CON QUÉ SE SUBE AQUÍ: al ser público, cualquiera con la URL exacta
--    ve el fichero. Para las fichas de producto y los mapas de reparto, que
--    es para lo que esto se pide, da igual — son material comercial. No
--    subas aquí nada de un cliente.
--
--    ESTE FICHERO NO CREA NI TOCA NINGUNA POLICY DE STORAGE. La
--    comprobación de abajo dice si hacen falta; si sale vacía, mira el
--    bloque comentado del final.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------
SELECT 'columnas nuevas' AS que,
       (SELECT string_agg(column_name, ', ' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_name = 'respuestas_rapidas'
          AND column_name LIKE 'imagen_%') AS valor

UNION ALL
SELECT 'restricciones de contenido',
       (SELECT string_agg(conname, ', ' ORDER BY conname)
        FROM pg_constraint
        WHERE conrelid = 'respuestas_rapidas'::regclass AND contype = 'c')

UNION ALL
SELECT 'respuestas que ya tienen imagen',
       (SELECT count(*)::text FROM respuestas_rapidas WHERE imagen_path IS NOT NULL)

UNION ALL
SELECT 'bucket media: ¿es público?',
       (SELECT coalesce(max(public::text), 'NO EXISTE EL BUCKET')
        FROM storage.buckets WHERE id = 'media')

UNION ALL
-- Si esta fila sale VACÍA, el equipo no puede subir ficheros al bucket y
-- hay que descomentar el bloque de abajo. Si trae policies, no toques nada.
SELECT 'policies de subida sobre storage.objects',
       (SELECT string_agg(policyname, ', ' ORDER BY policyname)
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT');


-- ---------------------------------------------------------------------
-- SOLO SI LA COMPROBACIÓN DE ARRIBA DICE QUE FALTAN POLICIES
--
--    Descomenta y ejecuta esto ÚNICAMENTE si la última fila salió vacía o
--    si subir una imagen desde Ajustes da un error de permisos. Añadir una
--    policy de más no rompe nada (se suman, no se pisan), pero tener dos
--    haciendo lo mismo confunde al siguiente que lo mire.
-- ---------------------------------------------------------------------
-- DROP POLICY IF EXISTS media_lee_todos    ON storage.objects;
-- DROP POLICY IF EXISTS media_sube_equipo  ON storage.objects;
--
-- -- Leer: público, porque los servidores de Meta descargan la imagen sin
-- -- sesión ninguna cuando se la mandamos a un cliente.
-- CREATE POLICY media_lee_todos ON storage.objects
--   FOR SELECT TO public
--   USING (bucket_id = 'media');
--
-- -- Subir: solo el equipo autenticado.
-- CREATE POLICY media_sube_equipo ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'media');
--
-- -- Borrar: para poder quitar la imagen vieja al cambiarla y no ir dejando
-- -- ficheros huérfanos en el bucket para siempre.
-- CREATE POLICY media_borra_equipo ON storage.objects
--   FOR DELETE TO authenticated
--   USING (bucket_id = 'media');
