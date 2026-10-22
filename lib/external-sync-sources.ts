const sourceNames = {
  SIME: ["SIME"],
  FDCI: ["Capacitación Docente"],
  JUNTAS: ["Padrones y Comunicados"],
  CENET: ["CeNET / INET"],
  INFD: ["INFoD / AulaS-TIC"],
} as const;

// A bad cutover setting must stop the sync, never silently re-enable a legacy writer.
export function externalSyncSources(value: string | undefined, fdciMode: string | undefined) {
  const names = new Set<string>();
  for (const raw of (value || "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const key = raw.toUpperCase() as keyof typeof sourceNames;
    if (!Object.hasOwn(sourceNames, key)) throw new Error("EXTERNAL_SYNC_SOURCES_INVALID");
    for (const name of sourceNames[key]) names.add(name);
  }
  if (fdciMode === "external") names.add("Capacitación Docente");
  return names;
}
