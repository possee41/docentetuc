// Public identity only: never include account data or operational credentials.
export const SITE_NAME = "DocenteTuc";
export const SITE_URL = "https://docentetuc.com.ar";
export const SITE_TITLE = "DocenteTuc | Información y herramientas para docentes de Tucumán";
export const SITE_DESCRIPTION = "Aplicación gratuita para docentes de Tucumán. Consultá designaciones, capacitaciones, padrones y noticias, y organizá tu agenda en un solo lugar.";

export const SITE_OPEN_GRAPH = {
  type: "website" as const,
  locale: "es_AR",
  siteName: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  images: [{ url: `${SITE_URL}/icon-512.png`, width: 512, height: 512, alt: SITE_NAME }],
};

export const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  alternateName: "DocenteTuc — Tucumán",
  url: `${SITE_URL}/`,
  inLanguage: "es-AR",
  description: SITE_DESCRIPTION,
};
