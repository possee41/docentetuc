"use client";

import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function GoogleAccountPhoto({ src, className = "" }: { src: string | null; className?: string }) {
  return <Avatar aria-hidden="true" className={`size-9 border border-[#dce8e1] bg-[#e8f5fc] text-[#0878be] ${className}`}>
    {src && <AvatarImage key={src} src={src} alt="" referrerPolicy="no-referrer" />}
    <AvatarFallback className="bg-[#e8f5fc] text-[#0878be]"><UserRound className="size-5" strokeWidth={2.2} /></AvatarFallback>
  </Avatar>;
}
