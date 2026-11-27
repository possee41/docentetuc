# Juntas reconciliado con producción — 26/11/2026

## Candidato y alcance

Preparado localmente en la rama `local/juntas-production-reconciled-20261126`, worktree `DocenteTuc-juntas-production-reconciled`. El SHA final queda registrado en el manifiesto generado después del commit: `.wrangler/juntas-production-prep/production-package-manifest.json`, campo `codeSha`.

Base fuente obligatoria: `85c4a912c346bb480e5707639e3a82ae48a5b866`. Worker de referencia: `6fb7a6a2-1552-4e43-9e2d-9d054e370419`, deployment `19c53725-1c8e-4a71-85e7-0996b8c1dc02`. El preflight remoto previo identificó ese upload y el log local apuntó al build de `DocenteTuc-1.2-sync-integration`, cuyo HEAD es esa base. La correspondencia es de procedencia; no se afirma reconstrucción binaria idéntica a la versión remota. En esta reconciliación no se hicieron llamadas remotas.

Se creó el worktree desde esa base y se integró el candidato Juntas `1a33d4cee2bbed4d770739a3fe48332127656277` mediante merge local de tres vías. Git combinó automáticamente los cambios separados de `app/docente-app.tsx`; no hubo conflictos. No se sustituyó ese archivo por el de la rama antigua. Se conservaron ambos historiales y los worktrees anteriores.

Respecto de `85c4a91`, el diff funcional es exclusivamente el paquete Juntas anterior. Respecto de `1a33d4c`, se recuperan los cambios ya productivos DDJJ/Información útil y sólo se ajustan las pruebas, el empaquetado y este informe. No se ejecutan los dos scripts SQL DDJJ heredados de la base.

## Preservación comprobada

- Los PDF y Word DDJJ son idénticos byte por byte a los de `85c4a91`.
- `InformationHub` completo, incluyendo tarjetas Trámites, categoría normalizada mediante `normalize(category || "") === "tramites"`, DDJJ y Licencias, coincide con la base, normalizando únicamente CRLF/LF.
- `lib/useful-information.ts` coincide con la base, salvo representación de saltos de línea del checkout.
- Todo el componente desde `Dashboard` en adelante permanece idéntico a la base. Las modificaciones UI de Juntas se limitan a sus imports y a las secciones Padrones/Comunicados.
- Llamados conserva SQL y parámetros para 20 variantes; consultas globales, autenticación pública, buscador, lector FDCI, tarea programada existente y configuración productiva no cambian según las comprobaciones de integración.
- El manifiesto verifica todos los documentos de `public/documents` de la base tanto en fuentes como en `dist/client`, incluyendo los modelos de Licencias. Falla si un documento cambia o falta.
- 0100 conserva exactamente el SQL aprobado anteriormente. Sigue preparada, sin aplicación remota.

## Validación ejecutada

| Comprobación | Resultado |
|---|---|
| `node --experimental-strip-types --test scripts/juntas-production-integration.test.mjs` | 12/12 aprobadas |
| `node node_modules/typescript/bin/tsc --noEmit` | aprobado |
| ESLint de `app/docente-app.tsx`, preparación y pruebas de reconciliación | aprobado |
| `npm run build` | aprobado |
| `git diff --check` y diff staged | aprobados |

Las pruebas cubren SQLite local de 3.454 Padrones con paginación de 50 (70 páginas, sin pérdidas/duplicados), orden/cursor de Comunicados, historial, migración aditiva repetible y coexistencia con eventos SIME, identidad, denegaciones, vencimiento y cierre. También confirman workflow exclusivamente manual, concurrencia y fijación del SHA. Una primera ejecución de la nueva prueba comparó un archivo de texto como binario y falló por CRLF/LF de Windows; se corrigió únicamente esa comparación. PDF y DOCX siguen sujetos a comparación binaria estricta. El resultado final es 12 aprobadas y cero fallidas.

