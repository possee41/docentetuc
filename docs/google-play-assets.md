# Google Play — estado de assets y capturas

Requisitos tomados de la [guía oficial de recursos gráficos de Google Play](https://support.google.com/googleplay/android-developer/answer/9866151?hl=es), revisada para esta preparación. Verificar los requisitos vigentes en Console antes de subir archivos. **No se alteró el logo ni se generaron capturas ficticias.**

| Recurso | Requisito de Play | Estado verificado en los archivos disponibles | Próximo archivo propuesto |
| --- | --- | --- | --- |
| Icono de ficha | 512 × 512 px, PNG de 32 bits con alfa, máximo 1.024 KB. | **Disponible como candidato:** `public/icon-512.png`, 512 × 512, RGBA, 465.662 bytes. Es el logo actual. `public/icon-maskable-512.png` es otro asset PWA; no reemplazar ni confundir automáticamente con el icono de ficha. Falta validar el render final en Play Console. | `play-icon-512.png` (copia del candidato aprobado, no un logo nuevo). |
| Feature graphic | 1024 × 500 px, JPEG o PNG de 24 bits **sin alfa**. | **No listo.** Se encontró fuera del repositorio un archivo candidato de 1794 × 876; es un montaje promocional con interfaz ficticia, sus dimensiones no son las especificadas y no es un recurso final verificado para Play. Los ocho `public/assets/docentetuc/*.webp` son banners de secciones, no un feature graphic aprobado. | Crear/validar posteriormente una pieza fiel a la app, dentro del repositorio de assets de tienda y con dimensiones/formato exactos. |
| Capturas | Para publicar: mínimo 2 capturas entre tipos de dispositivo; JPEG o PNG de 24 bits sin alfa; 320–3840 px y relación dentro del límite oficial. Para aspirar a recomendaciones con capturas: mínimo 4 capturas de app a 1080 px, idealmente 1080 × 1920 en vertical. | **No verificadas.** El pedido indica que se tomaron capturas en un teléfono, pero no se localizaron archivos que puedan validarse como capturas reales de la versión final. Los archivos altos accesibles en Descargas son montajes/mockups promocionales y no deben presentarse como capturas de producto. | Importar las capturas originales de la app real, verificar privacidad, resolución, versión y fidelidad antes de usarlas. |

El icono Android (`android/app/src/main/res/drawable/app_icon.png`) y los iconos PWA/launcher son recursos diferentes del material de la ficha. El candidato `public/icon-512.png` no sustituye la comprobación del icono del APK en un dispositivo. La apariencia instalada de la versión actual **sigue sin verificarse físicamente**; no inferirla sólo por el PNG fuente.

## Plan de seis capturas reales

Tomarlas **desde una instalación funcional de la versión final**, idealmente en teléfono Android, sin superponer rótulos que oculten la UI, sin datos privados de docentes y sin inventar registros. Si una fuente aparece parcial o fallida, no encuadrarla como cobertura completa. Comprobar barra inferior, safe area, permisos y navegación antes de capturar. El usuario indicó que ya existen capturas físicas, pero hasta que los originales estén disponibles y se inspeccionen, su procedencia y correspondencia con la versión final quedan **no verificadas**. Mensajes cortos sugeridos, opcionales para composición fuera de la captura si Play lo permite:

1. **Inicio** — «Tu información docente en un lugar».
2. **Designaciones** — «Consultá oportunidades de SIME».
3. **Capacitaciones / próximas inscripciones** — «Fechas publicadas por cada fuente».
4. **Agenda** — «Organizá tus eventos y recordatorios».
5. **DocenteTuc IA** — «Consultá con fuentes verificables»; evitar mostrar una respuesta no contrastada como certeza.
6. **Información útil** — «Organismos y trámites a mano».

Antes de subir: revisar que cada captura represente la interfaz actual, que las fuentes y fechas visibles sean reales, que no haya notificaciones privadas ni datos personales, y que las imágenes finales cumplan formato/tamaño de Play. No fabricar una pantalla para completar el listado.
