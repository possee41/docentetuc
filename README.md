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

La investigación de fuentes está en [`docs/FUENTES.md`](docs/FUENTES.md).
