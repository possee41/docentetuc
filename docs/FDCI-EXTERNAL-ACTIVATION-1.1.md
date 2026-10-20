# FDCI externo 1.1: primera importación controlada (pendiente de autorización)

Este documento prepara la activación; **ningún paso remoto se ejecutó**. La rama predeterminada verificada de `possee41/docentetuc` es `fix/navigation-community-1.1`. La web y Android continúan en el Worker principal `docentetuc`; el receptor es otro Worker.

## Archivos y recursos

- Receptor: `workers/fdci-receiver.mjs`, configurado por `wrangler.fdci-receiver-production.jsonc` como `docentetuc-fdci-receiver-1-1`.
- Único binding: `DB` → `docentetuc-db` (`baaf5886-0123-4948-96da-aa7106424549`). Sin assets, rutas de dominio ni cron. No importar el paquete web/Next.js.
- Worker principal: `app/api/sync/route.ts` omite únicamente el recolector y las tareas auxiliares FDCI cuando `FDCI_SYNC_MODE=external`. Las demás fuentes conservan el flujo anterior. La candidata deja `FDCI_SYNC_MODE=legacy` en `wrangler.cloudflare.jsonc`, por lo que el flujo actual permanece hasta una activación separada y autorizada.
- Ejecutor: `scripts/import-fdci.mjs` con `lib/fdci-import.ts` y sus dependencias existentes. La ejecución manual exige token, slug e ID de **una** comisión pública; consulta los dos listados públicos una vez y `getCupo` solo para ese curso. No recorre detalles de otros cursos ni reconcilia ausencias.
- No se necesita `0023` ni otra migración: el receptor usa `publications` y `sync_state` existentes. No aplica ni modifica `0021`/`0022`.

## Separación de GitHub

El archivo de workflow debe incorporarse **solo** a la rama predeterminada para que aparezca en `workflow_dispatch`; no fusionar la rama experimental original ni el hotfix 1102 allí. Esta candidata limpia parte del commit 1.1 `a1cdd56bdc59a487aa026ee49ec1cff62c675edb`. Antes de publicar, revisar la lista exacta de archivos y el diff. La ruta web `app/api/internal/fdci-import/route.ts`, `lib/fdci-import-store.ts`, benchmarks/probes y configuraciones canary **no están incluidos**. `cloudflare-env.d.ts` solo declara `FDCI_SYNC_MODE` para el Worker principal; no declara un secreto de recepción. El workflow usa `FDCI_IMPORT_REF`, un SHA completo de la revisión aprobada del ejecutor: no ejecuta el HEAD experimental de la rama predeterminada.

El workflow es manual, tiene `contents: read`, checkout sin credenciales persistentes, grupo de concurrencia único y environment `fdci-import`. Configurar en ese environment aprobación manual y restringir la revisión autorizada según las opciones de GitHub disponibles. No configurar `schedule` todavía.

Variables del environment: `FDCI_IMPORT_REF` (SHA aprobado) y `FDCI_IMPORT_URL` (URL HTTPS completa `https://<host-del-receptor>/api/internal/fdci-import`). Secreto del environment: `FDCI_IMPORT_SECRET`. El mismo valor se cargaría **solo** como secreto `FDCI_IMPORT_SECRET` del Worker receptor. Debe ser exclusivo de este canal; no reutilizar secretos de la aplicación. No guardar el valor en Git, documentación, variables públicas, argumentos de comandos ni logs. No se creó ningún secreto en esta preparación.

## Secuencia futura, solo tras autorización

1. Registrar versión activa del Worker principal y su configuración para rollback. Revisar que la revisión FDCI contiene únicamente los archivos aprobados, ejecuta tests/build y que el binding del receptor apunta exactamente a la D1 prevista. No ejecutar migraciones.
2. Publicar el receptor separado primero, inicialmente sin secreto (responde 503); comprobar configuración, versión y que no tiene cron, rutas ni assets. Cargar después el secreto exclusivo y verificar que una petición sin autorización responde 401. No enviar publicaciones todavía.
3. En una revisión/deploy coordinado posterior, cambiar **solo** `FDCI_SYNC_MODE` de `legacy` a `external` en la configuración del Worker principal y publicar esa versión; comprobar bindings, cron y resto de fuentes. Verificar que el recolector FDCI anterior no inicia y que no queda una ejecución anterior en curso antes de importar.
4. Incorporar el workflow manual a la rama predeterminada sin fusionar otros cambios. Fijar `FDCI_IMPORT_REF` al commit aprobado, `FDCI_IMPORT_URL` al receptor y proteger el environment. Antes de ejecutarlo, abrir la fuente oficial y elegir una comisión **vigente en ese momento**, verificando manualmente su token, slug, ID y fechas; no reutilizar automáticamente una comisión histórica de prueba. Hacer una única ejecución manual con esos tres datos públicos. El script valida los campos, prepara únicamente esa comisión y envía un lote de uno. El resultado informa cursos candidatos, creadas, actualizadas y sin cambios; los errores se registran sin URL ni secreto.
5. Verificar con **consultas SELECT puntuales previamente autorizadas** la publicación por ID, su URL oficial, fechas y estado, y que los históricos permanecen. Comprobar en «Todas» de Capacitaciones y revisar CPU, consultas/filas D1 y errores del receptor. No presentar la fuente como sincronizada por completo: la ejecución acotada no envía `complete`.
6. Si falla, detener nuevas importaciones. Deshabilitar el secreto del receptor y/o restaurar las versiones Worker registradas según el punto de fallo, sin restaurar ni modificar D1. Los UPSERT idempotentes ya confirmados permanecen; no eliminar publicaciones. Un reintento de la misma comisión no duplica filas.

## Límites que siguen pendientes

El canary midió 2 ms de CPU para una nueva, 4 ms para cinco y 1 ms para un lote repetido; **no prueba por sí solo** la CPU del Worker con la D1 productiva. La primera operación real debe observarse y detenerse si se aproxima al límite gratuito. El receptor no calcula compatibilidad, avisos, recordatorios ni push; su equivalencia funcional requiere una etapa separada. La ejecución inicial no es un barrido completo ni actualiza el último éxito global de FDCI. Tampoco se activan horarios automáticos hasta verificar importación, coste y notificaciones por separado.
