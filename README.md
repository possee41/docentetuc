# DocenteTuc

PWA para Android y web que organiza información pública de SIME, Capacitación Docente y Padrones/Comunicados de Tucumán.

## Desarrollo

```bash
pnpm install
pnpm db:generate
pnpm dev
```

La aplicación usa D1 mediante el binding `DB`. Cuando Sites aporta una identidad autenticada, se usa esa identidad; en el Worker público, los datos personales se asocian a un identificador local de dispositivo. Esto **no** equivale a una cuenta docente sincronizada entre dispositivos ni a iniciar sesión en SIME, FDCI u otros sistemas oficiales. DocenteTuc no gestiona sus contraseñas.

## DocenteTuc IA

El asistente funciona exclusivamente desde el backend y admite OpenAI o Gemini. Para activarlo en el entorno de despliegue se requieren estas variables:

```text
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_API_KEY=
```

La clave nunca debe agregarse al frontend ni a variables públicas. En Cloudflare se configura desde la carpeta del proyecto con `npx wrangler secret put AI_API_KEY --config wrangler.cloudflare.jsonc`. Si falta cualquiera de estos valores, la API responde que el asistente todavía no está configurado y no genera respuestas simuladas.

## Verificación

```bash
pnpm test
pnpm build
```

## Android

El proyecto Android está en `android/` y abre la versión pública de DocenteTuc como Trusted Web Activity (TWA). La verificación del vínculo usa `/.well-known/assetlinks.json` y la huella de la firma Android; requiere un navegador compatible, como Chrome, en el dispositivo.

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

El comando anterior genera `dist/DocenteTuc-debug.apk`, firmado sólo para pruebas. Para generar los artefactos de publicación con la clave local de DocenteTuc:

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1 -Release
```

Produce `dist/DocenteTuc-release.apk` y `dist/DocenteTuc-release.aab`. La clave y la credencial cifrada se guardan fuera del repositorio, en `..\DocenteTuc-signing\`. Hay que respaldar la clave **y** su contraseña fuera de esta PC antes de usarla en Google Play; la credencial cifrada local sólo se puede descifrar con esta cuenta de Windows. Una instalación previa firmada con otra clave no se puede actualizar directamente con esta APK.

La investigación de fuentes está en [`docs/FUENTES.md`](docs/FUENTES.md).
