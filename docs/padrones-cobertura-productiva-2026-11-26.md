# Cobertura productiva de Padrones por Junta — 26/11/2026

## Resultado y alcance

Inspección de solo lectura de producción, API pública, checkpoints y fuentes oficiales; corrección local del lector. Sin importaciones, despliegues, migraciones, cambios de Cron ni modificaciones de Durable Object. Producción observada: `028c43fb-200a-43c4-8848-0aa385dd7215`, deployment `8a72df3c-3ce1-4712-9f61-245328bb341f`, tráfico 100 %. D1 autorizada de lectura: `baaf5886-0123-4948-96da-aa7106424549`.

## D1 frente a la aplicación

| Junta | Filas categoría Padrones | Documentos PDF/Docs en esa categoría | Tarjetas «Últimos por Junta», lector desplegado | Causa y acción |
|---|---:|---:|---:|---|
| Inicial y Primaria | 844 | 632 | 98 | Existen documentos con año explícito que el parser omite. Faltan al menos cinco definitivos generales 2026 de maestro de grado. |
| Secundaria | 695 | 670 | 0 | Casi todos los títulos carecen de año; los metadatos antiguos solo conservan la raíz. Un ascenso 2026 explícito queda fuera por longitud del título. Faltan los cinco PDF generales actuales por circuito. |
| Técnica, Agrotécnica y No Formal | 815 | 758 | 0 | El lector no interpreta las abreviaturas oficiales PD/PP. Faltan cinco definitivos 2026 de Formación Profesional por circuito. |
| Superior, Especial y Artística | 1100 | 969 | 2 (2025) | Se eligen los últimos años explícitos disponibles; no acredita vigencia. Se pierde contexto de carpetas 2026. Hay seis PDF de Artística ya existentes que requieren actualizar metadatos, no insertar duplicados. |

Las 3454 filas incluyen carpetas y referencias: no equivalen a 3454 PDF. La consulta pública también incluye legítimamente documentos titulados padrón guardados antes en «Llamados abiertos»: 31 documentos adicionales de Inicial/Primaria y 23 de Superior. El conjunto completo contiene 3029 documentos de categoría Padrones, más esos 54 documentos, y 635 referencias.

Las cuatro consultas API por Junta devolvieron HTTP 200, 50 elementos y cursor de continuación. No es un fallo del filtro SQL de Junta. Los recuentos de tarjetas se reprodujeron localmente con los mismos datos, paginación completa y funciones del lector desplegado; no se confunden con el tamaño de la primera página API ni con un conteo manual del DOM.

## Fuente oficial actual y documentos faltantes

