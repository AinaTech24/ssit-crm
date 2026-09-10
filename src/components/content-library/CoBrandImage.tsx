"use client";

/**
 * Client-side image co-branding compositor.
 *
 * Loads an image (from any URL — CORS permitting) and overlays a branded
 * footer strip containing the MFD's logo, firm name, ARN, contact details,
 * and address. Exports a PNG via canvas.toBlob() so the user can download
 * directly from the browser — no server round-trip needed.
 *
 * Usage:
 *   <CoBrandImage
 *     fileUrl="https://…/festive-diwali.png"
 *     tenant={{ displayName: 'Demo Wealth', arn: 'ARN-123456', mobile: '+91…', … }}
 *     fileName="diwali_branded.png"
 *   />
 */

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Download,
  Image as ImageIcon,
  AlertTriangle,
  Eye,
  Settings2,
} from "lucide-react";

export type BrandingTenant = {
  displayName?: string | null;
  legalName?: string | null;
  arn?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: any | null; // jsonb
  logoUrl?: string | null;
  primaryColor?: string | null;
};

export function CoBrandImage({
  fileUrl,
  fileName,
  tenant,
  defaultPosition = "bottom",
  defaultHeightPct = 18,
}: {
  fileUrl: string;
  fileName?: string | null;
  tenant: BrandingTenant;
  defaultPosition?: "top" | "bottom" | "both";
  defaultHeightPct?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [logoEl, setLogoEl] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<"top" | "bottom" | "both">(defaultPosition);
  const [heightPct, setHeightPct] = useState(defaultHeightPct);
  const [showSettings, setShowSettings] = useState(false);

  // Load source image + optional tenant logo
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      if (cancelled) return;
      setImgEl(im);
      setLoading(false);
    };
    im.onerror = () => {
      if (cancelled) return;
      setError(
        "Couldn't load the image. The S3 bucket may not allow cross-origin downloads — ask Equitywala to add the tenant origin to CORS."
      );
      setLoading(false);
    };
    im.src = fileUrl;
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // Load tenant logo (best-effort; missing logo just means we draw initials)
  useEffect(() => {
    if (!tenant.logoUrl) {
      setLogoEl(null);
      return;
    }
    const lg = new Image();
    lg.crossOrigin = "anonymous";
    lg.onload = () => setLogoEl(lg);
    lg.onerror = () => setLogoEl(null);
    lg.src = tenant.logoUrl;
  }, [tenant.logoUrl]);

  // Re-paint whenever inputs change
  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    paint(canvasRef.current, imgEl, logoEl, tenant, position, heightPct);
  }, [imgEl, logoEl, tenant, position, heightPct]);

  async function download() {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = (fileName ?? "branded-image").replace(/\.(png|jpe?g|webp)$/i, "");
      a.download = `${baseName}-branded.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    }, "image/png");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-secondary/20 p-3">
        {loading ? (
          <div className="flex items-center justify-center min-h-[200px] text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" /> Loading preview…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="size-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Preview blocked.</div>
              <div className="text-xs mt-1">{error}</div>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-cyan-deep hover:underline mt-1 inline-block"
              >
                Open original →
              </a>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-w-full h-auto rounded-md shadow-sm bg-white"
            style={{ maxHeight: "60vh" }}
          />
        )}
      </div>

      {!loading && !error && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className="btn-ghost text-xs"
            >
              <Settings2 className="size-3.5" />
              {showSettings ? "Hide" : "Customize"} branding strip
            </button>
            <button type="button" onClick={download} className="btn-primary">
              <Download className="size-4" /> Download branded PNG
            </button>
          </div>

          {showSettings && (
            <div className="rounded-lg border border-border bg-card p-3 grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                <div className="font-medium mb-1">Strip position</div>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as any)}
                  className="input-base text-xs"
                >
                  <option value="bottom">Bottom only</option>
                  <option value="top">Top only</option>
                  <option value="both">Top + bottom</option>
                </select>
              </label>
              <label className="block">
                <div className="font-medium mb-1">
                  Strip height — <span className="tabular-nums">{heightPct}%</span> of image
                </div>
                <input
                  type="range"
                  min={8}
                  max={30}
                  step={1}
                  value={heightPct}
                  onChange={(e) => setHeightPct(Number(e.target.value))}
                  className="w-full accent-brand-cyan"
                />
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Canvas paint ───────────────────────── */

function paint(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  logo: HTMLImageElement | null,
  tenant: BrandingTenant,
  position: "top" | "bottom" | "both",
  heightPct: number
) {
  // Render at the original image resolution
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Draw the source image
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const stripH = Math.round((h * heightPct) / 100);
  const primary = tenant.primaryColor || "#841f21";
  const accent = "#d22e32";

  if (position === "bottom" || position === "both") {
    drawStrip(ctx, 0, h - stripH, w, stripH, primary, accent, logo, tenant);
  }
  if (position === "top" || position === "both") {
    drawStrip(ctx, 0, 0, w, stripH, primary, accent, logo, tenant);
  }
}

function drawStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  primary: string,
  accent: string,
  logo: HTMLImageElement | null,
  tenant: BrandingTenant
) {
  // Background fill
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, shade(primary, -12));
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Accent stripe on top edge
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, Math.max(3, Math.round(h * 0.03)));

  const padding = Math.round(h * 0.14);
  const innerH = h - 2 * padding;

  // Left: logo / initial tile
  const tileSize = innerH;
  let cursorX = x + padding;
  if (logo) {
    // Rounded-corner clip
    ctx.save();
    roundedRect(ctx, cursorX, y + padding, tileSize, tileSize, tileSize * 0.18);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cursorX, y + padding, tileSize, tileSize);
    // contain the logo inside the tile
    const r = Math.min(tileSize / logo.naturalWidth, tileSize / logo.naturalHeight);
    const dw = logo.naturalWidth * r;
    const dh = logo.naturalHeight * r;
    ctx.drawImage(
      logo,
      cursorX + (tileSize - dw) / 2,
      y + padding + (tileSize - dh) / 2,
      dw,
      dh
    );
    ctx.restore();
  } else {
    // White rounded tile with the firm initial
    ctx.save();
    roundedRect(ctx, cursorX, y + padding, tileSize, tileSize, tileSize * 0.18);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = primary;
    ctx.font = `bold ${Math.round(tileSize * 0.55)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = (tenant.displayName ?? tenant.legalName ?? "M").charAt(0).toUpperCase();
    ctx.fillText(initial, cursorX + tileSize / 2, y + padding + tileSize / 2);
    ctx.restore();
  }
  cursorX += tileSize + padding;

  // Right block: firm name + 4-line contact
  const textX = cursorX;
  const textW = x + w - textX - padding;

  // Firm name (line 1, bold large)
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const titleFont = Math.max(14, Math.round(innerH * 0.32));
  ctx.font = `700 ${titleFont}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const displayName = tenant.displayName ?? tenant.legalName ?? "MFD";
  ctx.fillText(displayName, textX, y + padding + titleFont * 0.95);

  // ARN (line 2, smaller, slightly faded)
  const arnFont = Math.max(11, Math.round(innerH * 0.18));
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `500 ${arnFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const arnLine = `ARN ${(tenant.arn ?? "—").replace(/^ARN-?/i, "")}`;
  ctx.fillText(arnLine, textX, y + padding + titleFont * 1.05 + arnFont * 1.05);

  // Contact line(s): mobile · email · website · address (wraps if too long)
  const contactFont = Math.max(11, Math.round(innerH * 0.16));
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `500 ${contactFont}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const contactPieces: string[] = [];
  if (tenant.phone) contactPieces.push("☎ " + tenant.phone);
  if (tenant.email) contactPieces.push("✉ " + tenant.email);
  if (tenant.website) contactPieces.push("🌐 " + tenant.website.replace(/^https?:\/\//, ""));
  if (tenant.address) {
    const a = tenant.address;
    const addressStr =
      typeof a === "string"
        ? a
        : [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ");
    if (addressStr) contactPieces.push("📍 " + addressStr);
  }
  // Wrap the contact pieces onto up to 2 lines, joining with " · "
  const lines = wrapPieces(ctx, contactPieces, textW);
  let cy = y + padding + titleFont * 1.05 + arnFont * 1.05 + contactFont * 1.6;
  for (const line of lines.slice(0, 2)) {
    ctx.fillText(line, textX, cy);
    cy += contactFont * 1.3;
  }
}

function wrapPieces(ctx: CanvasRenderingContext2D, pieces: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const p of pieces) {
    const trial = current ? `${current}  ·  ${p}` : p;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = p;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Darken or lighten a hex color by `pct` (-100..100). */
function shade(hex: string, pct: number): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
