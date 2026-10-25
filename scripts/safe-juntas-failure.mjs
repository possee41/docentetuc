const categories = new Set(["Padrones", "Comunicados", "Llamados abiertos"]);
const technical = (value) => typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined;

export function safeJuntasFailures(failures) {
  return (Array.isArray(failures) ? failures : []).map((item) => ({
    category: categories.has(item.category) ? item.category : "Desconocida",
    code: technical(item.code) || "SOURCE_ERROR",
    rootId: technical(item.rootId),
    id: technical(item.id),
    bodyBytes: Number.isSafeInteger(item.bodyBytes) ? item.bodyBytes : undefined,
    summaryBytes: Number.isSafeInteger(item.summaryBytes) ? item.summaryBytes : undefined,
    metadataBytes: Number.isSafeInteger(item.metadataBytes) ? item.metadataBytes : undefined,
  }));
}
