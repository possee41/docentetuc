"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2, LogOut, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleAccountPhoto } from "@/components/google-account-photo";
import { installationDeletionConfirmed } from "@/lib/installation-ownership";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type AuthStatus = { configured: boolean; authenticated: boolean; image: string | null; name: string | null };
type LinkPreview = { linked: boolean; hasData: boolean; dataCategories: string[] };

const SIGN_IN_UNAVAILABLE = "El inicio con Google todavía no está configurado.";

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0">
    <path fill="#4285F4" d="M23.49 12.27c0-.74-.07-1.45-.19-2.14H12v4.05h6.44c-.28 1.35-1.02 2.49-2.12 3.26v2.69h3.43c2.01-1.85 3.17-4.58 3.17-7.86z" />
    <path fill="#34A853" d="M12 24c2.97 0 5.46-.98 7.28-2.66l-3.43-2.69c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.98 15.18A6.6 6.6 0 0 1 5.63 13c0-.76.13-1.5.35-2.18V7.98H2.18A11 11 0 0 0 1 13c0 1.78.43 3.45 1.18 4.94l3.8-2.76z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.73 1 4.04 3.45 2.18 7.98l3.8 2.84C6.71 8.19 9.14 5.38 12 5.38z" />
  </svg>;
}

export function AccountSignInSection({ headers, installationSecurity, onLinked, onSignedOut }: { headers: () => HeadersInit; installationSecurity: "protected" | "legacy" | "linked" | "recovery_required" | "unavailable"; onLinked: () => void; onSignedOut: () => void }) {
  const [status, setStatus] = useState<AuthStatus>({ configured: false, authenticated: false, image: null, name: null });
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkChecking, setLinkChecking] = useState(false);
  const [linkDeclined, setLinkDeclined] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteDeviceOpen, setDeleteDeviceOpen] = useState(false);
  const [deleteDeviceConfirmation, setDeleteDeviceConfirmation] = useState("");

  const refreshLinkPreview = useCallback(async () => {
    setLinkChecking(true);
    setLinkError("");
    try {
      const response = await fetch("/api/auth/link", { cache: "no-store", credentials: "same-origin", headers: headers() });
      const value = await response.json().catch(() => ({})) as LinkPreview & { error?: string };
      if (!response.ok) throw new Error(value.error || "No se pudo consultar la vinculación.");
      setLinkPreview(value);
    } catch (error) { setLinkPreview(null); setLinkError(error instanceof Error ? error.message : "No se pudo consultar la vinculación."); }
    finally { setLinkChecking(false); }
  }, [headers]);

  const refresh = async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudo consultar el estado de la cuenta.");
      const value = await response.json() as AuthStatus;
      setStatus({ configured: Boolean(value.configured), authenticated: Boolean(value.authenticated), image: typeof value.image === "string" ? value.image : null, name: typeof value.name === "string" ? value.name : null });
      if (value.authenticated) void refreshLinkPreview();
    } catch {
      setStatus({ configured: false, authenticated: false, image: null, name: null });
    } finally { setChecking(false); }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo consultar el estado de la cuenta.");
        return await response.json() as AuthStatus;
      })
      .then((value) => {
        if (!cancelled) {
          setStatus({ configured: Boolean(value.configured), authenticated: Boolean(value.authenticated), image: typeof value.image === "string" ? value.image : null, name: typeof value.name === "string" ? value.name : null });
          if (value.authenticated) void refreshLinkPreview();
        }
      })
      .catch(() => { if (!cancelled) setStatus({ configured: false, authenticated: false, image: null, name: null }); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [refreshLinkPreview]);

  const signIn = async () => {
    if (!status.configured) { toast.error(SIGN_IN_UNAVAILABLE); return; }
    setBusy(true);
    try {
      const { createAuthClient } = await import("better-auth/react");
      const client = createAuthClient({ baseURL: window.location.origin });
      const result = await client.signIn.social({ provider: "google", callbackURL: window.location.href });
      if (result.error) throw new Error(result.error.message || "No se pudo iniciar sesión con Google.");
      if (result.data?.url) window.location.assign(result.data.url);
      else throw new Error("Google no devolvió una dirección de acceso.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar sesión con Google.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const { createAuthClient } = await import("better-auth/react");
      const client = createAuthClient({ baseURL: window.location.origin });
      const result = await client.signOut();
      if (result.error) throw new Error(result.error.message || "No se pudo cerrar la sesión.");
      setStatus((current) => ({ ...current, authenticated: false, image: null, name: null }));
      setLinkPreview(null);
      setLinkDeclined(false);
      localStorage.removeItem("docentetuc-data-v1");
      onSignedOut();
      window.dispatchEvent(new Event("docentetuc:refresh-auth-status"));
      await refresh();
      toast.success("Sesión cerrada en este dispositivo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cerrar la sesión.");
    } finally { setBusy(false); }
  };

  const linkData = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/link", {
        method: "POST", credentials: "same-origin",
        headers: { ...Object.fromEntries(new Headers(headers()).entries()), "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; alreadyLinked?: boolean };
      if (!response.ok) throw new Error(result.error || "No se pudieron vincular los datos.");
      localStorage.removeItem("docentetuc-data-v1");
      setLinkPreview({ linked: true, hasData: false, dataCategories: [] });
      setLinkDeclined(false);
      toast.success(result.alreadyLinked ? "Esta instalación ya está vinculada." : "Datos vinculados a tu cuenta DocenteTuc.");
      onLinked();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron vincular los datos."); }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    if (deleteConfirmation !== "ELIMINAR") return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/delete-account", {
        method: "POST", credentials: "same-origin",
        headers: { ...Object.fromEntries(new Headers(headers()).entries()), "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; installationDataDeleted?: boolean; preserveInstallationData?: boolean };
      if (!response.ok) throw new Error(result.error || "No se pudo eliminar la cuenta.");
      if (result.installationDataDeleted) try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) await subscription.unsubscribe();
      } catch { /* D1 has already deleted the subscription; local permission can be revoked in browser settings. */ }
      if (result.installationDataDeleted) {
        localStorage.removeItem("docentetuc-device-id");
        for (const key of ["docentetuc-data-v1", "docentetuc-pending-designation", "docentetuc-theme", "docentetuc-weather-tucuman-v1"]) localStorage.removeItem(key);
      } else if (!result.preserveInstallationData) {
        for (const key of ["docentetuc-data-v1", "docentetuc-pending-designation"]) localStorage.removeItem(key);
      }
      setDeleteOpen(false);
      setStatus((current) => ({ ...current, authenticated: false, image: null, name: null }));
      onSignedOut();
      window.dispatchEvent(new Event("docentetuc:refresh-auth-status"));
      toast.success(result.installationDataDeleted
        ? "Se eliminó tu cuenta DocenteTuc y los datos de esta instalación."
        : result.preserveInstallationData
          ? "Se eliminó tu cuenta DocenteTuc. Los datos separados de esta instalación se conservaron; contactá a soporte para solicitar ayuda con su eliminación."
          : "Se eliminó tu cuenta DocenteTuc. No se modificaron los datos de otra instalación vinculada.");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo eliminar la cuenta."); }
    finally { setBusy(false); }
  };

  const deleteInstallationData = async () => {
    if (deleteDeviceConfirmation !== "ELIMINAR") return;
    setBusy(true);
    try {
      const response = await fetch("/api/installations/current", { method: "DELETE", credentials: "same-origin", headers: headers() });
      const result = await response.json().catch(() => ({})) as { error?: string; installationDataDeleted?: boolean };
      if (!installationDeletionConfirmed(response.ok, result)) throw new Error(result.error || "No se confirmó la eliminación de esta instalación.");
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) await subscription.unsubscribe();
      } catch { /* Server-side records were already deleted. */ }
      for (const key of ["docentetuc-device-id", "docentetuc-data-v1", "docentetuc-pending-designation", "docentetuc-theme", "docentetuc-weather-tucuman-v1"]) localStorage.removeItem(key);
      toast.success("Se eliminaron los datos de esta instalación.");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron eliminar los datos de esta instalación."); }
    finally { setBusy(false); }
  };

  return <article className="h-full rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 text-[var(--text-primary)] sm:p-5" aria-labelledby="account-sign-in-title">
    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.15em] text-[var(--accent-text)]"><GoogleMark />Google</p>
    <h3 id="account-sign-in-title" className="mt-2 text-lg font-black">Cuenta de DocenteTuc</h3>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">El acceso es opcional. Las consultas educativas siguen disponibles sin iniciar sesión. La cuenta no reemplaza ni comparte tu perfil docente privado o tu perfil público.</p>
    {checking ? <p className="mt-4 text-sm text-[var(--text-muted)]" role="status">Consultando la cuenta…</p> : status.authenticated ? <div className="mt-4 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><GoogleAccountPhoto src={status.image} className="size-10 shrink-0" /><div className="min-w-0"><p className="truncate text-sm font-bold">{status.name || "Cuenta de DocenteTuc"}</p><p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><CheckCircle2 className="size-3.5 text-emerald-600" />Cuenta conectada con Google</p></div></div><Button type="button" variant="outline" disabled={busy} onClick={() => void signOut()} className="min-h-11 rounded-xl"><LogOut className="size-4" />{busy ? "Procesando…" : "Cerrar sesión"}</Button></div>
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Settings2 className="size-3.5" />Administrar cuenta de DocenteTuc</p>
      {linkChecking ? <p className="text-sm text-[var(--text-muted)]" role="status">Comprobando si hay datos en este dispositivo…</p> : linkPreview?.linked ? <p className="text-sm font-semibold text-[var(--text-secondary)]">Los datos de esta instalación están vinculados a tu cuenta estable de DocenteTuc.</p> : linkPreview && !linkDeclined ? <div className="space-y-3 border-t border-[var(--border)] pt-3">
        <p className="text-sm text-[var(--text-secondary)]">{linkPreview.hasData ? "Encontramos datos de DocenteTuc en esta instalación. Si elegís vincular, asociaremos únicamente esa información a tu cuenta para que puedas recuperarla al iniciar sesión." : "No encontramos datos previos para trasladar. Si elegís continuar, asociaremos esta instalación a tu cuenta para que los datos de DocenteTuc que guardes aquí se vinculen a ella."}</p>
        <p className="text-xs text-[var(--text-muted)]">La vinculación solo abarca datos de DocenteTuc. No permite controlar tu teléfono ni acceder a tus archivos, contactos, fotos u otras aplicaciones, y tampoco amplía los permisos de Google.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void linkData()} className="min-h-11 rounded-xl bg-[#0878be] text-white"><Link2 className="size-4" />{busy ? "Vinculando…" : "Vincular mis datos a mi cuenta"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setLinkDeclined(true)} className="min-h-11 rounded-xl">Continuar sin vincular</Button></div>
      </div> : linkDeclined ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><p className="text-sm text-[var(--text-secondary)]">Los datos de este dispositivo siguen separados de la cuenta.</p><Button type="button" variant="outline" onClick={() => setLinkDeclined(false)} className="min-h-10 rounded-xl">Revisar vinculación</Button></div> : <p className="text-sm text-[var(--text-muted)]">{linkError || "No se pudo consultar la vinculación. Reintentá más tarde; no se trasladó ningún dato."}</p>}
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3"><Button type="button" variant="outline" disabled={busy} onClick={() => { setDeleteConfirmation(""); setDeleteOpen(true); }} className="min-h-11 rounded-xl border-red-300 text-red-700 hover:bg-red-50"><Trash2 className="size-4" />Eliminar cuenta y datos DocenteTuc</Button><p className="self-center text-xs text-[var(--text-muted)]">Cerrar sesión no elimina tu cuenta ni tus datos.</p></div>
    </div> : <div className="mt-4 space-y-3"><Button type="button" disabled={busy || !status.configured} onClick={() => void signIn()} className="min-h-11 rounded-xl bg-white px-4 text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border)] hover:bg-[var(--surface-secondary)]"><GoogleMark />{busy ? "Abriendo Google…" : "Continuar con Google"}</Button>{!status.configured && <p className="text-sm text-[var(--text-muted)]">{SIGN_IN_UNAVAILABLE} Podés seguir usando las funciones educativas sin cuenta.</p>}
      {installationSecurity === "protected" ? <div className="space-y-2 border-t border-[var(--border)] pt-3"><p className="text-sm text-[var(--text-secondary)]">Esta instalación tiene una credencial privada para proteger y eliminar sus datos sin iniciar sesión con Google.</p><Button type="button" variant="outline" disabled={busy} onClick={() => { setDeleteDeviceConfirmation(""); setDeleteDeviceOpen(true); }} className="min-h-11 rounded-xl border-red-300 text-red-700 hover:bg-red-50"><Trash2 className="size-4" />Eliminar los datos de este dispositivo</Button></div>
        : installationSecurity === "legacy" ? <p className="border-t border-[var(--border)] pt-3 text-sm text-[var(--text-secondary)]">Esta instalación conserva datos heredados sin una credencial criptográfica. Se mantienen separados; para pedir su eliminación, contactá a soporte. No se borrarán usando solo el identificador.</p>
        : installationSecurity === "recovery_required" ? <p className="border-t border-[var(--border)] pt-3 text-sm text-[var(--text-secondary)]">No se pudo verificar la credencial guardada para esta instalación. Sus datos se conservaron; contactá a soporte para solicitar ayuda.</p>
          : installationSecurity === "linked" ? <p className="border-t border-[var(--border)] pt-3 text-sm text-[var(--text-secondary)]">Esta instalación está vinculada a una cuenta DocenteTuc. Iniciá sesión con esa cuenta para administrar o eliminar los datos.</p>
            : <p className="border-t border-[var(--border)] pt-3 text-sm text-[var(--text-muted)]">No se pudo verificar la protección de esta instalación. No borres sus datos desde el navegador; reintentá conectado o contactá a soporte.</p>}
    </div>}
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Eliminar cuenta de DocenteTuc</DialogTitle><DialogDescription>Esta acción es permanente. No elimina tu cuenta Google.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm text-[var(--text-secondary)]"><p>Se eliminarán de DocenteTuc:</p><ul className="list-disc space-y-1 pl-5"><li>tu identidad/cuenta DocenteTuc, la relación con Google y sus sesiones;</li><li>perfil docente privado y preferencias;</li><li>perfil público, nombre visible, biografía y avatar;</li><li>guardados, agenda, eventos, seguimientos y recordatorios;</li><li>notificaciones, suscripciones/preferencias push y registros técnicos de entrega y límites;</li><li>tus publicaciones y comentarios, reportes enviados, bloqueos, aceptación de normas y límites de uso de Comunidad.</li></ul><p>Los comentarios escritos por otras personas en tus publicaciones se eliminan con ellas. Los reportes y bloqueos que involucren tu cuenta desaparecen. Las acciones de moderación sobre contenido de terceros conservan solo una auditoría mínima sin vincularla a tu cuenta cuando esta se elimina. Se conservan las publicaciones y fuentes educativas oficiales, otras cuentas y tu cuenta Google. En este dispositivo también se borrará la copia local de datos de DocenteTuc.</p><p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">Importante: una instalación nueva protegida se borra junto con la cuenta solo si confirmás desde esa misma instalación y su credencial privada sigue disponible. Los datos separados de otras instalaciones no vinculadas no se eliminan desde aquí: borrá cada instalación protegida desde ese mismo dispositivo mientras conserve su credencial. Los datos heredados o una instalación cuya credencial se perdió pueden quedar separados; en esos casos no se borran usando solo el ID y debés contactar a soporte.</p><p>Eliminar tu cuenta DocenteTuc no elimina tu cuenta Google. DocenteTuc nunca necesita tu contraseña de Google para tramitar esta eliminación.</p></div>
      <label className="block space-y-2 text-sm font-semibold" htmlFor="delete-account-confirm"><span>Escribí ELIMINAR para confirmar</span><Input id="delete-account-confirm" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="min-h-11 rounded-xl" /></label>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button type="button" disabled={busy || deleteConfirmation !== "ELIMINAR"} onClick={() => void deleteAccount()} className="bg-red-700 text-white hover:bg-red-800">{busy ? "Eliminando…" : "Eliminar cuenta definitivamente"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={deleteDeviceOpen} onOpenChange={setDeleteDeviceOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Eliminar datos de este dispositivo</DialogTitle><DialogDescription>Se borrarán únicamente los datos de DocenteTuc de esta instalación. Esta acción no elimina cuentas Google ni afecta otras instalaciones.</DialogDescription></DialogHeader>
      <p className="text-sm text-[var(--text-secondary)]">La credencial privada de esta instalación se verificará en el servidor. Si la solicitud falla, no se limpiará el identificador local y podrás reintentar.</p>
      <label className="block space-y-2 text-sm font-semibold" htmlFor="delete-device-confirm"><span>Escribí ELIMINAR para confirmar</span><Input id="delete-device-confirm" autoComplete="off" value={deleteDeviceConfirmation} onChange={(event) => setDeleteDeviceConfirmation(event.target.value)} className="min-h-11 rounded-xl" /></label>
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteDeviceOpen(false)}>Cancelar</Button><Button type="button" disabled={busy || deleteDeviceConfirmation !== "ELIMINAR"} onClick={() => void deleteInstallationData()} className="bg-red-700 text-white hover:bg-red-800">{busy ? "Eliminando…" : "Eliminar datos de este dispositivo"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </article>;
}
