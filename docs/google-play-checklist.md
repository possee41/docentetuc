# Google Play — checklist de cierre sin publicación

Esta fase **no** accede a Play Console, no paga registro, no publica ni compila Android. Estado de preparación al 1 de octubre de 2026.

Verificación de cierre: GET sin credenciales a `/`, `/privacidad` y `/eliminar-datos` devolvieron HTTP 200; `pnpm test` aprobó 138/138, `pnpm lint` pasó sin errores y `pnpm build` web terminó correctamente. `git diff --check` y el commit de congelamiento se registran en la entrega. Esto **no** valida un AAB actual ni equivale a una prueba física Android.

## COMPLETADO

- [x] Política de privacidad y página pública de solicitud de eliminación implementadas; el acceso HTTP sin autenticación se verifica en la entrega de esta fase.
- [x] Correo de soporte: `soporte.docentetuc@gmail.com`.
- [x] Procedimiento administrativo de eliminación D1 documentado en `docs/data-deletion.md`; requiere verificación de titularidad, no es borrado automático.
- [x] Borradores de Data Safety, información gubernamental, ficha y assets en `docs/google-play-*.md`, basados en el código actual.
- [x] Icono 512 × 512 candidato en `public/icon-512.png`; pendiente validación visual en Console y teléfono.
- [x] No hay cuenta propia con contraseña en la arquitectura inspeccionada; existe UUID local de instalación e integración opcional de identidad.

## PENDIENTE

- [ ] Resolver las cuestiones de proveedores, logs, SDK/TWA y clasificación de «compartir» detalladas en `docs/google-play-data-safety.md`; después fijar respuestas definitivas del formulario.
- [ ] Crear y validar feature graphic 1024 × 500 con identidad actual, sin insinuar afiliación estatal. El montaje encontrado fuera del repositorio no es apto como pieza final verificada.
- [ ] Incorporar y verificar los originales de al menos dos capturas reales de la versión final, preferentemente las seis del plan; revisar datos personales, vigencia y formatos. La procedencia de imágenes promocionales accesibles no acredita capturas reales.
- [ ] Reconfirmar la salud de `/api/app`, sincronización y fuentes; el barrido incremental de Padrones/Llamados **no es exhaustivo** hasta completar todas las raíces sin errores.
- [ ] Crear **una única compilación Android release posterior** a los cambios de privacidad/eliminación, con el keystore existente; verificar firma, versión, AAB, APK y hashes. El AAB anterior no es definitivo.
- [ ] Revisar tamaños, política y textos de Play inmediatamente antes de la carga; las reglas pueden cambiar.

## REQUIERE PLAY CONSOLE

- [ ] Completar Data Safety con los resultados auditados, política de privacidad, enlace de eliminación, declaración gubernamental y contacto.
- [ ] Cargar ficha, icono, feature graphic y capturas reales; revisar cómo los muestra Play.
- [ ] Definir clasificación de contenido, audiencia, permisos y declaraciones aplicables al artefacto final.
- [ ] Confirmar último `versionCode` usado por el paquete `ar.com.docentetuc.app` antes de incrementarlo. El repositorio usa actualmente **10** (`versionName` **1.0.9**); **11** es la recomendación siguiente sólo si Console no registra uno mayor.
- [ ] Subir el AAB definitivo y revisar advertencias/errores; **no** iniciar publicación automáticamente.

## REQUIERE PAGO/REGISTRO

- [ ] El titular debe habilitar y pagar, cuando decida hacerlo, una cuenta propia de desarrollador de Google Play. Ningún pago o creación de cuenta forma parte de esta fase.

## REQUIERE PRUEBA FÍSICA

- [ ] Instalar **el APK del mismo release definitivo** sin desinstalar la app existente; antes de actualizar, comprobar compatibilidad de firma. Si difiere, detenerse y proteger los datos locales.
- [ ] Verificar icono sin borde blanco, apertura, Inicio, Designaciones, Capacitaciones, Padrones/Comunicados/Llamados, Agenda, Perfil/circuitos, Guardados, Información útil, IA, persistencia, navegación, teclado, safe area y push real con apertura desde notificación.
- [ ] Tomar capturas de la app real sólo después de la prueba y revisar que no expongan información personal.

## Orden cuando el titular habilite Play

Cerrar pendientes de Data Safety y assets → comprobar producción y pruebas → confirmar próximo `versionCode` en Console → compilar una sola vez APK/AAB firmados con el keystore existente → probar APK en teléfono sin borrar datos → cargar el AAB y completar declaraciones en Console → solicitar aprobación del titular antes de publicar.