Origen: [portal oficial de Padrones](https://padrones.educaciontuc.gov.ar/), siguiendo sus raíces de Drive hasta las filas PDF concretas. Se comprobaron títulos, IDs y ascendencia visibles; no se descargaron ni examinaron listados con datos docentes. Inventario exacto de 21 documentos y enlaces: `padrones-cobertura-oficial-2026-11-26.json`.

- **Inicial/Primaria:** carpeta [Definitivos 2026 con resolución](https://drive.google.com/drive/folders/1VE8hACw0BSIEJtsnGM3MweaLTouqk66O) → Interinatos y suplencias → Maestro de grado. Cinco PDF de circuitos I–V, ausentes de producción por ID y URL. No mezclar con ascensos, traslado ni concursos.
- **Secundaria:** nueva carpeta [Definitivos 2026 con resolución aprobatoria](https://drive.google.com/drive/folders/1uUAeB1eWj_MPFiufZz_NEitLp5v1uDr0) → [Interinatos y suplencias](https://drive.google.com/drive/folders/1NxvtWYm3nJyyXv8dUciHOyVySvxWdxX9). Cinco PDF CIRCUITO I–V, modificados el 25/11 y ausentes de producción. La antigua carpeta de circuito V utilizada por el piloto aparece en Papelera y vacía. No copiar documentos ni checkpoints de aquella exploración como si fueran la fuente actual.
- **Técnica:** [Definitivos 2026](https://drive.google.com/drive/folders/1bV5jAP66yWRpGDRAFqTENBIChV8Gfixt) → Formación Profesional → [Interinatos y suplencias](https://drive.google.com/drive/folders/1lRpaqh7LHrWtwY6ZsH0C_gzxuz1NFwAr). Cinco PDF PD INT Y SUP 2026, circuitos I–V, ausentes de producción. No acredita cobertura total de las otras ramas técnicas.
- **Superior/Especial/Artística:** raíz oficial contiene definitivos generales 2025, concurso de ascenso ISET 2026 y [provisorios 2026](https://drive.google.com/drive/folders/1HOLptmH1dUQdwKz8JPdDkbWuf8zQozN6). En Artística se verificaron seis PDF ya existentes: tres de ascenso y tres de distintas modalidades artísticas. Su contexto 2026 debe revalidarse y guardarse con los mismos IDs. No quedó demostrado un padrón general definitivo 2026 para toda esta Junta.

Son **mínimos comprobados**, no inventario completo de las cuatro raíces. El año y el carácter definitivo/provisorio no establecen por sí solos vigencia administrativa.

## Corrección local acotada

`lib/padron-documents.ts`: reconocer PD/PP únicamente en procedimientos oficiales explícitos INT Y SUP, ASC JER y CONCENTRACION; aceptar año prefijado y títulos largos; reconocer año explícito de padrones tipados de concurso manteniendo su ámbito separado. Rechazar fechas de publicación/descarga, códigos PDVC, convocatorias y años contradictorios como evidencia del año documental.

`app/docente-app.tsx`: distinguir aviso contextual de ascenso y concurso; ninguno equivale a padrón general. No se cambian SQL, paginación, datos, TTL ni Durable Object.

Reproducción con los registros actuales, sin insertar documentos:

| Junta | Tarjetas antes | Tarjetas después, solo local | Observación |
|---|---:|---:|---|
| Inicial/Primaria | 98 | 123 | Más títulos con año explícito, incluidos procedimientos separados. |
| Secundaria | 0 | 1 | Ascenso definitivo 2026; no resuelve los cinco generales ausentes. |
| Técnica | 0 | 246 | Provisorios 2026; 506 documentos de 2025 quedan en historial. No inventa definitivos 2026. |
| Superior | 2 de 2025 | 1 de 2026 | Concurso de ascenso ISET; los dos de 2025 pasan a historial. Los seis PDF sin año requieren sus metadatos oficiales. |

Los documentos sin año siguen accesibles en «Año no determinado». No se les asigna 2026 masivamente ni por fecha de descarga.

## Checkpoints y Comunicados

Producción no tiene checkpoints durables, revisiones ni firmas de Juntas. Contiene cuatro referencias genéricas de Comunicados y **cero publicaciones individuales**. Canary conserva 15 checkpoints PARTIAL sin leases y 35 comunicados individuales (22 Inicial/Primaria, 2 Secundaria, 2 Técnica, 9 Superior). Esto demuestra trabajo previo, no autoriza copiar resultados antiguos ni compartir cursores entre entornos.

La recuperación productiva debe crear su estado independiente desde las raíces actuales y conservarlo entre lotes. Las colas Canary profundas pendientes son 20/16/20/17 carpetas respectivamente; no son un recuento de documentos productivos faltantes. Para Comunicados hay que releer novedades oficiales y deduplicar por identidad de aviso y hash; una URL compartida de Google Docs no identifica por sí sola cada comunicado.

## Operación concreta pendiente de autorización

1. Publicar/desplegar únicamente el parche local del lector, conservando versión productiva y rollback.
2. Preparar el receptor independiente existente en código `workers/juntas-production.mjs`: el Worker `docentetuc-juntas-1-2` no existe remotamente (10007). Mantener cierre por defecto y autenticación/concesión temporal del runner existente. No tocar el Worker de otras fuentes.
3. Disponer de la clave Drive mediante mecanismo seguro fuera del repositorio: actualmente no existe en el proceso ni en el archivo DPAPI esperado de este entorno. No solicitarla por chat ni reutilizar secretos productivos de otras fuentes.
4. Autorizar una primera corrida manual incremental del ejecutor existente, **máximo 25 HTTP oficiales y 20 publicaciones**, sin reintentos ambiguos ni Cron. Descubrir la raíz actual de Secundaria; priorizar definitivos generales de Secundaria y Técnica. Aprovechar el resto del presupuesto para documentos/contexto y comunicados individuales sin prometer completar todos en un lote.
5. Antes de cada escritura, comprobar equivalencia por ID/Drive ID/URL y metadatos oficiales; conservar revisiones y obtener MD5 de la fuente cuando exista. Los seis de Artística se actualizan, no se duplican. Conservar PARTIAL, ACK y checkpoints; cerrar concesión al terminar.

No hacen falta migraciones. Los 15 PDF ausentes más seis actualizaciones y Comunicados exceden un único presupuesto de 20 publicaciones: no declarar cobertura completa ni continuar automáticamente. No hubo escrituras ni despliegues durante esta investigación.

## Validación local

Diez pruebas focalizadas de parser, ámbito, clasificación, selección anual, históricos y paginación aprobadas (`node --test lib/padron-coverage-regression.test.ts lib/padron-documents.test.ts`). TypeScript (`npx tsc --noEmit`), ESLint de los tres archivos de código modificados y `npm run build` finalizaron con código 0. No se ejecutaron suites generales ni pruebas de CPU. Evidencia resumida y manifest oficial acompañan este informe; los volcados de publicaciones y estados no se incorporan al repositorio.
