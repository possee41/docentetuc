# Padrones 2026: interfaz simplificada, preparada localmente

## Nueva pantalla

Encabezado «Padrones 2026» y cuatro tarjetas en el orden oficial: Inicial/Primaria, Secundaria, Técnica/Agrotécnica/No Formal y Superior/Especial/Artística. Cada tarjeta tiene exactamente un enlace principal «Abrir Drive oficial», con nombre accesible que identifica la Junta. Las URLs se leen directamente de `JUNTA_EXTERNAL_SOURCES`, incluyendo sus resource keys; no se duplicaron ni modificaron.

Se sustituyó la pantalla anterior: sin pestañas de período, historial, selector de Junta, carpetas/avisos, enlaces inferiores ni botones de documentos individuales. También se oculta el buscador de sección únicamente cuando se navega en Padrones, porque esta pantalla tiene cuatro accesos fijos. La búsqueda y filtros de otros módulos no cambian.

Se eligió no mostrar listados individuales D1 en esta pantalla, una opción permitida por el alcance solicitado. Las cuatro tarjetas muestran «Consultá las publicaciones en el Drive oficial». No se asegura inexistencia de documentos, cobertura completa, vigencia ni actualización por llevar 2026 en el nombre. Una única indicación contextual recuerda que ascensos, concursos e interinatos/suplencias son procedimientos distintos y que debe comprobarse la vigencia en la fuente.

Los registros históricos, API de consultas, importadores, checkpoints, funciones de clasificación, configuraciones oficiales, Durable Object y restantes módulos se conservan. El detalle genérico de publicaciones conserva sus controles y trazabilidad para accesos desde otros lugares de la aplicación. El nuevo componente de Padrones no consulta APIs ni carga los miles de documentos del listado anterior.

## Verificación

- Cuatro GET anónimos de las URLs configuradas: HTTP 200, host final drive.google.com, sin pantalla de acceso denegado. Sin PDF descargados ni recopilación de datos docentes.
- Dos pruebas sobre el HTML renderizado del componente real: cuatro tarjetas, cuatro enlaces exactos, títulos/etiquetas correctos y ausencia de controles anteriores, documentos individuales o afirmaciones de vigencia.
- Una prueba focalizada de conservación de DDJJ PDF/Word, Trámites, Licencias e Información útil: aprobada. Solo se ajustó su delimitador de función para que no dependa del componente eliminado; no se debilitó la comparación contra la base.
- TypeScript, ESLint sin advertencias y build: aprobados. No se ejecutaron suites generales ni auditorías de CPU.
- Revisión visual en navegador local del componente real con CSS del build: escritorio 1280×900 (dos columnas), móvil 375×812 (una columna) y modo oscuro. Sin desbordamiento horizontal; cuatro botones de 48 px de alto. No se utilizó D1 ni se sembraron datos para esta revisión. La revisión aislada no constituye una prueba remota del sitio productivo.
- Primer intento de vista previa inaccesible por aislamiento local; se reinició el mismo servidor exclusivamente en 127.0.0.1:8798 con acceso del navegador. Servidor detenido al terminar y viewport restablecido. No se tocó el servidor local 8797 de otro trabajo.

## Publicación pendiente

Este cambio es exclusivamente local. No se hicieron push, deploy, SQL remoto, migraciones, importaciones, cambios de Cron o credenciales. No se necesitan cambios D1. La futura publicación requiere autorización de un despliegue selectivo sobre la versión productiva vigente, con rollback del Worker. La referencia comunicada por el propietario es `83d7acaf-4e4f-4396-a3af-ca02ea214a3b`.
