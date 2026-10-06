# Borrador interno de privacidad — DocenteTuc 1.1

**No publicar todavía.** Este borrador corresponde a la futura cuenta opcional Google de DocenteTuc 1.1. No reemplaza ni modifica la política pública vigente de DocenteTuc 1.0.

## Cuenta y datos de Google previstos

Si el usuario decide “Continuar con Google”, DocenteTuc usa OAuth/OIDC para verificar la identidad de la cuenta. La solicitud está limitada a `openid` y `email`; no solicita acceso a Gmail, Drive, Calendar, contactos ni otros servicios de Google. El sistema prevé guardar en Cloudflare D1:

- un identificador interno aleatorio de DocenteTuc;
- el email de Google, que se mantiene privado y se usa para la cuenta y el vínculo de inicio de sesión;
- la relación con el identificador de sujeto de Google;
- sesiones y vencimientos necesarios para mantener el acceso.

DocenteTuc no necesita conservar el nombre, foto, access token, refresh token ni ID token de Google; la configuración de 1.1 evita solicitar perfil y descarta los campos de tokens durante la persistencia. El endpoint público de estado de cuenta no devuelve email ni ID.

## Almacenamiento y seguridad previstos

Los datos de autenticación se alojarán en D1 de Cloudflare junto con la infraestructura de la aplicación. Las sesiones previstas son de siete días, con cookie `HttpOnly`, `SameSite=Lax`, `Secure` por HTTPS, host-only; el logout invalida la fila de sesión. Better Auth valida origen/CSRF y estado OAuth/PKCE. La configuración todavía no tiene credenciales, D1 no recibió las tablas de autenticación y no hay login en producción; estas medidas describen el diseño preparado, no un servicio activo.

Las funciones educativas actuales continúan disponibles sin iniciar sesión y siguen usando el mecanismo de instalación previo. El UUID del dispositivo no se trata como una cuenta autenticada. No se trasladan automáticamente datos educativos existentes a una cuenta Google.

## Separación y exposición

Cuenta, perfil docente privado de personalización y perfil público son datos distintos. La cuenta Google no hace público el email ni el perfil privado. El perfil público (`displayName`, `avatarId`, `bio`) se guarda bajo el identificador interno DocenteTuc autenticado. No hay todavía comunidad, publicaciones, mensajería o intercambio social habilitados.

## Eliminación y retención

En `develop/1.1` el flujo autenticado exige escribir `ELIMINAR` y elimina la identidad y sesiones DocenteTuc, perfiles privado/público, preferencias, guardados, agenda/eventos, seguimientos, recordatorios, notificaciones, suscripciones y preferencias push, entregas asociadas, límites técnicos y datos de instalaciones que esa cuenta vinculó. Expira la sesión y limpia la copia local del dispositivo actual. No elimina la cuenta Google, registros de infraestructura de Cloudflare, contenido de fuentes oficiales ni copias locales de otros dispositivos. Comunidad todavía no existe; antes de habilitarla, sus publicaciones/respuestas/reacciones propias deberán agregarse expresamente a este borrado por `user.id`. El procedimiento de DocenteTuc 1.0 permanece sin cambios.

Antes de publicar esta política habrá que confirmar los plazos reales de retención y respaldos de Cloudflare, documentar canales de soporte, verificar el dominio propio y hacer que las declaraciones coincidan con el comportamiento desplegado y Google Play Data Safety.
