# Google Play — preparación de Seguridad de los datos (DocenteTuc 1.1)

Estado: inventario técnico preliminar revisado contra el código el 6 de octubre de 2026. **No es una declaración aprobada para Play Console.** Los elementos externos y el artefacto Android requieren verificación antes de responder el formulario. Las categorías siguientes son candidatas para revisar, no respuestas legales definitivas.

## CONFIRMADO POR CÓDIGO

### Cuenta DocenteTuc y Google

- La autenticación usa Google OAuth/OpenID Connect con los scopes `openid`, `email` y `profile`. La app no solicita la contraseña Google ni permisos para Gmail, Drive, Calendar, contactos, ubicación o la biblioteca de fotos.
- Google puede proporcionar identificador de proveedor, correo, verificación del correo y datos básicos de perfil, como nombre e imagen. Better Auth guarda de forma privada el correo, estado de verificación, nombre, URL de imagen, identificador de cuenta del proveedor e identificador interno DocenteTuc.
- La URL de imagen Google se devuelve solamente en el estado autenticado del propio usuario, con validación de host HTTPS de Google. Comunidad usa el `avatarId` y el nombre/bio elegidos en Perfil público; no usa la foto privada Google.
- Los tokens OAuth de acceso/renovación/identidad se procesan durante el flujo. Los hooks de persistencia los dejan nulos antes de guardar o actualizar la cuenta. La contraseña Google nunca pasa por DocenteTuc. La sesión DocenteTuc tiene un token opaco validado por el servidor; el navegador lo recibe en cookie `HttpOnly`, no en JSON. La ruta pública de Better Auth permite solo inicio social Google por redirección, callback, cierre de sesión y error; rechaza `get-session`, `list-sessions`, `get-access-token` y el inicio directo mediante `idToken`, que podrían devolver tokens en JSON. La interfaz consulta `/api/auth/status`, que devuelve únicamente configuración, estado autenticado, nombre e imagen privados de la cuenta actual.
- La sesión guarda vencimiento y puede guardar IP y agente de usuario. El código fija sesiones de siete días y cookies `SameSite=Lax`; HTTPS activa `Secure`.

### Instalación y vinculación

- En una instalación nueva, el servidor crea el identificador aleatorio y una credencial de posesión de 256 bits. El identificador queda en `localStorage`; el secreto solo viaja en cookies `HttpOnly`, `SameSite=Lax`, limitadas a rutas de cuenta/datos/instalación, nunca a rutas de Comunidad. D1 almacena únicamente el SHA-256 del secreto, no el secreto.
- Para credenciales nuevas, las APIs de datos comprueban la cookie además del identificador. La vinculación requiere sesión autenticada, consentimiento explícito, prueba válida de la instalación y comprobaciones de conflictos. En la base se copia/mezcla el perfil privado, perfil público, guardados, agenda, seguimiento, recordatorios y preferencias/subscripciones contempladas por el servicio.
- Si se elimina una cuenta desde su instalación actual con credencial válida, también se eliminan los datos no vinculados de esa instalación; la interfaz limpia su ID/caché solo si el servidor confirma ese alcance. Una cuenta no puede eliminar datos de otra instalación indicando solamente un UUID.
- **Limitación heredada:** instalaciones con datos anteriores y sin credencial no reciben una nueva automáticamente. El UUID histórico no demuestra posesión de forma criptográfica; esos datos siguen funcionando de manera compatible, pero no se vinculan ni eliminan basándose solo en el ID. Se remiten a soporte.
- Si la cookie de una instalación nueva se pierde, la prueba deja de estar disponible. La eliminación de cuenta puede borrar la cuenta pero conservar esos datos separados, mantener el ID local y mostrar un resultado parcial; soporte es el mecanismo de recuperación. La persona también puede borrar sus datos desde esa instalación con la credencial presente, sin iniciar sesión con Google.

### Datos personales y actividad

