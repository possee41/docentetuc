export const TUCUMAN_CIRCUITS = [
  { id: "I", departments: ["Burruyacú", "Cruz Alta", "Leales"] },
  { id: "II", departments: ["Capital", "San Miguel de Tucumán"] },
  { id: "III", departments: ["Trancas", "Yerba Buena", "Tafí Viejo", "Lules"] },
  { id: "IV", departments: ["Tafí del Valle", "Famaillá", "Monteros", "Simoca"] },
  { id: "V", departments: ["Chicligasta", "Río Chico", "Juan Bautista Alberdi", "La Cocha", "Graneros"] },
] as const;

export type CircuitId = typeof TUCUMAN_CIRCUITS[number]["id"];
export type CircuitValue = CircuitId | "MULTIPLE" | "ALL" | "UNKNOWN";
export type CircuitInferenceSource = "explicit" | "department" | "locality" | "unknown";
export type CircuitInference = { sourceCircuitRaw: string; normalizedCircuit: CircuitValue; circuits: CircuitId[]; circuitInferenceSource: CircuitInferenceSource; circuitConfidence: number };

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const circuitNumber: Record<string, CircuitId> = { i: "I", ii: "II", iii: "III", iv: "IV", v: "V", "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V" };
const containsPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${normalize(phrase)} `);

function explicitCircuits(value: string) {
  const text = normalize(value), found = new Set<CircuitId>();
  const token = "(?:iv|iii|ii|i|v|[1-5])";
  const bareCircuitList = new RegExp(`^${token}(?:\\s*(?:,|y|e|;|·)\\s*${token})*$`);
  const circuitLists = new RegExp(`\\bcircuit(?:o|os)\\s+(${token}(?:\\s*(?:,|y|e)\\s*${token})*)`, "g");
  if (bareCircuitList.test(text)) {
    for (const item of text.match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id = circuitNumber[item];
      if (id) found.add(id);
    }
  }
  for (const match of text.matchAll(circuitLists)) {
    for (const item of match[1].match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id = circuitNumber[item];
      if (id) found.add(id);
    }
  }
  return [...found];
}

function departmentsIn(value: string) {
  const text = normalize(value), found = new Set<CircuitId>();
  for (const circuit of TUCUMAN_CIRCUITS) {
    if (circuit.departments.some((department) => containsPhrase(text, department))) found.add(circuit.id);
  }
  return [...found];
}

const result = (sourceCircuitRaw: string, circuits: CircuitId[], circuitInferenceSource: CircuitInferenceSource): CircuitInference => ({
  sourceCircuitRaw,
  normalizedCircuit: circuits.length === 0 ? "UNKNOWN" : circuits.length === 1 ? circuits[0] : "MULTIPLE",
  circuits,
  circuitInferenceSource,
  circuitConfidence: circuitInferenceSource === "explicit" ? 100 : circuitInferenceSource === "department" ? 90 : circuitInferenceSource === "locality" ? 75 : 0,
});

export function inferCircuit(input: { explicit?: string; department?: string; locality?: string }): CircuitInference {
  const explicit = input.explicit?.trim() || "";
  const rawCircuits = explicitCircuits(explicit);
  if (rawCircuits.length) return result(explicit, rawCircuits, "explicit");
  if (/\b(todos? los circuitos|toda la provincia|provincial|para toda la provincia)\b/.test(normalize(explicit))) return { sourceCircuitRaw: explicit, normalizedCircuit: "ALL", circuits: [], circuitInferenceSource: "explicit", circuitConfidence: 100 };

  const department = input.department?.trim() || "";
  const fromDepartment = departmentsIn(department);
  if (fromDepartment.length) return result(department, fromDepartment, "department");

  const locality = input.locality?.trim() || "";
  const fromLocality = departmentsIn(locality);
  if (fromLocality.length) return result(locality, fromLocality, "locality");

  return result(explicit || department || locality, [], "unknown");
}

export function profileCircuitIds(values: string[] = []): CircuitId[] {
  const found = new Set<CircuitId>();
  for (const value of values) {
    const normalized = normalize(value);
    const explicit = explicitCircuits(normalized.replace(/^(?!circuito)/, "circuito "));
    for (const circuit of explicit) found.add(circuit);
    const bare = circuitNumber[normalized];
    if (bare) found.add(bare);
  }
  return [...found];
}

export function circuitMatches(publication: CircuitInference | { circuit?: string; circuits?: string[] }, profileCircuits: string[]) {
  const wanted = profileCircuitIds(profileCircuits);
  if (!wanted.length) return true;
  const actualValue = "normalizedCircuit" in publication ? publication.normalizedCircuit : publication.circuit;
  const actual = "circuits" in publication ? publication.circuits || [] : [];
  if (actualValue === "ALL") return true;
  if (actualValue === "UNKNOWN" || !actual.length && !actualValue) return null;
  const resolved = actual.length ? profileCircuitIds(actual) : profileCircuitIds([String(actualValue)]);
  if (!resolved.length) return null;
  return resolved.some((circuit) => wanted.includes(circuit));
}