El build advierte sobre clasificación estática incompleta de algunas rutas en vinext; no se presenta como un fallo de compilación ni como evidencia nueva de CPU. El HTML vacío de Juntas se genera sin DB, credenciales, cookies ni red externa; los documentos se consultan dinámicamente. No se repitieron importaciones, pilotos Canary, suite general ni mediciones de CPU.

## Archivos del paquete frente a la base vigente

El diff completo puede consultarse con `git diff 85c4a912c346bb480e5707639e3a82ae48a5b866 HEAD`. Incluye:

- UI/rutas: `app/docente-app.tsx`, `app/juntas-client.tsx`, `app/page.tsx`, `components/juntas-revisions.tsx`, `app/api/boards/route.ts`, `app/api/boards/padrones/route.ts`, `app/api/boards/revisions/route.ts`.
- Datos/lectura: `db/d1.ts`, `db/index.ts`, `lib/board-page.ts`, `lib/juntas-public-api.ts`, `lib/padron-documents.ts`, `lib/official-publication.ts`, `lib/publication-visibility.ts`, `lib/fdci-canary-synthetic.ts`. El último es la dependencia de visibilidad ya aprobada, sin habilitación FDCI.
- Recolección y estado Juntas: `lib/junta-external-sources.ts`, `lib/junta-external.ts`, `lib/junta-notices.ts`, `scripts/import-juntas-checkpoint.mjs`, `scripts/juntas-document.mjs`, `scripts/juntas-gateway-db.mjs`, `scripts/juntas-maintenance.mjs`, `scripts/juntas-production.mjs`, `scripts/juntas-source-fetch.mjs`.
- Receptor: `workers/juntas-checkpoint-gateway.mjs`, `workers/juntas-production.mjs`, `workers/public-source-receiver.mjs`, `workers/source-import-gateway.mjs`, `wrangler.juntas-production.jsonc`.
- Build: `scripts/prepare-juntas-production.mjs`, `scripts/prepare-juntas-shell.mjs`, `scripts/prepare-worker.mjs`, `scripts/worker-entry.mjs`.
- Esquema y pruebas: `migrations/0100_juntas_document_revisions.sql`, `lib/fixtures/juntas-production-schema-20261121.sql`, `scripts/juntas-production-integration.test.mjs`.
- Automatización preparada, inactiva: `.github/workflows/juntas-maintenance-production.yml` (sólo `workflow_dispatch`; sin schedule activo).
- Evidencia: este informe, `docs/juntas-integracion-productiva-2026-11-22.md`, su JSON y `docs/juntas-preflight-productivo-solo-lectura.sql`. Los documentos del 22/11 son evidencia histórica; para versión de referencia, paquete y rollback rige este informe y el manifiesto nuevo.

No se modifican los archivos fuente de DDJJ, Información útil, scripts SQL DDJJ ni documentos ya productivos respecto de la base vigente.

## Publicación futura: operaciones separadas y orden seguro

No se ejecutó ninguna de estas operaciones. Requieren autorización final productiva.

