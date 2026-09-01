-- =====================================================================
--  LumaBot — Cerrar el LISTADO del bucket público «media»
--  Pegar entero en el SQL Editor de Supabase y pulsar Run. Idempotente.
--
--  🔴 URGENTE. Esto no es una mejora, es una fuga abierta ahora mismo.
-- =====================================================================
--
--  LA FUGA
--    El bucket `media` es público, y además su LISTADO está abierto a
--    `anon`. La anon key va dentro del bundle del inbox, así que la lee
--    cualquiera que abra el inspector en inbox.ladoluminoso.com.
--
--    Comprobado contra la API el 1/9/2026, no deducido:
--
--      POST /storage/v1/object/list/media   {"prefix":"salientes"}
--      con la anon key  ->  200, 26 carpetas
--
--    Y cada carpeta ES un número de teléfono de un cliente real
--    (`salientes/{cliente_id}/...`, ver subirMedia() en lib/envio.ts).
--    O sea: 26 teléfonos de clientes, listables por cualquiera, con sus
--    ficheros descargables detrás. Eso son datos personales.
--
--  QUÉ ARREGLA ESTO Y QUÉ NO
--    Cierra el LISTADO. NO hace privado el bucket: quien conozca la URL
--    exacta de un fichero lo seguirá pudiendo descargar.
--
--    Eso es a propósito, y es lo que permite que este fichero sea urgente
--    y seguro a la vez: hacer el bucket privado rompería el envío a
--    WhatsApp, porque `Construir mensaje Cloud API` manda `{link: url}` y
--    son los SERVIDORES DE META los que descargan esa URL, sin
--    credenciales. Arreglar eso de verdad obliga a tocar el subflujo
--    `CYgKApb26ARGlhVZ` con un PUT — justo lo que lo despublica y deja
--    /webhook/wa-cloud-multi en 404 sin un error en el log. Eso va en su
--    propia tanda (ver el apunte al final).
--
--    Sin listado, para llegar a un fichero hay que acertar la ruta entera:
--    el número del cliente, el sello de tiempo en milisegundos y el nombre
--    original. Ya no se pueden cosechar.
--
--  POR QUÉ ESTO NO ROMPE NADA. Comprobado, no supuesto:
--
--    1. La descarga pública NO pasa por RLS. Con CERO cabeceras:
--         GET /storage/v1/object/public/media/salientes/...jpg
--         -> 200, 304643 bytes
--       Ni apikey ni policy. Meta sigue pudiendo bajar los ficheros
--       exactamente igual después de ejecutar esto.
--
--    2. NADIE lista el bucket. `grep -rn "\.list("` sobre inbox/src y
--       sobre workflows/*.json no devuelve un solo uso.
--
--    3. n8n usa la service_role, que se salta RLS entera. No le afecta.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ANTES: qué hay puesto ahora mismo
--
--    Mira esta salida antes de seguir. Es lo que el paso 2 va a cambiar.
-- ---------------------------------------------------------------------
SELECT 'ANTES' AS cuando, policyname, cmd, roles::text, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;


-- ---------------------------------------------------------------------
-- 2. QUITAR EL LISTADO ANÓNIMO SOBRE «media»
--
--    Se hace con un DO y no con un DROP POLICY a pelo porque NO sabemos
--    cómo se llama la policy: no se puede leer pg_policies de Supabase
--    Cloud desde fuera del SQL Editor, así que el nombre exacto solo se
--    ve al ejecutar esto. Buscarla por lo que HACE en vez de por cómo se
--    llama es además lo correcto: si mañana alguien crea otra igual con
--    otro nombre, este fichero la vuelve a cerrar.
--
--    EL FILTRO ES DELIBERADAMENTE ESTRECHO. Solo cae una policy si:
--      - es de SELECT (o ALL, que incluye SELECT),
--      - se la dan a `anon` o a `public` (que abarca a anon),
--      - y su USING nombra EXACTAMENTE el bucket 'media'.
--
--    Ese último punto es el que protege `wa_media_lee_equipo`: su USING
--    dice 'media-whatsapp'::text, que no casa con el patrón de 'media'::text.
--    Sin esa precisión, cerrar esto dejaría al inbox sin poder firmar las
--    URLs de los audios y las fotos de los clientes, y el hilo se quedaría
--    con «No se puede leer el fichero» en cada adjunto entrante.
--
--    Lo que NO toca: las de INSERT (`media_subida_equipo`,
--    `wa_media_sube_equipo`), que son las que dejan al equipo subir.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  p           RECORD;
  quitadas    INT := 0;
  sospechosas INT := 0;
BEGIN
  FOR p IN
    SELECT policyname, cmd, roles::text[] AS roles, qual
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles::text[] && ARRAY['anon', 'public'])
  LOOP
    IF p.qual LIKE '%''media''::text%' THEN
      RAISE NOTICE 'QUITANDO  %  (cmd=%, roles=%)', p.policyname, p.cmd, p.roles;
      EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
      quitadas := quitadas + 1;

    ELSIF p.qual IS NULL OR p.qual = 'true' THEN
      -- Una policy sin bucket en el USING deja abierto TODO, incluido el
      -- bucket privado de lo que mandan los clientes. Es más grave que lo
      -- que viene a arreglar este fichero, pero NO se toca sola: borrarla
      -- a ciegas podría dejar al inbox sin leer nada. Que la mire una
      -- persona.
      RAISE WARNING 'REVISAR A MANO: la policy "%" da SELECT a % sobre TODOS los buckets (USING: %). No se ha tocado.',
        p.policyname, p.roles, coalesce(p.qual, 'sin USING');
      sospechosas := sospechosas + 1;

    ELSE
      RAISE NOTICE 'se deja  %  (no es del bucket media: %)', p.policyname, p.qual;
    END IF;
  END LOOP;

  RAISE NOTICE '--- policies quitadas: %  ·  a revisar a mano: % ---', quitadas, sospechosas;

  IF quitadas = 0 AND sospechosas = 0 THEN
    RAISE NOTICE 'Ninguna policy encajaba. Si el listado SIGUE abierto, mira la salida del paso 1: el permiso viene de otro sitio y hay que verlo a ojo.';
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 3. DESPUÉS: qué ha quedado
--
--    Tienen que seguir estando, sí o sí:
--      wa_media_lee_equipo    SELECT  {authenticated}  media-whatsapp
--      wa_media_sube_equipo   INSERT  {authenticated}
--      media_subida_equipo    INSERT  ...
-- ---------------------------------------------------------------------
SELECT 'DESPUES' AS cuando, policyname, cmd, roles::text, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;


-- =====================================================================
--  CÓMO SE COMPRUEBA QUE HA FUNCIONADO
--  No te fíes de que el Run salga en verde: esto se prueba desde fuera.
--
--  1) El listado tiene que MORIR. Con la anon key, en una terminal:
--
--     curl -s -o /dev/null -w "%{http_code}\n" -X POST \
--       "https://kiiiwtuwuauhomadmplv.supabase.co/storage/v1/object/list/media" \
--       -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
--       -H "Content-Type: application/json" -d '{"prefix":"salientes","limit":100}'
--
--     ANTES: 200 y 26 carpetas.  DESPUÉS: 400/403, o 200 con lista VACÍA
--     (RLS oculta las filas en vez de dar un 403 — ver 03-storage-media.sql).
--     Las dos cosas valen: lo que no puede pasar es que sigan saliendo
--     números de teléfono.
--
--  2) La descarga tiene que SEGUIR VIVA, que es lo que usa Meta:
--
--     curl -s -o /dev/null -w "%{http_code}\n" \
--       "https://kiiiwtuwuauhomadmplv.supabase.co/storage/v1/object/public/media/salientes/12247332443/1788118542679-oferta_Luces.jpg"
--
--     Tiene que dar 200. Si da 400, algo se ha llevado por delante el
--     acceso público y el envío de imágenes a clientes está roto: vuelve
--     a crear la policy que el paso 2 haya quitado (sale por NOTICE).
--
--  3) En el inbox, abre una conversación con un audio o una foto DE UN
--     CLIENTE y comprueba que se sigue oyendo/viendo. Eso prueba que
--     `wa_media_lee_equipo` ha sobrevivido.
-- =====================================================================


-- =====================================================================
--  LO QUE ESTO NO ARREGLA, APUNTADO PARA SU PROPIA TANDA
--
--  El bucket `media` sigue siendo PÚBLICO. Cerrarlo del todo obliga a que
--  el envío deje de depender de una URL que Meta pueda bajar, y la vía
--  buena NO es firmar la URL: es subir el fichero a Meta con
--      POST /{PHONE_ID}/media
--  y mandar `{"id": "<media_id>"}` en vez de `{"link": "<url>"}`.
--
--  Además de permitir el bucket privado, eso elimina de golpe toda la
--  clase de fallos «Meta no pudo descargar la URL», que hoy solo se ven
--  como un envío fallido sin explicación.
--
--  Es una tanda para ella sola porque toca `CYgKApb26ARGlhVZ` (el subflujo
--  de salida) con un PUT, y eso lo despublica en cascada. Orden obligatorio
--  al hacerlo, del CLAUDE.md:
--    1. POST /api/v1/workflows/CYgKApb26ARGlhVZ/activate   ← el subflujo
--    2. POST /api/v1/workflows/qx1O54zpuyxzfW8V/activate   ← quien lo llama
--    3. Comprobar el challenge de verdad, sin fiarse del 200 del activate.
--
--  Y arrastra dos cosas más que hay que hacer en la misma tanda:
--    - `adjuntos.miniatura` guarda la URL pública ENTERA como texto y
--      `Burbuja` la usa directa como `poster`, sin pasar por
--      useUrlFirmada. Con el bucket privado esas filas quedan en 404 para
--      siempre y los pósters de los vídeos ya enviados se ponen negros.
--      Hace falta migrarlas a rutas.
--    - La regla de caché del PWA (vite.config.ts) casa contra
--      /storage/v1/object/public/.* . Una URL firmada va por /object/sign/
--      con token cambiante: deja de casar y cada imagen se vuelve a
--      descargar en cada apertura.
-- =====================================================================