| Candidato de categoría Play | Datos y uso confirmados | Destino / estado de eliminación |
|---|---|---|
| Información personal | Correo, nombre e imagen de cuenta Google; nombre y preferencias del Perfil docente privado. Personalización y cuenta. | Servidor DocenteTuc/Cloudflare y copia local de datos de la aplicación. Se borran por cuenta cuando están dentro del alcance autenticado; revisar la limitación de instalación no vinculada. |
| Identificadores de usuario/dispositivo | Identificador Google interno, identidad DocenteTuc, identificador aleatorio de instalación, hash de la credencial de instalación y datos técnicos de límites/entrega. | Servidor y almacenamiento local/cookies HttpOnly. La credencial original no se guarda en D1; las instalaciones heredadas sin credencial permanecen sujetas al bloqueo documentado arriba. |
| Fotos | URL de la foto de perfil Google, privada; no hay acceso a álbumes/fotos del teléfono. | Perfil de cuenta privado. La foto no se publica en Comunidad. |
| Contenido creado por usuarios / actividad en la app | Perfil público elegido; publicaciones y comentarios de texto; búsquedas/consultas enviadas a IA; guardados, agenda, eventos, notas, seguimientos y recordatorios. | Servicio DocenteTuc/Cloudflare. Comunidad muestra solo perfil público y contenido visible. Guardadas no es un “Me gusta” y no muestra contador ni quién guardó. |
| Reportes, bloqueos y moderación | Motivo de reporte, contenido señalado, bloqueos, aceptación de normas y metadatos de moderación. | Servidor DocenteTuc. Moderación ve lo necesario para revisar el contenido, no cuenta Google ni Perfil docente privado. Texto oculto se purga a los 90 días; al retirar definitivamente se reemplaza el texto inmediatamente. La auditoría de contenido eliminado se desvincula de la cuenta al eliminarla. |
| Notificaciones / otros identificadores | Si se activa push: endpoint, claves de cifrado de suscripción, preferencias, vencimiento y agente de usuario limitado; avisos y metadatos de entrega. | Cloudflare y el servicio push del navegador/dispositivo. Desactivar push vuelve inactiva la suscripción, no borra automáticamente el registro histórico. Proveedor y retención externa pendientes. |
| Mensajes / contenido enviado a IA | Consulta actual, hasta seis mensajes recientes y contexto pertinente. El Perfil docente solo se usa cuando la persona activa esa opción; agenda y seguimiento se incluyen según la consulta. | El servidor lo envía al proveedor IA configurado. DocenteTuc no guarda historial de conversación en D1; existe caché temporal de algunas respuestas genéricas. El proveedor puede aplicar sus propias prácticas. |
| Ubicación | Clima usa coordenadas fijas de Tucumán; la app no solicita GPS. | Open-Meteo recibe la petición directa y puede procesar IP/metadatos de conexión. No se confirma que Open-Meteo o DocenteTuc infieran la ubicación de la persona. Evaluar la categoría de ubicación aproximada solo si se confirma tal inferencia/uso. |
| Diagnóstico y rendimiento | El código mantiene contadores técnicos de límites y metadatos de entrega; no se encontró un historial de chats ni SDK propio de anuncios/analítica. | Cloudflare y servicios externos pueden generar logs cuya configuración y retención no se deducen del código. Pendiente de verificación externa. |

Perfil docente es privado y se usa para filtros/matching. Perfil público es separado y solo incluye nombre visible, avatar seleccionado y bio opcional. Cuenta Google es identidad y sesión; su correo, ID e imagen privada no aparecen en las respuestas públicas de Comunidad.

### Servicios y transferencias

- Cloudflare aloja la aplicación/Worker y la base de datos.
- Google se usa para inicio de sesión básico, no para acceder a otros productos Google.
- El código admite Gemini u OpenAI como proveedor IA. El archivo Worker declara Gemini y el modelo `gemini-3.5-flash-lite`, pero el proveedor/clave realmente activos en producción no se comprobaron.
- Open-Meteo recibe la solicitud meteorológica desde el navegador, con ubicación fija; las fuentes educativas externas reciben la navegación cuando se abren sus enlaces.
- El servicio push depende del navegador/dispositivo. No se pudo fijar un único proveedor ni confirmar sus prácticas externas.
- El código no permite concluir si una transferencia a cada proveedor se clasifica como “compartir” según Google Play. No declarar “no compartido” sin revisar contratos, finalidades y excepciones aplicables.

## PENDIENTE DE VERIFICACIÓN

