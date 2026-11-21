// Defaults to the published 1.1 behavior until an explicit, coordinated cutover.
export const fdciLegacyEnabled = (mode?: string) => mode !== "external";