1. Releer versión/deployment/tráfico de `docentetuc` y detenerse si ya no coinciden con la referencia de arriba. Verificar árbol limpio y `codeSha` del manifiesto, hashes de fuentes/artefactos y los documentos preservados. Inspeccionar disparadores push antes de publicar una rama nueva, sin modificar default ni automatizaciones existentes.
2. Publicar exclusivamente el candidato final a una rama identificable, sin force. Desde este worktree: `$juntasCandidate = git rev-parse HEAD`, comprobarlo contra `codeSha` y, si la rama destino está libre, `git push origin "${juntasCandidate}:refs/heads/release/juntas-production-reconciled-20261126"`. Releer el SHA remoto. Esto no registra ni activa el workflow en default.
3. Renovar identidad/esquema/checkpoints y ausencia de concesiones de D1 productiva. Obtener bookmark de Time Travel y respaldo público Juntas acotado, probar recuperación local y comparar equivalencias documentales. No reutilizar como actual el respaldo del 22/11. Detenerse ante duplicados ambiguos: título igual no acredita equivalencia. Contabilizar cualquier consulta oficial adicional dentro de las 25 HTTP de la recuperación autorizada.
4. Aplicar sólo el archivo 0100, tras compatibilidad y recuperación verificadas: `npx wrangler d1 execute docentetuc-db --remote --config wrangler.juntas-production.jsonc --file migrations/0100_juntas_document_revisions.sql --json`. No ejecutar `d1 migrations apply` sobre el directorio. Comprobar objetos, filas previas e integridad.
5. Desplegar exclusivamente el receptor independiente inicialmente cerrado con `npx wrangler deploy --config wrangler.juntas-production.jsonc`. La configuración tiene workers.dev deshabilitado, sin Cron, habilitación false y lease obligatorio. Antes de una recuperación se requiere credencial independiente, exposición temporal autenticada, identidad verificada y cierre independiente disponible. No copiar secretos productivos ni simular un run-ID GitHub para un ejecutor local.
6. Realizar únicamente la recuperación expresamente autorizada: hasta 25 solicitudes HTTP oficiales reales y 20 intentos de publicación, checkpoints propios reanudados, sin copiar estado de Canary, sin borrar ausencias, sin notificaciones. Detener ante ACK ambiguo, autenticación, integridad, CPU o cuota incompatible. Registrar equivalencias/IDs/hashes, ACK y recursos. Cerrar concesión y verificar ausencia de leases antes de retirar credencial y exposición temporal. Código publicado no equivale a documentos recuperados.
7. Subir el artefacto Web nuevo sin cambiar tráfico: `npx wrangler versions upload --config .wrangler/juntas-production-prep/web-upload.json --keep-vars`. Registrar la nueva versión y comprobar bindings y conservación de secretos. El config de upload omite vars, triggers y preview_urls y conserva keep_vars. No usar un despliegue general con el config productivo que reescriba Cron.
8. Una vez superadas las comprobaciones anteriores, realizar el único cambio de tráfico: `npx wrangler versions deploy NUEVA_VERSION@100 --config .wrangler/juntas-production-prep/traffic-only.json --yes`. `NUEVA_VERSION` es exclusivamente el ID devuelto por el upload verificado; no es un valor ejecutable literal. El config traffic-only contiene únicamente nombre/cuenta, sin settings que reescribir.
9. Verificar producción: DDJJ PDF/Word y Trámites/Licencias; Padrones y Comunicados, definitivos/históricos/referencias, fechas/enlaces/paginación/historial; módulos estables y automatizaciones existentes; CPU individual disponible, tráfico 100 %, concesiones cerradas y PARTIAL conservado. No se considera aprobado por el mero éxito del upload.

## Recuperación

Rollback exclusivo de código: `npx wrangler versions deploy 6fb7a6a2-1552-4e43-9e2d-9d054e370419@100 --config .wrangler/juntas-production-prep/traffic-only.json --yes`. Releer versión/tráfico y comprobar DDJJ. No utilizar la referencia antigua `e7d07d08`.

El rollback del Worker no revierte D1. 0100 es aditiva: no eliminar historial automáticamente ni restablecer indiscriminadamente toda la base. Ante una escritura problemática, cerrar nuevas importaciones, mantener el mecanismo de cierre autenticado, conservar evidencia y conciliar exclusivamente IDs/hashes de la operación frente al respaldo fresco, preservando revisiones y datos concurrentes de otros módulos. No ejecutar un restore general de Time Travel como reacción automática.

## Dictamen y límites

**Candidato reconciliado y validado localmente, listo para solicitar autorización final de publicación.** No hay nueva validación remota ni medición de CPU productiva en esta tarea. La recuperación documental sigue condicionada a equivalencias, preflight vivo y presupuesto; no se afirma cobertura completa. Cron, notificaciones, credenciales y recursos remotos permanecen sin cambios.
