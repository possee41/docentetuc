# Designaciones: recuperación local preparada — 13/11/2026

**Resultado: corrección funcional local preparada; no desplegada. Cobertura oficial completa y CPU de producción todavía no certificadas.** Rama aislada `local/designaciones-recovery`, sobre la referencia Web 1.2 `bfb43db`. Se preservaron los otros checkouts, incluidos los cambios ajenos sin commit. La publicación futura debe integrar exclusivamente este diff sobre el código productivo vigente, no desplegar todo un checkout anterior.

## Causa y evidencia real

La sección pública se denomina **Actos de designación**. No es equivalente a Inscripciones SIME ni al resultado personal de una postulación.

La cadena antigua de `/api/sync` usa `reconcileOfficialPublications` → `designationFromOpportunity`: genera un evento separado cuando el detalle contiene fecha de designación. El importador independiente actual usa `prepareSimeImport`, que conserva esa fecha dentro de la metadata de la **vacante**, con su ID `sime:<id>`, sin generar la segunda publicación. La vista de Actos esperaba `official.entity=event` y `ACTO_DESIGNACION`, por lo que descartaba esas fechas. No era una ausencia demostrada de actos oficiales.

Además, Actos dependía del bootstrap público limitado a 400 publicaciones. Comunicados y Llamados ya tenían consulta paginada; Actos no. Tampoco tenía el selector «Para mí».

Lectura pública a las **17:35:35 UTC**: HTTP 200, 400 publicaciones en la respuesta, **227 SIME**: Inicial/Primaria 42, Secundaria 16, Técnica 81, Superior/Especial/Artística 88. Las 227 son `kind=vacante`. La copia contiene **22 fechas de designación**. El selector anterior obtiene cero actos actuales; la proyección local obtiene **9 próximos con verificación reciente**: 3 Secundaria, 3 Técnica, 3 Superior. Los otros 13 quedan en historial/por verificar. Cero actuales de Inicial/Primaria en esta muestra **no prueba ausencia oficial**. `sync_state` público continúa `PARTIAL`.

Se contrastó un detalle oficial individual: `Vacantes/ObtenerVacante/144389?origen=&postulante=` devolvió HTTP 200 y fecha `24/11/2026 10:00 a.m.`, coincidente con `2026-11-24T10:00:00-03:00` almacenado. Se descartaron campos personales de la evidencia. El formulario oficial `https://sime.educaciontuc.gov.ar/Vacantes/Index` utiliza `tab=1` para Vigentes y `tab=2` para No Vigentes; ambos son listados de vacantes. No se interpretó su HTML templado como un catálogo vacío ni se supuso que «No Vigentes» fueran resultados adjudicados.

Estas comprobaciones fueron GET públicos acotados. No se consultó D1 remota, ni se ejecutó el recolector/importador. Evidencia técnica sanitizada local: `.wrangler/designaciones-local/public-evidence.json`.

## Solución implementada

- **Modelo de lectura sobre la publicación existente**: `simeDesignationView` exige identidad SIME, URL de evidencia del mismo detalle, fecha válida y visibilidad pública. No crea filas `acto:sime:*`, no cambia hashes ni modifica el registro original. El ID sigue siendo `sime:<id>` para Guardados, Agenda y seguimiento.
- La fecha del acto se separa del cierre de inscripción: una vacante cerrada puede tener un acto próximo. No se deduce un horario de una fecha sin hora; tampoco se transforma una convocatoria en adjudicación.
- Fecha provisional, contradictoria, retirada, detalle fallido o antiguo no se anuncian como vigencia confirmada. Para SIME se exige detalle OK de hasta **36 horas**: margen de una jornada más 12 horas de demora. Es una política conservadora de presentación, no una garantía del proveedor. La información anterior se conserva en «Historial y por verificar», con fecha de comprobación, para consultar la fuente.
- `/api/boards?view=actos` usa paginación por ID, **20 candidatos por página**; no depende del límite 400 del inicio. No hay OFFSET ni consultas privadas. El cursor avanza sobre candidatos leídos incluso si fueron descartados, evitando bucles o pérdida de páginas. Devuelve 503 ante error de consulta, no un falso éxito vacío.
- Actos ofrece **Todas**, **Para mí** e historial; reutiliza los mismos criterios del Perfil docente y su umbral de confianza. Sin perfil, Todas sigue disponible y Para mí solicita completarlo. La coincidencia se aplica a las páginas consultadas; el usuario conserva «Cargar más» mientras haya cursor. Una página sin coincidencias no representa una búsqueda exhaustiva de toda la base.
- Se conserva la localidad/circuito del cargo para matching. El lugar donde se celebra el acto permanece en la evidencia de ubicación; no se usa como si fuera la localidad de la escuela.
- Inicio y la sección de Actos comparten la proyección: no queda el acceso oculto por la antigua clasificación. Se deduplican alias antiguos `acto:sime:*` frente al ID SIME base.
- Seguimiento personal disponible desde el detalle del acto; se conserva el ID original y los estados existentes. Fecha/hora de cita sugerida solo cuando existe datetime informado, sin reemplazar valores guardados. **OBTENIDO/NO OBTENIDO siguen siendo declaraciones privadas del usuario**, no resultados oficiales ni estados asignados automáticamente.

