# Administración de Comunidad DocenteTuc 1.1

El panel `/admin` usa la sesión Better Auth y exige `community_moderators.role = 'admin'` en D1. Ocultar el enlace en Cuenta no es una medida de autorización: la página y cada endpoint verifican el rol en el servidor. No existe una API para asignarse roles.

## Primer administrador (operación manual, no ejecutada en producción)

1. Aplicar primero `0015`, `0016`, `0017` y `0018` en ese orden, únicamente en la D1 del entorno correspondiente.
2. Iniciar sesión con la cuenta propia. Un operador con acceso privado a D1 identifica **esa fila exacta** de `"user"` mediante un criterio propio verificado, sin exportar ni publicar el email, y toma su `id` estable. No elegir por `displayName`, nombre público o posición en una lista de cuentas.
3. En la consola privada de D1, con ese `id` verificado, ejecutar `INSERT INTO community_moderators(user_id, role) VALUES (<ID_PROPIO_VERIFICADO>, 'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin';`. Nunca ejecutar esta asignación desde el navegador ni recibir el `id` del cliente como prueba de propiedad.
4. Comprobar `SELECT role FROM community_moderators WHERE user_id=<ID_PROPIO_VERIFICADO>;` y probar `/api/admin/community` con la sesión propia. Una cuenta normal debe recibir 403 y una anónima 401.
5. Revocar con `DELETE FROM community_moderators WHERE user_id=<ID_A_REVOCAR>;` o degradar a moderador con `UPDATE community_moderators SET role='moderator' WHERE user_id=<ID_A_REVOCAR>;`. Verificar nuevamente que `/admin` ya no abre.

El acceso admin muestra únicamente identidad pública, contenido de Comunidad y auditoría mínima. No consulta cuentas Google, sesiones, perfiles docentes privados, Guardadas ni instalaciones. El contenido oculto se purga según la política de 90 días ya existente; los registros de revisión conservan acción y fecha y pierden referencias al borrar la cuenta relacionada.

Los moderadores existentes conservan el rol `moderator` al aplicar `0018`. Pueden seguir utilizando solo la moderación ya autorizada por `0015`; no acceden a `/admin` ni pueden asignar roles. La revisión preventiva de `0020` permite al administrador bloquear la participación de un autor tras revisar un contenido concreto, con auditoría. No altera la cuenta ni el acceso a las demás secciones y no concede roles. La política y el alcance constan en `COMUNIDAD-PREMODERACION-1.1.md`.
