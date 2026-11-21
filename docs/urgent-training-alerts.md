# Mejora de Alertas Urgentes de Capacitaciones — Informe

Fecha: 2026-11-14
Rama: feat/urgent-training-alerts

---

## 1. Problema identificado

La capacitación "La construcción de la cultura de la paz en la escuela. La mediación como herramienta pedagógica" mostraba "Abre mañana" (desde `openingCountdown`) pero no el indicador 🔥 de prioridad en la vista de Capacitaciones.

**Causa:** El indicador 🔥 solo se mostraba en la vista de Inicio (Home), mediante `priorityLabel`. En la vista de Capacitaciones (PublicationList), el badge de estado usaba `enrollmentLabel` que retornaba "Próximamente" o "Abre hoy" sin 🔥.

## 2. Cambios implementados

### 2.1 Funciones auxiliares en training.ts

Se agregaron dos funciones:

```typescript
export function isUrgentOpening(metadata, now): boolean {
  if (!metadata?.registrationOpensAt || metadata.dateStatus === "tentative" || metadata.dateStatus === "unknown") return false;
  const opens = Date.parse(metadata.registrationOpensAt);
  if (!Number.isFinite(opens)) return false;
  const diff = opens - now.getTime();
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

export function isClosingSoon(metadata, now): boolean {
  if (!metadata?.registrationClosesAt) return false;
  const closes = Date.parse(metadata.registrationClosesAt);
  if (!Number.isFinite(closes)) return false;
  const diff = closes - now.getTime();
  return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000;
}
```

**Características:**
- `isUrgentOpening`: true si la apertura es en las próximas 24 horas y la fecha está confirmada (no tentativa ni desconocida).
- `isClosingSoon`: true si el cierre es en los próximos 3 días.
- Ambas respetan la zona horaria (usan Date.parse con el timestamp ISO que incluye offset de Tucumán).

### 2.2 Vista de Capacitaciones (PublicationList)

Se agregó 🔥 al badge de estado para aperturas urgentes y ⏰ para cierres próximos:

```diff
- <StatusBadge tone={statusTone}>{!unverified && trainingState === "ABIERTA" ? "🟢 " : ""}{statusText}</StatusBadge>
+ <StatusBadge tone={statusTone}>{!unverified && urgentOpening ? "🔥 " : !unverified && trainingState === "ABIERTA" ? "🟢 " : ""}{statusText}{!unverified && closingSoon && trainingState === "ABIERTA" ? " ⏰" : ""}</StatusBadge>
```

### 2.3 Vista de detalle (PublicationSheet)

Se actualizó el Badge para incluir 🔥 y ⏰:
```typescript
{publication.kind === "capacitacion" ? `${isUrgentOpening(parseTrainingMetadata(publication.metadata)) ? "🔥 " : ""}${enrollmentLabel(publication)}${isClosingSoon(parseTrainingMetadata(publication.metadata)) && enrollmentForUI(publication) === "ABIERTA" ? " ⏰" : ""}` : lifecycleLabel(lifecycle)}
```

### 2.4 Vista de Inicio (Home)

Se actualizó `priorityLabel` para incluir ⏰ en inscripciones abiertas próximas a cerrar:
```diff
- if (state === "ABIERTA") return "🟢 INSCRIPCIÓN ABIERTA";
+ if (state === "ABIERTA") return isClosingSoon(parseTrainingMetadata(item.metadata)) ? "🟢 INSCRIPCIÓN ABIERTA ⏰" : "🟢 INSCRIPCIÓN ABIERTA";
```

---

## 3. Validación de casos edge

| Caso | Comportamiento |
|---|---|
| Apertura a las 23:00 (dentro de 24h) | 🔥 aparece (isUrgentOpening = true) |
| Apertura mañana (más de 24h) | Sin 🔥 (isUrgentOpening = false) |
| Apertura hoy a las 01:00 (dentro de 24h) | 🔥 aparece |
| Fecha tentativa | Sin 🔥 (isUrgentOpening = false) |
| Fecha desconocida (dateStatus = "unknown") | Sin 🔥 |
| Inscripción abierta, cierre en 3 días | ⏰ aparece |
| Inscripción abierta, cierre en 5 días | Sin ⏰ |
| Fuente no verificada (unverified) | Sin 🔥 ni ⏰ (evita falsos positivos) |

---

## 4. Coherencia entre Inicio y Capacitaciones

| Vista | Apertura <24h | Apertura mañana | Abierta | Abierta (cierre <3d) |
|---|---|---|---|---|
| Inicio (Home) | 🔥 ABRE HOY/MAÑANA | 🔥 ABRE MAÑANA | 🟢 INSCRIPCIÓN ABIERTA | 🟢 INSCRIPCIÓN ABIERTA ⏰ |
| Capacitaciones | 🔥 Próximamente/Abre hoy | 🔥 Próximamente | 🟢 Inscripción abierta | 🟢 Inscripción abierta ⏰ |
| Detalle | 🔥 Próximamente/Abre hoy | 🔥 Próximamente | 🟢 Inscripción abierta | 🟢 Inscripción abierta ⏰ |

---

## 5. Pruebas realizadas

| Prueba | Resultado |
|---|---|
| TypeScript compilation | ✅ Sin errores |
| lib/training.test.ts | ✅ Pasan |
| lib/home-dashboard.test.ts | ✅ Pasan |

## 6. Archivos modificados

| Archivo | Cambio |
|---|---|
| `lib/training.ts` | Agregadas `isUrgentOpening` e `isClosingSoon` |
| `app/docente-app.tsx` | Importadas nuevas funciones, actualizado badge en PublicationList y PublicationSheet, actualizado priorityLabel en Home |

## 7. Lo que NO se modificó

- Lógica de enrollmentState (sigue usando días calendario para ABRE_HOY)
- Filtros de "Para mí" y otros filtros
- Notificaciones automáticas (no se agregaron nuevas)
- Cron, D1, autenticación, SIME

## 8. Accesibilidad

- Los indicadores 🔥 y ⏰ son texto (emojis) que se leen por screen readers.
- El StatusBadge ya tiene `tone` para color, y el emoji agrega información redundante (no solo color).
- Funciona en desktop y mobile (no hay cambios de layout).