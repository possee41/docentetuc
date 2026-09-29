"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

export type AIContext = { type: string; id?: string; title?: string };

export function AppBackground({ children }: { children: ReactNode }) {
  return <div className="app-background"><div className="app-watermark" aria-hidden="true" /><div className="relative z-10 min-h-svh">{children}</div></div>;
}

export function AIWidget({ onOpen }: { onOpen: () => void }) {
  return <button type="button" onClick={onOpen} aria-label="Abrir DocenteTuc IA" title="Abrir DocenteTuc IA" className="ai-fab"><Sparkles className="size-6" aria-hidden="true" /></button>;
}

export function DocenteTucAIFab({ onClick }: { onClick: () => void }) {
  return <AIWidget onOpen={onClick} />;
}
