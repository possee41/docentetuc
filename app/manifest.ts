import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DocenteTuc",
    short_name: "DocenteTuc",
    description: "Información pública docente de Tucumán, organizada en un solo lugar.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#eef8ff",
    theme_color: "#062b55",
    lang: "es-AR",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
