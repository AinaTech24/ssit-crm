"use client";

/**
 * SSIT CRM Copilot — dependency-free SVG charts for assistant replies.
 *
 * The engine embeds a spec as a fenced ```ssit-chart block; Markdown.tsx parses
 * it and renders this. Supported types: bar (vertical), hbar (horizontal, good
 * for ranked/long labels), line (ordered trend), pie (share of a total). Values
 * format as compact INR or plain numbers. Theme-aware (currentColor for text /
 * axes, a fixed readable palette for series).
 */

import React from "react";

export type ChartSpec = {
  type: "bar" | "hbar" | "line" | "pie";
  title?: string;
  data: { label: string; value: number }[];
  format?: "inr" | "number";
};

const PALETTE = ["#0891b2", "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

function fmtInr(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return "₹" + (n / 1e7).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, "") + "Cr";
  if (a >= 1e5) return "₹" + (n / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "L";
  if (a >= 1e3) return "₹" + Math.round(n / 1e3) + "k";
  return "₹" + Math.round(n);
}
const fmtNum = (n: number) => Math.round(n).toLocaleString("en-IN");
const clip = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function SSITChart({ spec }: { spec: ChartSpec }) {
  const fmt = spec.format === "inr" ? fmtInr : fmtNum;
  const data = (spec.data ?? []).filter((d) => d && Number.isFinite(Number(d.value)));
  if (!data.length) return null;

  return (
    <figure className="my-3 rounded-xl border border-border/60 bg-background/40 p-3">
      {spec.title && <figcaption className="text-xs font-semibold text-foreground/80 mb-2">{spec.title}</figcaption>}
      {spec.type === "hbar" ? <HBar data={data} fmt={fmt} />
        : spec.type === "line" ? <Line data={data} fmt={fmt} />
        : spec.type === "pie" ? <Pie data={data} fmt={fmt} />
        : <Bar data={data} fmt={fmt} />}
    </figure>
  );
}

type P = { data: { label: string; value: number }[]; fmt: (n: number) => string };

function Bar({ data, fmt }: P) {
  const d = data.slice(0, 8);
  const W = 520, H = 210, padB = 42, padT = 22, padX = 6;
  const plotH = H - padB - padT;
  const max = Math.max(...d.map((x) => x.value), 1);
  const bw = (W - padX * 2) / d.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-muted-foreground" preserveAspectRatio="xMidYMid meet">
      <line x1={padX} y1={H - padB} x2={W - padX} y2={H - padB} stroke="currentColor" strokeOpacity={0.25} />
      {d.map((x, i) => {
        const h = Math.max(2, (x.value / max) * plotH);
        const cx = padX + i * bw;
        const barW = bw * 0.6;
        const bx = cx + (bw - barW) / 2;
        return (
          <g key={i}>
            <rect x={bx} y={H - padB - h} width={barW} height={h} rx={3} fill={PALETTE[i % PALETTE.length]} />
            <text x={cx + bw / 2} y={H - padB - h - 5} textAnchor="middle" fontSize={11} fill="currentColor" className="text-foreground">{fmt(x.value)}</text>
            <text x={cx + bw / 2} y={H - padB + 15} textAnchor="middle" fontSize={11} fill="currentColor">{clip(x.label, 10)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HBar({ data, fmt }: P) {
  const d = data.slice(0, 10);
  const rowH = 26, labelW = 118, W = 520, padR = 60;
  const H = d.length * rowH + 8;
  const max = Math.max(...d.map((x) => x.value), 1);
  const plotW = W - labelW - padR;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-muted-foreground" preserveAspectRatio="xMidYMid meet">
      {d.map((x, i) => {
        const y = i * rowH + 4;
        const w = Math.max(2, (x.value / max) * plotW);
        return (
          <g key={i}>
            <text x={labelW - 8} y={y + rowH / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">{clip(x.label, 15)}</text>
            <rect x={labelW} y={y + 3} width={w} height={rowH - 10} rx={3} fill={PALETTE[i % PALETTE.length]} />
            <text x={labelW + w + 6} y={y + rowH / 2} dominantBaseline="middle" fontSize={11} fill="currentColor" className="text-foreground">{fmt(x.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Line({ data, fmt }: P) {
  const d = data.slice(-12);
  const W = 520, H = 210, padB = 34, padT = 18, padL = 10, padR = 10;
  const plotH = H - padB - padT, plotW = W - padL - padR;
  const max = Math.max(...d.map((x) => x.value), 1);
  const min = Math.min(...d.map((x) => x.value), 0);
  const span = max - min || 1;
  const x = (i: number) => padL + (d.length === 1 ? plotW / 2 : (i / (d.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  const pts = d.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `${padL},${padT + plotH} ${pts} ${padL + plotW},${padT + plotH}`;
  const step = Math.ceil(d.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-muted-foreground" preserveAspectRatio="xMidYMid meet">
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="currentColor" strokeOpacity={0.2} />
      <polygon points={area} fill={PALETTE[0]} fillOpacity={0.1} />
      <polyline points={pts} fill="none" stroke={PALETTE[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {d.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={3} fill={PALETTE[0]} />
          {i % step === 0 && <text x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="currentColor">{clip(p.label, 8)}</text>}
          {(i === 0 || i === d.length - 1) && <text x={x(i)} y={y(p.value) - 7} textAnchor="middle" fontSize={10} fill="currentColor" className="text-foreground">{fmt(p.value)}</text>}
        </g>
      ))}
    </svg>
  );
}

function Pie({ data, fmt }: P) {
  const d = data.slice(0, 6).filter((x) => x.value > 0);
  const total = d.reduce((s, x) => s + x.value, 0) || 1;
  const R = 78, C = 90;
  let acc = -Math.PI / 2;
  const arc = (frac: number) => {
    const a0 = acc, a1 = acc + frac * 2 * Math.PI;
    acc = a1;
    const large = frac > 0.5 ? 1 : 0;
    return `M ${C} ${C} L ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`;
  };
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 180 180" className="w-40 h-40 shrink-0" preserveAspectRatio="xMidYMid meet">
        {d.map((x, i) => <path key={i} d={arc(x.value / total)} fill={PALETTE[i % PALETTE.length]} />)}
      </svg>
      <div className="text-xs space-y-1 text-muted-foreground">
        {d.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-foreground/90">{clip(x.label, 18)}</span>
            <span className="tabular-nums">{fmt(x.value)} · {Math.round((x.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
