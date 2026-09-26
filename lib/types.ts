export type Profile = {
  user_id: string; name: string; email?: string; level: string; area: string; subjects: string; junta: string;
  department: string; locality: string; shifts: string; wants_interim: number | boolean; wants_substitute: number | boolean; training_interests: string;
  notify_new_trainings: number | boolean; training_notify_scope: "all" | "level" | "area" | "interests" | "relevant";
};

export type Publication = {
  id: string; source: string; external_id: string; kind: "vacante" | "capacitacion" | "junta"; category: string;
  title: string; summary: string; level: string; area: string; junta: string; location: string; shift: string; character: string;
  starts_at: string | null; ends_at: string | null; status: string; official_url: string; metadata: string; first_seen_at: string; updated_at: string;
};

export type Saved = { publication_id: string; in_agenda: number | boolean; followed: number | boolean; saved_at: string };
export type Notice = { id: number; publication_id: string; type: string; created_at: string; read: number | boolean; title: string; kind: string };
export type SyncStatus = { source: string; synced_at: string; item_count: number; error?: string };
export type TrainingReminder = { id: string; training_id: string; publication_id: string; opens_at: string; precision: "date" | "datetime"; advance_minutes: number | null; remind_at: string; notified: number | boolean };
export type AppData = { profile: Profile; publications: Publication[]; saved: Saved[]; notifications: Notice[]; reminders: TrainingReminder[]; sync: SyncStatus[] };
