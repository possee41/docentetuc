# DocenteTuc 1.1 — Identidad, vinculación y eliminación

Estado del código en `develop/1.1`: OAuth Google usa Better Auth y conserva la cookie del estado OAuth durante 10 minutos, con test de regresión. La vinculación y eliminación autenticadas están implementadas en código y cubiertas con SQLite en memoria. Las migraciones 0013/0014 no se aplicaron a D1 de producción; cualquier preparación de despliegue requiere una fase autorizada aparte.

## Identidad y sesión

- La identidad estable es el `user.id` UUID que Better Auth valida desde la cookie de sesión HttpOnly en D1. Los endpoints no aceptan `userId` o `accountId` del cuerpo.
- `X-DocenteTuc-Device` identifica una instalación heredada, pero nunca autentica una cuenta. Para una instalación asociada, la aplicación exige además la sesión de la cuenta propietaria; otra cuenta o una sesión ausente reciben rechazo.
- Una instalación no vinculada continúa usando su espacio local legado hasta que el usuario confirma explícitamente la vinculación. “Continuar sin vincular” no modifica D1.
- La mutación de vinculación exige sesión válida, origen same-origin, UUID válido y `{ consent: true }`. Una clave única por instalación impide vincularla dos veces a otra cuenta; un reintento de la misma cuenta es idempotente.

## Vinculación de datos

La migración aditiva 0014 crea `account_installations(device_id, source_user_id, account_id, linked_at)` y una clave foránea a `user.id` con borrado en cascada. La vinculación copia a la clave de la cuenta el perfil privado y preferencias, perfil público (solo `displayName`, `avatarId`, `bio`), guardados/agenda/seguimientos, notificaciones, recordatorios, eventos, preferencias push y suscripciones push. Las publicaciones oficiales compartidas no se copian.

Los guardados se fusionan por `(user_id, publication_id)`; notas distintas se preservan juntas, flags de agenda/seguimiento se combinan y los recordatorios/notificaciones duplicados usan claves idempotentes. El seguimiento de designaciones evita una segunda fila para la misma publicación. Para preferencias de perfil/push, si la cuenta ya tenía una fila, prevalece su fila; la fila original de instalación se conserva como respaldo hasta que el titular elimine la cuenta. Las filas de origen no se borran durante la vinculación; la tabla de propiedad impide que se vuelvan a asociar a otra cuenta. El borrado autenticado incluye las claves de cuenta y todas sus instalaciones vinculadas.

El preview de la UI solo comunica si existen datos personalizables; no devuelve valores privados ni cuenta datos públicos sincronizados. Un perfil vacío creado por la carga normal de la aplicación no dispara un aviso de migración.

## Perfil público

`public_profiles` se guarda y consulta usando `user.id` validado. El payload público sigue limitado a nombre visible, avatar permitido (`avatar_01`–`avatar_24`) y biografía. No incluye email, identificador Google, perfil docente privado ni datos de sesión. No existe endpoint público de comunidad habilitado en esta fase.

## Eliminación de cuenta DocenteTuc

El usuario autenticado confirma escribiendo `ELIMINAR`. La operación same-origin borra de D1 la cuenta e identidad DocenteTuc, relaciones de autenticación y sesiones, filas de perfil privado/público, preferencias, guardados, agenda/eventos, seguimientos, recordatorios, notificaciones, suscripciones/preferencias push, entregas asociadas, límites técnicos y filas heredadas de todas las instalaciones enlazadas. Better Auth expira la cookie de sesión; el cliente limpia su copia local y suscripción push en el dispositivo actual.

No se borra la cuenta Google, publicaciones o documentos de fuentes oficiales, datos de otros usuarios, retención de infraestructura externa ni copias locales en otros dispositivos. Comunidad todavía no existe; antes de habilitarla, cada tabla de publicaciones/respuestas/reacciones propias debe quedar ligada a `user.id` y agregarse explícitamente a la rutina de borrado autenticado. Las pruebas destructivas del plan de borrado usan únicamente SQLite en memoria.

## Alcance y pendientes antes de Comunidad

- La migración 0014 es aditiva y todavía no fue ejecutada en ningún D1 de producción.
- Los tests de base usan SQLite en memoria: no prueban la integración operativa contra un D1 remoto ni sustituyen una futura prueba local con Wrangler.
- No están implementadas Comunidad, Threads, publicaciones, comentarios, likes, chat ni migración de UUID fuera del consentimiento definido aquí.
- Revisar texto público/Data Safety y retención real antes de desplegar esta identidad en producción. No se generaron APK/AAB ni se cambió versión Android.
