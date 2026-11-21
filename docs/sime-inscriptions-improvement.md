# Mejora de Inscripciones SIME — Informe

Fecha: 2026-11-13
Rama: feat/sime-inscriptions-improvement

---

## 1. Cambios implementados

### 1.1 Eliminación del filtro de circuitos en Inscripciones SIME

**Archivo:** `app/docente-app.tsx`

**Cambio:** Se eliminó la línea que filtraba vacantes por circuito territorial:
```diff
- if (view === "vacantes" && designationCircuit !== "todos") items = items.filter((item) => publicationCircuitMatch(item, designationCircuit));
+ // Circuito territorial eliminado de Inscripciones SIME: la fuente no informa circuito de forma confiable y el filtro excluía oportunidades compatibles.
```

**También se eliminó:**
- El `Select` de circuito en el panel de filtros de vacantes (línea 1005).
- La referencia a circuito en `activeFilterCount` para vacantes.
- `setCircuit("todos")` en `clearDesignationFilters` y `onClearFilters`.
- `circuit` prop ahora solo se pasa para capacitaciones.

**Motivo:** SIME no informa el circuito de forma confiable. El filtro excluía oportunidades compatibles sin beneficio real.

### 1.2 Búsqueda por palabras (word-by-word)

**Archivo:** `app/docente-app.tsx`

**Cambio:** La búsqueda ahora divide el término en palabras y verifica que TODAS estén presentes en el texto de la publicación:
```diff
- const term = normalizeSearchText(activeSearch); items = items.filter((item) => normalizeSearchText(publicationSearchText(item)).includes(term));
+ const words = normalizeSearchText(activeSearch).split(" ").filter(Boolean); items = items.filter((item) => { const text = normalizeSearchText(publicationSearchText(item)); return words.every((word) => text.includes(word)); });
```

**Motivo:** La búsqueda anterior requería el término exacto como substring. Ahora "maestro jardin" encuentra "Maestro de Jardín" aunque haya palabras intermedias.

**Campos buscables:** title (cargo), area (materia), location (establecimiento), summary, level, junta, character, category, source, metadata.

---

## 2. Problemas pendientes (para transferir a Codex)

### 2.1 "Para mí" excluye oportunidades con datos desconocidos

**Causa:** `isEligibleMatchResult` (lib/matching.ts línea 134) requiere `confidence >= 70`. Cuando datos son desconocidos (circuit, shift, location), la confianza baja y la oportunidad se excluye del "Para mí".

**Evidencia:**
- Test línea 117-122: "circuito desconocido no reduce compatibilidad, pero sí la confianza" → confidence=67, outcome=UNKNOWN
- Test línea 146-154: "una designación con sólo dos datos conocidos no muestra una compatibilidad confirmada" → confidence=67, excluida

**Impacto:** Oportunidades SIME que coinciden en materia y cargo pero tienen circuito desconocido no aparecen en "Para mí".

**Propuesta de fix (no implementado):** Cambiar `isEligibleMatchResult` para incluir oportunidades con `outcome === "UNKNOWN"` si tienen al menos 2 criterios conocidos que coinciden y ningún mismatch explícito.

**Riesgo:** Cambiaría el comportamiento de 3 tests existentes. Requiere validación cuidadosa.

### 2.2 Filtro de compatibilidad en vacantes

El filtro de compatibilidad (high/good/partial/low/unknown) no se aplica a vacantes (solo a capacitaciones). Esto es por diseño (línea 464 solo aplica a capacitaciones), pero podría ser útil para vacantes también.

---

## 3. Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| TypeScript compilation | ✅ Sin errores |
| lib/matching.test.ts | ✅ 20 tests pasan |
| lib/personalized-catalog.test.ts | ✅ Pasan |
| lib/publication-search.test.ts | ✅ Pasan |

## 4. Regresiones evitadas

- El filtro de circuitos sigue activo para capacitaciones (línea 471, sin cambios).
- Los tabs "Todas" y "Finalizadas" no se modificaron.
- Los filtros de junta y carácter siguen activos para vacantes.
- La búsqueda mejorada es retrocompatible (word-by-word es más permisivo que substring).

## 5. Archivos modificados

| Archivo | Cambio |
|---|---|
| `app/docente-app.tsx` | Eliminado filtro de circuito en vacantes, búsqueda word-by-word, eliminado Select de circuito, actualizado activeFilterCount y clearFilters |

## 6. Lo que NO se modificó

- `lib/matching.ts` (lógica de matching, requiere análisis más profundo)
- `lib/personalized-filters.ts` (publicationSearchText, publicationCircuitMatch)
- `lib/personalized-catalog.ts` (eligiblePersonalPublication)
- Módulos de capacitaciones, noticias, admin, FDCI, SIME importador

## 7. Recomendación

Los cambios implementados (eliminar circuito, mejorar búsqueda) son simples y seguros. El problema de "Para mí" con datos desconocidos es más complejo y se recomienda transferirlo a Codex para un análisis más profundo de la lógica de matching.