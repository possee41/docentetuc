# DocenteTuc

PWA para Android y web que organiza información pública de SIME, Capacitación Docente y Padrones/Comunicados de Tucumán.

## Desarrollo

```bash
pnpm install
pnpm db:generate
pnpm dev
```

La aplicación usa D1 mediante el binding `DB`. El acceso alojado se apoya en la identidad autenticada de Sites; no gestiona contraseñas de SIME ni de otros sistemas oficiales.

## DocenteTuc IA

El asistente funciona exclusivamente desde el backend y admite OpenAI o Gemini. Para activarlo en el entorno de despliegue se requieren estas variables:

```text
AI_PROVIDER=openai
AI_API_KEY=clave_del_proveedor
AI_MODEL=modelo_habilitado_en_la_cuenta
```

`AI_PROVIDER` también puede ser `gemini`. La clave nunca debe agregarse al frontend ni a variables públicas. Si falta cualquiera de estos valores, la API responde que el asistente todavía no está configurado y no genera respuestas simuladas.

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
