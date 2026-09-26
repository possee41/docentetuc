# Plan de evolución de DocenteTuc

## Estado actual

- **Frontend:** React 19 + Next/Vinext, Tailwind y componentes shadcn. La interfaz es una PWA responsive.
- **Backend:** rutas server-side `/api/app` y `/api/sync` ejecutadas en Cloudflare Workers.
- **Datos:** Cloudflare D1 con perfiles, publicaciones normalizadas, guardados, agenda, seguimientos, alertas y estado de sincronización.
- **Android:** el APK actual abre la URL pública en el navegador del dispositivo. No contiene la lógica ni los datos oficiales.
- **Inicio:** ya es una vista React interna; no incrusta sitios oficiales. El fallo observado provenía de errores de datos/carga sin un estado recuperable, no de una WebView del Home.

## Clasificación de funciones

### A — Completamente internas

- Inicio, búsqueda sobre datos sincronizados, filtros y detalles.
- Consulta de vacantes/designaciones públicas, capacitaciones y referencias de Padrones.
- Perfil de preferencias, guardados, agenda, seguimientos y alertas.
- Resúmenes y priorización basados en información pública almacenada en D1.

### B — Consulta interna; finalización oficial externa

- Vacantes de SIME: consulta interna, postulación/designación en SIME.
- Capacitaciones: catálogo y detalle internos, inscripción en FDCI.
- Padrones y documentos: índice interno, archivo original en Google Drive o dominio oficial cuando no existe API pública estable.

### C — Obligatoriamente externas por ahora

- Inicio de sesión de SIME/FDCI, CAPTCHA, inscripción y postulación.
- Datos privados de cada docente: horas, situación personal, trámites y cuentas existentes.
- Cualquier recurso protegido sin API oficial autorizada.

## Fuentes verificadas

- **SIME:** página pública de vacantes y endpoints JSON usados por el propio frontend. El contrato no está documentado y debe tolerar cambios.
- **Capacitación Docente:** catálogo y comisiones públicas en la API usada por el sitio. La inscripción queda fuera del agregador.
- **Padrones:** índice oficial público con Docs, carpetas Drive y PDF. Drive no ofrece aquí un feed público estable para enumerar todos los archivos.

No se eluden autenticación, CAPTCHA ni controles de acceso.

## Arquitectura objetivo

```text
Fuentes oficiales públicas
        ↓
Adaptadores SIME / FDCI / Padrones
        ↓
Normalización + validación + D1
        ↓
API de búsqueda y recuperación
        ↓
Web/PWA/Android ───── Asistente IA
                         ↓
                 AIProvider (backend)
                  OpenAI | Gemini | otro
```

El asistente recuperará primero documentos/publicaciones oficiales, responderá sólo con ese contexto y devolverá fuente, fecha y enlace. Las claves permanecerán en variables de entorno del Worker. Las fuentes complementarias se etiquetarán por separado y nunca sustituirán una fuente oficial.

## Fases

1. **Home nativo y estabilidad:** estados de carga/error, reintento, panel personal, “Importante para vos”, fechas y últimas publicaciones.
2. **Sistema visual:** tema claro/oscuro, navegación móvil refinada, accesibilidad y estados consistentes.
3. **Consultas internas:** enriquecer detalles públicos de SIME/FDCI y extraer contenido estructurado permitido.
4. **Buscador global:** resultados agrupados por categoría y búsquedas guardadas.
5. **Agregador:** adaptadores separados, sincronización programada, reintentos y estado por fuente.
6. **Asistente IA:** recuperación con citas, interfaz `AIProvider`, límites, seguridad y evaluación anti-alucinación.
7. **Preferencias y notificaciones:** tipos configurables y push cuando exista autorización del dispositivo.
8. **Entrega:** pruebas, auditoría de seguridad, rendimiento, APK/AAB firmado y publicación.

## Archivos de la Fase 1

- `app/docente-app.tsx`: Home y recuperación de errores.
- `docs/PLAN_IMPLEMENTACION.md`: auditoría, límites, arquitectura y fases.

Las fases siguientes se incorporarán sin borrar las funciones existentes y con una comprobación ejecutable por cada cambio no trivial.
