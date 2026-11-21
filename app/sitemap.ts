import type { MetadataRoute } from "next";

const baseUrl = "https://docentetuc.com.ar";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/privacidad", "/eliminar-datos"].map((path) => ({
    url: `${baseUrl}${path}`,
  }));
}
