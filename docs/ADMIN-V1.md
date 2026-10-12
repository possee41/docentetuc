# Admin V1 de DocenteTuc

Esta ampliación conserva la autorización existente: sesión Better Auth válida y `community_moderators.role='admin'` comprobados en el servidor para `/admin` y cada ruta `/api/admin/*`. No concede roles ni crea administradores. La moderación de Comunidad sigue en su endpoint original.

## Datos y migración

`migrations/0019_admin_notices.sql` es aditiva: crea `admin_notices` y `admin_notice_events`, con índices para vigencia/auditoría. No toca perfiles, agendas, publicaciones sincronizadas ni datos de Comunidad. **No se aplicó a producción**. Se ensayó, incluso una segunda ejecución accidental, sobre una D1 local aislada con el esquema previo completo. Debe aplicarse al entorno de destino antes de publicar código que permita crear avisos. El endpoint público devuelve `[]` si la tabla aún no existe, para no interrumpir Inicio durante un despliegue escalonado.

Cada aviso puede activarse, desactivarse o programarse; no hay borrado físico en V1. La auditoría conserva acción y fecha, y las referencias al administrador se vuelven `NULL` si se elimina esa cuenta. `/api/notices` publica únicamente avisos activos dentro de su ventana temporal, sin IDs de administradores ni auditoría. Los enlaces aceptan solo HTTPS.

Las mutaciones leen un JSON acotado a 12 KiB antes de responder 401/403: en el Worker local de Windows, dejar ese cuerpo sin consumir causaba un reinicio en la siguiente petición POST. La autorización y la validación del mismo origen siguen ejecutándose en el servidor antes de realizar cualquier cambio.

## Alcance operativo y límites deliberados

- Usuarios: máximo 100 resultados por búsqueda; nombre, email, fecha de alta, rol y si existe una sesión vigente. No se infiere «último acceso» porque Better Auth no guarda un dato fiable para ello. No hay edición ni borrado de usuarios.
- Publicaciones: lectura paginada de registros no retirados, 50 por página; los filtros consultan D1 sin modificar contenido. Las categorías de designaciones se derivan de la clasificación oficial ya existente.
- Sincronizaciones: última ejecución, último éxito, estado, cantidad y código de error sanitizado. No se muestran mensajes crudos de error ni hay botón de ejecución. La próxima ejecución por fuente no puede inferirse con fiabilidad de `sync_state`.
- IA: proveedor/modelo configurados, disponibilidad **de configuración** (no prueba de conectividad), intentos agregados de la ventana activa de rate limit y estado declarado del respaldo web. No hay historial persistente de errores de IA; el panel no inventa uno.
- Comunidad: reutiliza la moderación posterior existente; la revisión preventiva es una capa separada.

Antes de desplegar: repetir tests/TypeScript/lint/build y comprobar 401/403 con cuentas de prueba y un aviso futuro, vigente, vencido e inactivo. Esos escenarios pasaron en D1 local aislada; no equivalen a validación de producción. Para producción, solicitar autorización independiente antes de migrar D1 o activar una versión de Worker.
