import type { NewsImage } from "./news-editorial.ts";

export type PublicNewsImage = {
  url: string; alt: string; credit: string; sourceUrl: string;
  kind: "credited" | "illustration";
};

const library = {
  training: { file: "training.svg", alt: "Ilustración de materiales de formación docente" },
  designation: { file: "designation.svg", alt: "Ilustración de un tablero de designaciones" },
  boards: { file: "boards.svg", alt: "Ilustración de comunicados y padrones" },
  regulations: { file: "regulations.svg", alt: "Ilustración de documentos normativos" },
  education: { file: "education.svg", alt: "Ilustración de educación general" },
  union: { file: "union.svg", alt: "Ilustración de diálogo y actualidad gremial" },
  technology: { file: "technology.svg", alt: "Ilustración de tecnología educativa" },
  general: { file: "general.svg", alt: "Ilustración institucional de actualidad educativa" },
} as const;

export type NewsImageCategory = keyof typeof library;

export function newsImageCategory(topic: string | null, sourceType: string): NewsImageCategory {
  const value = (topic || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/tecnolog|digital|dron|robot|inteligencia artificial|\btic\b/.test(value)) return "technology";
  if (/capacit|curso|formacion|taller|congreso|primeros auxilios|\brcp\b/.test(value)) return "training";
  if (/designacion|cobertura|\bsime\b|vacante|inscripcion/.test(value)) return "designation";
  if (/junta|padron|comunicado|llamado/.test(value)) return "boards";
  if (/resolucion|normativa|decreto|circular|reglament/.test(value)) return "regulations";
  if (/gremi|sindic|\batep\b|paro|salario/.test(value) || sourceType === "union") return "union";
  if (/educacion|escuela|docente|secundaria|primaria/.test(value)) return "education";
  return "general";
}

export function publicNewsImage(credited: NewsImage | null, topic: string | null, sourceType: string): PublicNewsImage {
  if (credited) return { url: credited.url, alt: credited.alt, credit: credited.credit,
    sourceUrl: credited.sourceUrl, kind: "credited" };
  const category = newsImageCategory(topic, sourceType);
  const art = library[category];
  return { url: `/assets/news-editorial/${art.file}`,
    alt: `${art.alt}; no representa el hecho informado.`,
    credit: "Gráfica ilustrativa de DocenteTuc",
    sourceUrl: "/assets/news-editorial/provenance.json", kind: "illustration" };
}
