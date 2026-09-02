import React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function Group({
  title,
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/70">
            {title}
          </h2>
        </div>
        {link && (
          <Link
            href={link.href}
            className="text-xs text-brand-cyan-deep hover:underline font-medium"
          >
            {link.label} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export function Kpi({
  href,
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent,
  hero,
  delta,
  deltaTone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "cyan" | "violet" | "emerald" | "amber";
  hero?: boolean;
  delta?: string;
  deltaTone?: "up" | "down";
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;

  if (hero) {
    const inner = (
      <div className="kpi-hero relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-white/80">
            {label}
          </span>
          {Icon && (
            <div className="size-8 rounded-lg bg-white/15 grid place-items-center backdrop-blur-sm">
              <Icon className="size-4 text-white" />
            </div>
          )}
        </div>
        <div className="text-3xl font-extrabold mt-2 tabular-nums tracking-tight">{value}</div>
        {sub && (
          <div className="text-xs mt-2 flex items-center gap-1 text-white/85">
            {TrendIcon && (
              <TrendIcon
                className={`size-3.5 ${trend === "up" ? "text-emerald-300" : "text-rose-300"}`}
              />
            )}
            <span>{sub}</span>
          </div>
        )}
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  }

  const iconBg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    default: "bg-secondary text-foreground",
  };
  const bg = iconBg[accent ?? "default"];
  const trendColor =
    trend === "up"
      ? "text-emerald-600"
      : trend === "down"
      ? "text-rose-600"
      : "text-muted-foreground";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-8 rounded-lg grid place-items-center ${bg}`}>
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-2 flex-wrap">
        <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              deltaTone === "down"
                ? "bg-rose-50 text-rose-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {deltaTone === "down" ? (
              <ArrowDownRight className="size-2.5" />
            ) : (
              <ArrowUpRight className="size-2.5" />
            )}
            {delta}
          </span>
        )}
      </div>
      {sub && (
        <div className={`text-xs mt-2 flex items-center gap-1 ${trendColor}`}>
          {TrendIcon && <TrendIcon className="size-3" />}
          <span>{sub}</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Stat({
  href,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  href?: string;
  icon?: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
      ? "bg-amber-50 text-amber-600"
      : tone === "emerald"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-brand-cyan-light text-brand-cyan-deep";

  const inner = (
    <div className="kpi-card glass-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
