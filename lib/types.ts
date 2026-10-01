import type { PublicProfile } from "./public-profile";

export type Profile = {
  user_id: string; name: string; email?: string; level: string; levels: string[]; area: string; areas: string[]; subjects: string[]; junta: string; boards: string[];
  roles: string[]; department: string; locality: string; shifts: string[]; wants_interim: number | boolean; wants_substitute: number | boolean; characters: string[]; circuits: string[]; training_interests: string[];
  notify_new_trainings: number | boolean; training_notify_scope: "all" | "level" | "area" | "interests" | "relevant";
  training_match_threshold: number; personal_match_threshold: number; updated_at?: string;
};

export type Publication = {
  id: string; source: string; external_id: string; kind: "vacante" | "capacitacion" | "junta" | "informacion"; category: string;
  title: string; summary: string; level: string; area: string; junta: string; location: string; shift: string; character: string;
  circuit?: string; source_circuit_raw?: string; circuit_inference_source?: string; circuit_confidence?: number;
  starts_at: string | null; ends_at: string | null; status: string; official_url: string; metadata: string; first_seen_at: string; updated_at: string;
  last_seen_at?: string; last_changed_at?: string; source_published_at?: string | null; registration_open_at?: string | null; registration_close_at?: string | null; expires_at?: string | null;
  source_status?: string; normalized_status?: "ACTIVE" | "UPCOMING" | "CLOSED" | "EXPIRED" | "REMOVED_FROM_SOURCE" | "UNKNOWN" | string; removed_at?: string | null;
};

export type Saved = { publication_id: string; in_agenda: number | boolean; followed: number | boolean; agenda_at?: string | null; agenda_notes?: string; agenda_reminder_at?: string | null; agenda_reminder_notified?: number | boolean; saved_at: string };
export type Notice = { id: number; publication_id: string; type: string; created_at: string; read: number | boolean; title: string; kind: string };
export type SyncStatus = { source: string; synced_at: string; item_count: number; error?: string; last_attempt_at?: string | null; last_successful_sync_at?: string | null; last_content_change_at?: string | null; records_created?: number; records_updated?: number; records_removed?: number; sync_status?: string; error_code?: string | null; error_message?: string | null; parser_version?: string };
export type TrainingReminder = { id: string; training_id: string; publication_id: string; opens_at: string; precision: "date" | "datetime"; advance_minutes: number | null; remind_at: string; notified: number | boolean };
export type DesignationTracking = { id: string; publication_id: string; status: string; role: string; subject: string; school: string; address: string; locality: string; applied_at: string | null; appointment_at: string | null; shift: string; board: string; documentation: string; order_number: string; notes: string; official_url: string; reminder_at: string | null; reminder_notified: number | boolean; created_at: string; updated_at: string };
export type ManualEvent = { id: string; title: string; notes: string; category: string; starts_at: string; all_day?: number | boolean; recurrence?: "none" | "daily" | "weekly" | "monthly"; reminder_minutes?: number | null; reminder_at: string | null; reminder_notified: number | boolean; created_at: string; updated_at: string };
export type AppData = { profile: Profile; publicProfile?: PublicProfile | null; publications: Publication[]; saved: Saved[]; notifications: Notice[]; reminders: TrainingReminder[]; designations: DesignationTracking[]; manualEvents: ManualEvent[]; sync: SyncStatus[] };
