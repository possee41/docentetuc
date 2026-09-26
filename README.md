# DocenteTuc

PWA para Android y web que organiza información pública de SIME, Capacitación Docente y Padrones/Comunicados de Tucumán.

## Desarrollo

```bash
pnpm install
pnpm db:generate
pnpm dev
```

La aplicación usa D1 mediante el binding `DB`. El acceso alojado se apoya en la identidad autenticada de Sites; no gestiona contraseñas de SIME ni de otros sistemas oficiales.

## Verificación

```bash
pnpm test
pnpm build
```

## Android

El proyecto Android mínimo está en `android/` y abre la versión publicada de DocenteTuc en un WebView seguro.

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

El script descarga una toolchain portátil y genera `DocenteTuc-1.0.5-debug.apk`. Esta variante está firmada para pruebas; una publicación en Google Play requiere una clave privada de lanzamiento y un archivo AAB.

La investigación de fuentes está en [`docs/FUENTES.md`](docs/FUENTES.md).
