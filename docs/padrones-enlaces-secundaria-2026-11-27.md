# Enlace individual de Padrones Secundaria — 27/11/2026

## Hallazgo concreto

Registro productivo: `drive:pad-secundaria:1NdgFtOpLdWN33RETK0wY5Z5AkayO615H`.

Título: **PADRON DEFINITIVO DE ANTECEDENTES ASCENSO DE JERARQUIA EN TITULARIDAD 2026.pdf**.

El `external_id` coincide con el ID de la URL almacenada: [enlace original](https://drive.google.com/file/d/1NdgFtOpLdWN33RETK0wY5Z5AkayO615H/view). No hay un error de concatenación ni se está abriendo el ID de una carpeta como si fuera un PDF.

El navegador mostró «Necesitas acceso». Una consulta de metadatos Drive con clave de API, sin OAuth de usuario, devolvió **404** para ese ID. La carpeta antigua homónima `1PYDAXLnhRICiHZsTNrjpCtId6m1VZM2R` también mostró «Necesitas acceso».

La [carpeta oficial actual de Ascenso de Jerarquía](https://drive.google.com/drive/folders/1-Vnz9r_0kvEmvGRcd3xwT2xX1DBPLMBf), dentro de los Definitivos 2026 con resolución aprobatoria, es accesible y su metadato público devuelve HTTP 200. Contiene:

- [DIRECTOR - VICEDIRECTOR](https://drive.google.com/drive/folders/1ZgBo6CtkBTg1EQzz_aXr8-4bUfEaYqSt): cinco PDF, CIRCUITO I–V.
- [SUPERVISOR](https://drive.google.com/drive/folders/1xL_jnMxywK46BMymo5x06dQ7MFeSDHzA): cinco PDF, CIRCUITO I–V.

Todos tienen IDs distintos del registro productivo. Los diez IDs observados, en orden I–V por rama:

| Circuito | Director/Vicedirector | Supervisor |
|---|---|---|
| I | `1xmGIMUQC2qkchIs88F5V1ltCnhZAXhi5` | `1puF0iEZQBDxrYEXGkPZGHL_Rn5YrsK7N` |
| II | `1VC5t0fe5V0gIrKmo8W8Hc0zNaKOWt1DN` | `1PW6utr7RkDBI-QL329OXBhYSOuw7pXgP` |
| III | `1X0B9l_ani86FLMsY-vJhX_TgjqSYPyA_` | `1NOLWsg_EP4-UkWJTT6p9iFLKvzWKGGic` |
| IV | `1N6orueom9EIN_DNvkpGx58IZMaBQjRFk` | `1AOnReh5NwIQ6u5cHYMHKi67MfDtwDY_h` |
| V | `1ulqn-4jJa3F__6iayGO8UfOAfatGfDXt` | `1a94YeWhdZFmfyKHJIUH8LNHxltlouWy4` |

Como control, el metadato público del actual CIRCUITO I de Director/Vicedirector devolvió HTTP 200, MIME PDF, `trashed=false`, modificación `2026-11-25T17:50:59.745Z` y MD5 `54c5ead461236852a195ddb54d91f577`. No se descargaron ni examinaron listados docentes.

**Conclusión:** referencia individual antigua actualmente inaccesible, mientras la fuente actual publica documentos distintos por circuito. Drive no permite distinguir con estas lecturas si el original fue retirado/eliminado o si se restringieron sus permisos; un 404 con API key también oculta archivos no públicos. No hay evidencia de equivalencia para sustituir el PDF antiguo por uno de los diez actuales. La carpeta accesible no prueba que cada PDF tenga los mismos permisos.

## Corrección mínima preparada, no aplicada

1. Conservar ID, URL original, año, carácter e historial del registro antiguo.
2. Registrar el acceso comprobado como `official.facts.documentAccess=unavailable` y la carpeta alternativa verificada como `documentFolder`, con evidencia. No declarar «restringido» ni «reemplazado» como hechos no demostrados.
3. En tarjeta y detalle, omitir el enlace directo conocido como inaccesible, mostrar un mensaje contextual y el botón **«Carpeta oficial — no es enlace directo al PDF»**.
4. No modificar otros enlaces sin una comprobación específica. No inferir disponibilidad por antigüedad, año ni permisos de la carpeta.

Se preparó `padrones-enlace-secundaria-propuesta-2026-11-27.json`: un único payload del receptor existente, preservando ID/URL y actualizando metadatos/resumen y hash coherentemente. Contiene precondiciones de hash actual para revalidar antes de cualquier futura escritura. **No se envió**. La corrección visual necesita tanto el código como esa actualización puntual aprobados; desplegar solo el código no marca automáticamente el registro antiguo.

## Importador y cambios de carpeta

`driveReference()` en `scripts/import-juntas-checkpoint.mjs` construye la URL con el ID real y conserva `resourceKey` en la URL individual. Los ancestros y sus claves se actualizan por separado; no se inventa un ID nuevo por mover el archivo. Cambiar un archivo de carpeta conservando ID no altera su URL directa. Un archivo recreado con ID diferente se considera otro documento y requiere su evidencia; no se concilia por nombre de circuito solamente.

No fue necesario modificar el importador. Se agregó una prueba local de dos recorridos pequeños: mover el mismo PDF entre carpetas mantuvo su ID, URL y resource key, produjo cero altas en el segundo recorrido y una publicación sin cambios, con una sola fila final.

## Validación y límites

- 14/14 pruebas focalizadas del lector, enlaces, históricos y clasificación aprobadas.
- 1/1 prueba focalizada del importador sobre SQLite local aprobada. No se ejecutó su caso masivo de 4067 documentos ni la suite general.
- TypeScript, ESLint y build aprobados.
- Lecturas oficiales: navegación de carpetas y tres GET de metadatos Drive. Sin OAuth de Drive, descarga de PDF, cambios de permisos ni solicitudes de acceso.
- Sin despliegues, importaciones, concesiones, migraciones o escrituras D1. Se conserva el informe operativo anterior sin incorporarlo a este cambio.
