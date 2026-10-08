export function needsRecoveryNotice(status: string, bootstrapComplete: boolean, loading: boolean, hasData: boolean): boolean {
  return bootstrapComplete && !loading && status === "recovery_required" && !hasData;
}
