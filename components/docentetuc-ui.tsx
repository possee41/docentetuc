"use client";

import type { ButtonHTMLAttributes, ElementType, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MatchResult } from "@/lib/matching";

export function AppHeader({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn("app-header app-topbar sticky top-0 z-30 flex items-center border-b", className)} {...props}>{children}</header>;
}

export function BottomNavigation({ items, active, onNavigate, className }: {
  items: { id: string; label: string; icon: LucideIcon }[];
  active: string;
  onNavigate: (id: string) => void;
  className?: string;
}) {
  return <nav className={cn("mobile-nav fixed z-40 flex items-center", className)} aria-label="Navegación principal">
    {items.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => onNavigate(id)} aria-current={active === id ? "page" : undefined} className={cn("mobile-nav-item flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold", active === id ? "is-active bg-[#0878be] text-white" : "text-[var(--text-secondary)]")}>
      <Icon className={cn("size-5", active === id && "stroke-[2.6]")} aria-hidden="true" />
      <span className="max-w-full truncate px-1">{label}</span>
    </button>)}
  </nav>;
}

export function SectionHeader({ eyebrow, title, description, action, className, level = 2 }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  level?: 1 | 2;
}) {
  return <div className={cn("dt-section-header", className)}>
    <div className="min-w-0">
      {eyebrow && <p className="dt-eyebrow">{eyebrow}</p>}
      {level === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description && <p className="dt-section-description">{description}</p>}
    </div>
    {action && <div className="dt-section-action">{action}</div>}
  </div>;
}

export function Card({ as: Tag = "section", children, className, ...props }: HTMLAttributes<HTMLElement> & { as?: ElementType; children: ReactNode }) {
  return <Tag className={cn("dt-card", className)} {...props}>{children}</Tag>;
}

export function StatusBadge({ children, tone = "neutral", className }: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "info" | "danger";
  className?: string;
}) {
  return <Badge className={cn(`badge-${tone}`, className)}>{children}</Badge>;
}

export function CompatibilityBadge({ result, className }: { result: MatchResult; className?: string }) {
  if (result.criteria.some((criterion) => criterion.key === "general")) return <StatusBadge tone="info" className={className}>Información general · no personalizada</StatusBadge>;
  if (result.status === "unconfigured") return null;
  if (result.criteria.length > 0 && result.criteria.every((criterion) => !criterion.available)) return <StatusBadge className={className}>Información insuficiente</StatusBadge>;
  if (result.confidence < 70) return <StatusBadge className={className}>Compatibilidad no determinada</StatusBadge>;
  const labels = { exact: "Coincidencia exacta", partial: "Coincidencia parcial", none: "No coincide" } as const;
  const tone = result.status === "exact" ? "success" : result.status === "partial" ? "warning" : "neutral";
  const confidenceLabel = result.confidence >= 85 ? "alta" : result.confidence >= 70 ? "media" : "baja";
  return <StatusBadge tone={tone} className={className}>{labels[result.status as keyof typeof labels] || "Compatibilidad no determinada"} · {result.score}% · confianza {confidenceLabel} ({result.confidence}%)</StatusBadge>;
}

export function FilterChip({ children, selected = false, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return <button type="button" aria-pressed={selected} className={cn("dt-filter-chip", selected && "is-selected", className)} {...props}>{children}</button>;
}

export function EmptyState({ title, text, icon: Icon = Search, className }: {
  title: string;
  text: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return <div className={cn("dt-empty-state", className)}>
    <Icon className="size-7 text-[var(--text-muted)]" aria-hidden="true" />
    <div><p className="font-bold text-[var(--text-primary)]">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-secondary)]">{text}</p></div>
  </div>;
}
