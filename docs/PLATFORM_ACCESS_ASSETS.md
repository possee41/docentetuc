# Assets de plataformas y accesos oficiales

Recursos consultados el 2026-10-05 en páginas y dominios oficiales. Las conversiones locales se hicieron en WebP lossless, sin redibujar ni alterar el contenido visual.

## SIME y FDCI

Ambos portales enlazan un favicon institucional con el escudo provincial. No se encontró un logotipo propio de SIME o FDCI en el encabezado de las páginas consultadas. Los favicon son servidos desde cada dominio oficial y sus imágenes de 256×256, al renderizarse, son idénticas; por eso se conserva una sola copia:

- Asset local: `public/assets/platforms/tucuman-education-emblem.webp` (256×256, WebP lossless).
- SIME: página oficial `https://sime.educaciontuc.gov.ar/Login/Login`; `<link rel="icon" href="/Recursos/Content/imagenes/icogob.ico">`.
- FDCI: página oficial `https://capacitaciondocente.educaciontuc.gov.ar/docentes`; `<link rel="icon" href="/favicon.ico">`.
- No se utilizó `direccion_informatica_new_blanco.png`: el portal lo identifica como “Dirección de Informática”, no como marca de SIME.

## INFoD / AulaS-TIC

Se usa el logotipo propio de INFoD presente en el encabezado del campus oficial, no la marca ministerial que también aparece allí:

- Asset local: `public/assets/platforms/infod-logo.webp` (105×35, WebP lossless).
- Página oficial consultada: `https://aulastic.infd.edu.ar/acceso.cgi`.
- Recurso referenciado en el encabezado: `https://aulastic.infd.edu.ar/skins/redinfod/img/comunes/logo_infd.png` (`alt="Logo INFD"`).

Las URLs de ingreso de la aplicación permanecen sin cambios: SIME, FDCI e INFoD conservan sus destinos oficiales ya configurados.
