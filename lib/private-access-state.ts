export type InstallationSecurity = "protected" | "linked" | "recovery_required" | "unavailable";
export type PrivateAccessStatus = "checking" | "ready" | "unauthorized" | "error";

// Installation proof and account access are separate checks. Only the private API
// can confirm access; a missing device proof must not pre-empt its pending result.
export function privateAccessState(bootstrapComplete: boolean, installation: InstallationSecurity, access: PrivateAccessStatus) {
  if (access === "ready") return "ready";
  if (!bootstrapComplete || access === "checking") return "checking";
  if (access === "error" || installation === "unavailable") return "error";
  return installation === "recovery_required" ? "recovery_required" : "unauthorized";
}