No se alteraron `APP_PUBLICATIONS_QUERY`, índices, TTL, autenticación, SQL de seguimiento privado, recolectores, workflows, concesiones, secretos o datos remotos. Sin nuevas dependencias, tablas ni migraciones.

## Actualización automática elegida

Se reutiliza la sincronización SIME ya programada: sus detalles oficiales actualizan la metadata existente y la lectura refleja esas fechas automáticamente. **No hace falta otro Cron, otro Worker o otro ledger que compita por los mismos IDs.** Se conserva el runtime SIME publicado `d478674ce7797dd698d0eada1cd9b527ed79a353`, sus límites y cursores; no requiere otra migración CAS por esta corrección Web.

La cobertura seguirá siendo progresiva: el recolector actual rota detalles con cupos por junta. Con muchas publicaciones, no todos los detalles pueden comprobarse en una misma jornada. La política de 36 horas no convierte automáticamente en actuales los detalles pendientes. El runner consulta el período vigente y actos próximos ya conocidos; **no se demostró cobertura exhaustiva de actos nuevos que solo figuren en No Vigentes/períodos anteriores**. Resolver esa brecha requeriría un backfill acotado con checkpoint y presupuesto explícito dentro del mismo estado, no activar un segundo escritor independiente. No se inventó cobertura ni se añadió ese recorrido sin evidencia de registros omitidos concretos.

El sistema no tiene una fuente integrada que confirme adjudicaciones nominales. Esta solución recupera **convocatorias/fechas de actos** y seguimiento privado; no publica nombres de adjudicatarios ni deduce resultados por vencimiento. Las actas/comunicados de Juntas conservan su clasificador y referencias originales; una carpeta completa no se presenta como acto individual vigente.

## Pruebas y límites

**39/39 pruebas focalizadas aprobadas**, cero fallidas u omitidas:

```text
node --experimental-strip-types --test scripts/designations-e2e.test.mjs lib/board-page.test.ts lib/board-view.test.ts lib/sime-publications.test.ts lib/official-publication.test.ts lib/designations.test.ts lib/designation-state.test.ts lib/personalized-catalog.test.ts lib/official-reconciliation.test.ts
```

Ocho pruebas nuevas ejercitan las cuatro juntas, fechas sin hora y cambio de día en Tucumán, fechas inválidas, evidencia ajena, fixtures ocultos, detalle fallido, expiración, matching territorial y deduplicación. Handler HTTP real de Actos sobre SQLite local: **405 actos únicos**, 20 candidatos por página, todas las páginas recuperadas sin duplicados, filtros y parámetros inválidos, consultas de solo lectura y fallo 503 sin reintento. No es un benchmark de carga.

Handler privado real con autenticación inyectada exclusivamente en el harness de test: guardado OBTENIDO repetido/concurrente sin duplicado; usuario B no lee ni modifica el seguimiento de A aunque envíe `userId` ajeno; B puede conservar su propio NO OBTENIDO. Sin sesión: 401; ID arbitrario: 400. Una actualización de la publicación no borra notas ni estado. Cero notificaciones. No se agregó bypass al código desplegable.

TypeScript, ESLint de los archivos afectados y build aprobados. No se repitió la suite general. Pruebas visuales en navegador/Canary y Google OAuth real de esta versión: **pendientes, no declaradas aprobadas**. Las pruebas de inyección verifican el uso de identidad en los handlers, no sustituyen una validación OAuth remota.

Workers Free: reducción del payload de Actos a 20 candidatos, sin descarga oficial, hashes ni escrituras durante la lectura. La búsqueda paginada puede leer más candidatos que los mostrados; los filtros JSON y la selectividad deben observarse en Canary. No se afirma CPU <10 ms ni ahorro D1 a partir de SQLite/build. La primera sincronización automática SIME efectiva no se verificó nuevamente en esta tarea.

## Autorización concreta pendiente y recuperación

Solicitar autorización para **publicar selectivamente esta corrección Web y desplegarla primero en Web Canary**, conservando bindings aislados, sin importaciones ni escrituras D1. Validar Todas/Para mí, historial, seguimiento y CPU individual disponible sobre datos existentes. Si se autoriza un ensayo privado con cambios de seguimiento en Canary, sus filas y limpieza deben identificarse previamente; no se incluyen tácitamente aquí.

Solo después de esa comprobación, autorizar **un despliegue selectivo del Worker Web productivo** sobre su versión activa, con su ID anterior conservado. No incluye modificar receptor, runtime SIME, estados Git, horarios o fuentes restantes. No debe desplegarse el checkout completo de referencia ni arrastrar cambios pendientes de otros frentes.

Detención: fecha que no coincide con la fuente, fuga de seguimiento, duplicados, respuestas ambiguas, error 1102, consumo incompatible con Free o regresión de Vacantes/Capacitaciones. Reversión: volver a la versión Web anterior; al ser un modelo de lectura, no hay nuevas filas públicas, migraciones, hashes ni cursores que revertir. Se conservan los datos personales guardados.
