import React from "react";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  colorClass?: string;
  subtext?: string;
}

export default function StatCard({ title, value, unit, icon: Icon, colorClass = "text-teal-400", subtext }: StatCardProps) {
  return (
    <div className="glass-card p-4 flex flex-col justify-between h-28 relative overflow-hidden group hover:border-white/[0.15] bg-white/[0.02]">
      {/* Card Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-wider text-slate-400 font-bold uppercase">{title}</span>
        <Icon className={`w-4 h-4 ${colorClass} opacity-85 group-hover:scale-105 transition-transform`} />
      </div>

      {/* Value Readout */}
      <div className="mt-2 flex items-baseline gap-1 select-none">
        <span className="font-sans text-3xl font-semibold tracking-tight text-white">{value}</span>
        {unit && <span className="font-sans text-xs text-slate-500 font-normal">{unit}</span>}
      </div>

      {/* Subtext info */}
      <div className="mt-1 font-mono text-[8px] text-slate-500">
        {subtext || "DATABASE CONNECTIVITY: NOMINAL"}
      </div>
    </div>
  );
}
