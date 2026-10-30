import DocenteApp from "./docente-app";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SITE_OPEN_GRAPH, SITE_URL, WEBSITE_JSON_LD } from "@/lib/site-identity";

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: { ...SITE_OPEN_GRAPH, url: `${SITE_URL}/` },
};

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  if (section === "comunidad") redirect("/comunidad");
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD).replace(/</g, "\\u003c") }} />
    <DocenteApp key={section || "inicio"} initialSection={section} />
  </>;
}