1. **Instalaciones heredadas:** no existe prueba criptográfica retroactiva. Mantener sus datos separados y ofrecer soporte; verificar el procedimiento operativo de soporte y decidir una política de retención para filas huérfanas.
2. **Pérdida de credencial nueva:** si se borran cookies del navegador antes de borrar los datos, la app no puede acreditar posesión. Confirmar el procedimiento de recuperación/soporte y la retención de estos casos antes de declarar eliminación integral.
3. **Dominio OAuth de producción.** El código exige `BETTER_AUTH_URL` como origen HTTPS, sin ruta, y rechaza `workers.dev`/`pages.dev` en runtime de producción. El dominio propio verificado no está definido en este repositorio. No cambiar esta protección ni asumir que producción fue comprobada.
4. Confirmar URL, proveedor/modelo y secretos de ejecución en el Worker publicado sin revelar valores; verificar redirecciones OAuth y configuración del cliente en Google Cloud.
5. Confirmar tratamiento, subprocesadores y conservación de datos por Cloudflare, Google, proveedor IA, Open-Meteo, navegador/servicio push y soporte por correo; incluir logs de acceso/errores.
6. Revisar las categorías exactas de Play para información personal, identificadores, fotos, contenido de usuarios/mensajes, actividad y, condicionalmente, ubicación aproximada. Confirmar si los proveedores cuentan como procesadores de servicio o como intercambio sujeto a declarar.
7. Revisar el APK/AAB y SDK/TWA finales. Este documento no inspecciona el artefacto de publicación ni sustituye la revisión de la consola.
8. Confirmar que la página web pública de eliminación y el flujo desde la app funcionen desde el dominio que se elegirá para producción.

## OAuth: URL pública aún no decidida

`lib/auth-config.ts` acepta en producción solo una URL base HTTPS que contenga el origen, sin ruta/query/fragmento, y rechaza cualquier host terminado en `.workers.dev` o `.pages.dev`. El código espera ese mismo origen para `baseURL` y `trustedOrigins`.

Better Auth no requiere por sí mismo que el dominio esté registrado a nombre de DocenteTuc: forma la redirección desde `BETTER_AUTH_URL` y usa `/api/auth/callback/google`. Google sí exige que las URI/orígenes sean exactos y que se utilicen dominios propios o expresamente autorizados; para una app externa de producción exige una página principal en dominio verificado. El dominio `workers.dev` documentado no pasa la guarda local de producción. No se inventa aquí un dominio de reemplazo.

Cuando se elija el dominio HTTPS propio `https://<DOMINIO_VERIFICADO>`, la configuración que habrá que completar será:

- OAuth client — JavaScript origin: `https://<DOMINIO_VERIFICADO>` (solo origen).
- OAuth client — redirect URI: `https://<DOMINIO_VERIFICADO>/api/auth/callback/google`.
- `BETTER_AUTH_URL`: `https://<DOMINIO_VERIFICADO>`.
- Google Auth Platform — home page y privacy policy: `https://<DOMINIO_VERIFICADO>/` y `https://<DOMINIO_VERIFICADO>/privacidad`.
- Google Play Console — recurso web de eliminación: `https://<DOMINIO_VERIFICADO>/eliminar-datos`.

Privacidad/eliminación son URLs públicas enlazadas en branding/Play Console, no JavaScript origins ni redirect URIs OAuth. El origen y callback de desarrollo local (`http://localhost:5173` y `http://localhost:5173/api/auth/callback/google`) son configuración de desarrollo y no reemplazan los valores de producción.

## Referencias

- [Google Play — Seguridad de los datos](https://support.google.com/googleplay/android-developer/answer/10787469?hl=es): declarar recopilación y transferencias de todas las versiones distribuidas; las categorías finales dependen del flujo real y proveedores.
- [Google Play — eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111?hl=es): requiere una vía dentro de la app y un recurso web para solicitar eliminación cuando se crean cuentas.
- [Google OAuth — política de dominios](https://developers.google.com/identity/protocols/oauth2/policies): usar dominios propios/autorizados, orígenes seguros y página pública de producción en dominio verificado.
- [Google OAuth — servidor web](https://developers.google.com/identity/protocols/oauth2/web-server): URI de redirección debe coincidir exactamente con una URI autorizada.
- [Better Auth — Google](https://better-auth.com/docs/1.6/authentication/google): `baseURL` define el callback Google; forma predeterminada `/api/auth/callback/google`.
