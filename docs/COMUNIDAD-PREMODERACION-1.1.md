# Moderación preventiva de Comunidad 1.1

Esta capa se ejecuta en el servidor antes de crear o editar publicaciones y comentarios. Conserva la sesión Better Auth, el perfil público, las normas versionadas, los límites de frecuencia y la moderación posterior. No recibe `userId` como prueba de autoría. La sesión determina el autor. `migrations/0020_community_pre_moderation.sql` es aditiva, no altera contenido existente, se ensayó en una D1 local aislada y **ya se aplicó en producción**; no debe ejecutarse nuevamente allí. Las escrituras de Comunidad se cierran de forma segura si faltan las cuatro tablas nuevas.

## Decisión y visibilidad

- `approved`: se publica.
- `pending_review`: no aparece en feed, búsqueda, Guardadas, comentarios públicos ni acceso directo. El autor ve su estado; los administradores ven el contenido en `/admin` → Comunidad.
- `rejected`: permanece no público; el autor recibe un mensaje sin detalles técnicos. No puede restaurarse mediante la moderación posterior.

Los estados nuevos se registran en `community_pre_moderation`; el contenido pendiente o rechazado también queda `hidden` en las tablas de Comunidad, de modo que las consultas públicas existentes siguen filtrándolo. La tabla de eventos registra decisión, fecha y administrador cuando corresponde, sin copiar el texto. Al eliminar una cuenta, el contenido y las referencias de revisión asociadas se eliminan mediante claves foráneas y el flujo existente. El texto oculto por moderación conserva la política de purga a los 90 días.

## Motor y fallas

La interfaz de clasificación es independiente del proveedor. Las rutas usan Gemini ya configurado (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`), sin añadir un proveedor ni una clave nuevos. Al proveedor solo se envían tipo y texto del borrador; nunca email, perfil docente, agenda, seguimientos, historial ni identificadores. La respuesta estructurada se valida de nuevo en el servidor. Un rechazo automático requiere categoría reconocida y confianza ≥ 0,95; una aprobación exige confianza ≥ 0,70 y ninguna categoría. Categorías desconocidas, respuesta malformada, timeout de 5 s, 429 o indisponibilidad pasan a revisión, no a publicación ni rechazo automático. Los patrones locales solo elevan a revisión; nunca rechazan por sí solos.

Cada creación o edición con Gemini configurado puede producir una petición al modelo, por lo que habrá consumo/costo según la cuota del proveedor. No se hizo una prueba real del clasificador contra Gemini ni se modificaron facturación o claves. Si el proveedor falla de forma sostenida, la cola administrativa puede crecer; debe monitorizarse antes de habilitarlo en producción. Es posible que contenido inocuo quede pendiente (falso positivo) y que contenido indebido sea aprobado (falso negativo); los reportes posteriores siguen disponibles. La clasificación automática no sustituye criterio humano ni convierte una crítica legítima en infracción por sí sola.

## Administración

`/api/admin/community/pre-moderation` comprueba sesión y rol `admin` en servidor; las mutaciones verifican mismo origen. La cola muestra identidad **pública**, texto, contexto mínimo, categorías, motivo y confianza. El administrador puede aprobar/descartar la alerta, rechazar o bloquear la participación del autor del contenido revisado. Cada revisión o restricción queda auditada. Bloquear participación no borra contenido ni cuenta, y no afecta otras funciones. El desbloqueo no tiene interfaz V1: requiere procedimiento administrativo controlado; no debe aplicarse un bloqueo sin revisión humana y una razón documentada. La página y APIs normales no exponen email Google, tokens, foto privada, perfil docente, agenda ni Guardadas.

`0019` y `0020` ya están aplicadas en producción; no volver a ejecutarlas. Para futuros despliegues, repetir E2E con un Worker de prueba estable, revisar capacidad de la cola y el costo del clasificador, y verificar rollback del Worker sin restaurar D1 automáticamente. No publicar esta capa en un entorno donde la migración `0020` no esté aplicada.
