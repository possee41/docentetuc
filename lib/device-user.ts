export function deviceUser(deviceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(deviceId)) return null;
  return { userId: `device:${deviceId}`, email: "", fullName: "Docente", displayName: "Docente" };
}
