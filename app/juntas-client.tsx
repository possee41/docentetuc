"use client";

import dynamic from "next/dynamic";

// Junta records already load through paginated public APIs. Rendering the empty
// application on the server repeats React/Intl work without rendering documents.
const JuntasApp = dynamic(() => import("./docente-app"), {
  ssr: false,
  loading: () => <main aria-busy="true"><h1>DocenteTuc · Juntas</h1><p role="status">Cargando documentos oficiales…</p><noscript>Activá JavaScript para consultar Padrones y Comunicados, o visitá <a href="https://padrones.educaciontuc.gov.ar/">el portal oficial de Juntas</a>.</noscript></main>,
});

export default function JuntasClient({ section }: { section: "padrones" | "comunicados" }) {
  return <JuntasApp key={section} initialSection={section} />;
}
