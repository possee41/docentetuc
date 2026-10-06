import DocenteApp from "./docente-app";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  if (section === "comunidad") redirect("/comunidad");
  return <DocenteApp key={section || "inicio"} initialSection={section} />;
}
