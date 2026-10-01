"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { DEFAULT_PUBLIC_PROFILE, PUBLIC_AVATAR_IDS, validatePublicProfile } from "@/lib/public-profile";
import type { PublicAvatarId, PublicProfile } from "@/lib/public-profile";

const avatarColors = [
  ["#075f9b", "#ffffff"], ["#0878be", "#ffffff"], ["#0b94c8", "#ffffff"], ["#0e7490", "#ffffff"],
  ["#0f766e", "#ffffff"], ["#15803d", "#ffffff"], ["#4d7c0f", "#ffffff"], ["#a16207", "#ffffff"],
  ["#b45309", "#ffffff"], ["#c2410c", "#ffffff"], ["#be123c", "#ffffff"], ["#be185d", "#ffffff"],
  ["#a21caf", "#ffffff"], ["#7e22ce", "#ffffff"], ["#6d28d9", "#ffffff"], ["#4338ca", "#ffffff"],
  ["#3730a3", "#ffffff"], ["#334155", "#ffffff"], ["#1e3a8a", "#ffffff"], ["#facc15", "#075f9b"],
] as const;

function AvatarPreview({ avatarId, size = "size-14" }: { avatarId: PublicAvatarId; size?: string }) {
  const index = PUBLIC_AVATAR_IDS.indexOf(avatarId);
  const [backgroundColor, color] = avatarColors[index] || avatarColors[0];
  return <span aria-hidden="true" className={`${size} inline-grid shrink-0 place-items-center rounded-full ring-2 ring-white shadow-sm`} style={{ backgroundColor, color }}>
    <UserRound className="size-1/2" strokeWidth={2.2} />
  </span>;
}

export function PublicProfileSection({ profile, headers, onSaved }: { profile: PublicProfile | null; headers: () => HeadersInit; onSaved: () => void }) {
  const [form, setForm] = useState<PublicProfile>(() => profile || { ...DEFAULT_PUBLIC_PROFILE });
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const validation = validatePublicProfile(form);
    if (!validation.ok) { toast.error(validation.error); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/app", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "save_public_profile", ...validation.value }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el perfil público.");
      toast.success("Perfil público guardado");
      setIsEditing(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el perfil público.");
    } finally { setBusy(false); }
  };

  return <section className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 text-[var(--text-primary)] md:p-6" aria-labelledby="public-profile-title">
    <p className="text-xs font-black uppercase tracking-[.15em] text-[var(--accent-text)]">Identidad · Fase 1</p>
    <h2 id="public-profile-title" className="mt-1 text-xl font-black">Mi perfil público</h2>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">Estos son los datos que podrán mostrarse a otros usuarios cuando utilices las funciones de Comunidad de DocenteTuc.</p>
    <p className="mt-3 rounded-2xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-sm text-[var(--info-text)]">La Comunidad todavía no está habilitada. Guardar este perfil no publica nada ni lo comparte con otros usuarios. Tu nombre del perfil docente privado no se copia aquí.</p>

    {!isEditing ? <div className="mt-5 space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4">
        <AvatarPreview avatarId={profile?.avatarId || DEFAULT_PUBLIC_PROFILE.avatarId} size="size-16" />
        <div className="min-w-0"><p className="truncate font-bold">{profile?.displayName || "Todavía no configuraste un perfil público"}</p>{profile?.bio && <p className="line-clamp-2 text-sm text-[var(--text-secondary)]">{profile.bio}</p>}</div>
      </div>
      <Button type="button" onClick={() => { setForm(profile || { ...DEFAULT_PUBLIC_PROFILE }); setIsEditing(true); }} className="min-h-11 rounded-xl bg-[#0878be] px-6 text-white">Editar perfil público</Button>
    </div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-5 space-y-5">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4">
        <AvatarPreview avatarId={form.avatarId} size="size-16" />
        <div className="min-w-0"><p className="font-bold">Vista previa</p><p className="truncate text-sm text-[var(--text-secondary)]">{form.displayName || "Nombre visible"}</p>{form.bio && <p className="line-clamp-2 text-sm text-[var(--text-muted)]">{form.bio}</p>}</div>
      </div>

      <fieldset>
        <legend className="font-bold">Elegí tu avatar</legend>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Opciones temporales locales. Las ilustraciones definitivas todavía no están incorporadas.</p>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-10" role="radiogroup" aria-label="Elegí uno de los 20 avatares temporales">
          {PUBLIC_AVATAR_IDS.map((avatarId) => {
            const selected = form.avatarId === avatarId;
            return <button key={avatarId} type="button" role="radio" aria-checked={selected} aria-label={`Elegir avatar temporal ${avatarId.slice(-2)}`} onClick={() => setForm({ ...form, avatarId })}
              className={`grid min-h-16 place-items-center rounded-2xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0878be] ${selected ? "border-[#0878be] bg-[var(--info-bg)] ring-2 ring-[#0878be]/30" : "border-[var(--border)] bg-[var(--surface-secondary)] hover:border-[#0878be]"}`}>
              <AvatarPreview avatarId={avatarId} size="size-10" />
            </button>;
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="public-display-name">Nombre visible</Label>
        <Input id="public-display-name" value={form.displayName} maxLength={40} autoComplete="nickname" onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="El nombre que vos elijas mostrar" className="min-h-11 rounded-xl border-[var(--border)] bg-[var(--input-background)]" />
        <p className="text-xs text-[var(--text-muted)]">Hasta 40 caracteres. No usamos automáticamente tu nombre privado.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="public-bio">Bio <span className="font-normal text-[var(--text-muted)]">(opcional)</span></Label>
        <Textarea id="public-bio" value={form.bio} maxLength={160} onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="Una breve presentación (opcional)" className="min-h-24 rounded-xl border-[var(--border)] bg-[var(--input-background)]" />
        <p className="text-xs text-[var(--text-muted)]">Hasta 160 caracteres; solo texto, sin HTML.</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={() => { setForm(profile || { ...DEFAULT_PUBLIC_PROFILE }); setIsEditing(false); }} className="min-h-11 rounded-xl">Cancelar</Button>
        <Button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#0878be] px-6 text-white">{busy ? "Guardando…" : "Guardar"}</Button>
      </div>
    </form>}
  </section>;
}
