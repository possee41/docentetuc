# DOCENTETUC 1.1

Base: DocenteTuc 1.0.10 / tag `v1.0.10` (`c6db1ad`).

## FASE 1 — IDENTIDAD/AVATAR

Estado: base funcional en web dentro de `develop/1.1`; revisar y probar antes de habilitar cualquier función social.

- Perfil público opcional, separado en D1 del perfil docente privado.
- Nombre visible y bio son ingresados expresamente por el usuario; no se copian del nombre privado.
- Veinte IDs de avatar temporales renderizados con placeholders locales; faltan las ilustraciones gráficas definitivas.
- No existe una vista pública/listado de perfiles y guardar el perfil no lo publica.
- La identidad UUID local solo asocia datos a una instalación; no es autenticación pública segura ni identidad recuperable entre dispositivos.
- La eliminación asistida contempla los datos del perfil público.

Antes de Comunidad/Threads quedan pendientes identidad estable y autorización seguras, privacidad y consentimiento de publicación, moderación y reportes, bloqueo de usuarios, eliminación de contenido y pruebas de abuso/seguridad. No hay threads, comentarios, likes, reacciones, seguidores ni chat.

## Objetivos propuestos

1. Sistema de avatar
2. Identidad estable del usuario
3. Comunidad DocenteTuc
4. Threads / publicaciones
5. Respuestas a threads
6. Reacciones
7. Reportar contenido
8. Bloquear usuarios
9. Moderación
10. Privacidad adaptada a funciones sociales

## Condiciones previas para funciones sociales

No implementar funciones sociales sin resolver previamente:

- identidad estable;
- seguridad;
- privacidad;
- eliminación de contenido;
- moderación;
- reportes.

La identificación interna `1.1.0-dev` es solo documental. No cambiar el
versionCode Android ni generar un release Android hasta que se autorice una
fase de release.
