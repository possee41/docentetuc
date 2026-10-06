# DocenteTuc 1.1 — Comunidad Fase 3A

## Alcance

Base local de Comunidad para publicaciones y comentarios de texto, sin multimedia, archivos, mensajes privados ni respuestas anidadas. El acceso de prueba es `/comunidad`; no es el feed final.

Las escrituras requieren sesión Better Auth validada por el servidor, perfil público válido (`displayName` y `avatarId`) y aceptación exacta de `COMMUNITY_RULES_VERSION`. La autoría siempre se toma de `user.id` de esa sesión. El cuerpo JSON solo acepta el campo `text` en contenido; `userId` y UUID de dispositivo no se usan como identidad.

## Migración y operación local

`migrations/0015_community.sql` es aditiva y posterior a `0014`. Para esta fase debe aplicarse únicamente mediante Wrangler en modo local/de prueba. No ejecutar `--remote`, no desplegar y no aplicar la migración a la D1 de producción.

La API falla cerrada con 503 si no encuentra todas las tablas de Comunidad. No se habilita la función por la mera presencia de la ruta.

## Esquema

- `community_rules_acceptances`: versión y hora de aceptación por cuenta.
- `community_posts`: texto, autor, timestamps y estado visible/oculto/retirado.
- `community_comments`: comentarios directos de un post, sin `parent_comment_id`.
- `community_reports`: motivos predefinidos y estado de revisión; índices únicos parciales impiden que una cuenta reporte dos veces el mismo post o comentario.
- `community_blocks`: bloqueo bilateral para filtrar publicaciones/comentarios en lecturas.
- `community_moderators`: lista privada de cuentas habilitadas manualmente fuera de la API pública.
- `community_moderation_events`: acción/razón/fecha interna; no conserva copias del contenido. Tras la purga de 90 días, se dejan nulas las referencias al objetivo y se retiene solo esta auditoría mínima.
- `community_rate_limits`: ventanas horarias por cuenta y operación.

## Endpoints

- `GET /api/community/posts`: estado de sesión/perfil/aceptación y hasta 50 publicaciones visibles; responde solo campos del perfil público.
- `POST /api/community/rules`: registra aceptación explícita de la versión vigente.
- `POST /api/community/posts`: crea publicación de hasta 2.000 caracteres.
- `PATCH|DELETE /api/community/posts/:postId`: edita o elimina solo si la sesión es autora.
- `GET|POST /api/community/posts/:postId/comments`: lista o crea comentarios directos de hasta 1.000 caracteres.
- `PATCH|DELETE /api/community/comments/:commentId`: modifica o elimina solo si la sesión es autora.
- `POST /api/community/reports`: reporta post/comentario con motivo predefinido.
- `GET|POST /api/community/blocks`, `DELETE /api/community/blocks/:blockId`: administra bloqueos propios; el ID de cuenta bloqueada no se devuelve.
- `GET|POST /api/community/moderation`: cola y acciones internas, solo para una cuenta en `community_moderators`; no existe autoalta pública ni panel administrativo.

Todas las mutaciones verifican `Origin` same-origin. Los cuerpos JSON se limitan a 12 KiB; textos vacíos o por encima del máximo se rechazan. Límites atómicos del servidor por hora UTC: 5 publicaciones, 30 comentarios y 10 reportes por cuenta.

Los reportes no ocultan automáticamente contenido. Moderación admite ocultar/restaurar/retirar. `hide` conserva el texto interno para revisión; `remove` reemplaza el texto por una marca de retiro, sin snapshot. Las lecturas públicas solo incluyen estado `visible`. El cron del Worker ejecuta la purga cada cinco minutos: el texto ocultado o retirado se elimina al cumplir 90 días desde la última acción que lo ocultó/retiró. Al restaurar contenido se limpia el contador de retención; una moderación posterior inicia un nuevo plazo. También se eliminan comentarios/reportes vinculados al objetivo purgado. La auditoría de moderación se conserva con acción, motivo, fecha y actor mientras esa cuenta exista, pero sin IDs de contenido; al eliminar la cuenta del moderador, el actor se anonimiza.

## Alta y baja segura de moderadores

Solo una cuenta DocenteTuc previamente autorizada por el administrador puede agregarse a `community_moderators`. No hay endpoint público, pantalla de autoalta ni rol enviado por el navegador. La autorización se comprueba en servidor contra la sesión Better Auth y la tabla privada en cada consulta/acción de moderación.

Procedimiento operativo (a ejecutar por una persona con acceso administrativo a D1, nunca desde la interfaz de usuario):

1. Confirmar fuera de la aplicación la autorización explícita y la cuenta DocenteTuc exacta. Resolver su `user.id` desde una sesión autenticada, sin copiar email a Comunidad ni usar UUID de dispositivo.
2. Revisar el destino de Wrangler y seleccionar explícitamente la base correcta. En desarrollo usar solo `--local`; antes de una eventual operación remota, revisar el nombre/ID de D1 y obtener aprobación operativa independiente.
3. Agregar solo el UUID verificado: `INSERT INTO community_moderators(user_id) VALUES ('<user.id verificado>');`.
4. Para revocar, comprobar el UUID y ejecutar `DELETE FROM community_moderators WHERE user_id='<user.id verificado>';`. Conservar el registro mínimo de acciones previas; la eliminación de la cuenta anula el actor.
5. Verificar el resultado con una consulta de existencia que no publique el listado ni lo exponga por API.

Nunca otorgar moderación por el primer usuario, dominio de email, datos del frontend o UUID de instalación. No almacenar credenciales en el repositorio ni registrar el email en auditoría.

## Eliminación de cuenta

`accountDataDeletionStatements` contempla explícitamente los datos de Comunidad. Al eliminar la cuenta:

1. Se eliminan publicaciones y comentarios de su autor; al borrarse el post, también se borran sus comentarios, reportes dirigidos a ese contenido y eventos de moderación ligados al objetivo.
2. Se eliminan reportes presentados por esa cuenta, bloqueos en cualquiera de las dos direcciones, aceptación de normas, límites de tasa y su pertenencia a moderadores.
3. En eventos de moderación que todavía correspondan a contenido de otras cuentas, `actor_user_id` pasa a `NULL`; quedan únicamente acción/razón/fecha sin vínculo reconstruible con la cuenta eliminada.
4. Se eliminan perfil público, perfil privado, sesiones, cuenta OAuth y usuario DocenteTuc conforme al flujo existente. No se elimina la cuenta Google.

No se guardan emails, UUID de dispositivo ni identificadores de usuario en la respuesta pública de Comunidad. El ID interno del autor no se envía al navegador.

## Límites antes de habilitar producción

No hay despliegue ni migración remota en esta fase. Antes de producción debe prepararse el procedimiento de respuesta a reportes y ejecutarse una revisión de seguridad del acceso a D1/moderadores. La API de moderación deniega a todas las cuentas salvo las habilitadas explícitamente en la tabla privada.
