"use client";

/**
 * Shared chrome for the non-login auth screens (forgot / reset password).
 *
 * These pages used to be a bare centred box on a white page — nothing like the
 * split-screen login, and they ignored white-label branding entirely, so a firm
 * on its own domain saw the SSIT wordmark the moment it clicked "Forgot?".
 * This mirrors AuthScreen's shell so the whole flow looks like one product.
 *
 * AuthScreen is deliberately left alone: it carries the live login + signup +
 * 2FA state machine, and re-plumbing it to share this would risk the one screen
 * every user must pass through.
 */

import Link from "next/link";
import { Check } from "lucide-react";

const YEAR = new Date().getFullYear();

export function AuthPanelLayout({
  eyebrow,
  title,
  sub,
  points,
  brandLogoUrl,
  brandName,
  children,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  points: string[];
  brandLogoUrl?: string | null;
  brandName?: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen grid grid-rows-1 grid-cols-1 lg:grid-cols-2 bg-background">
      {/* ── Left: brand panel ── */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden text-white bg-gradient-to-br from-[#D8434B] via-[#C21F28] to-[#B71A20]">
        <div className="absolute inset-0 opacity-[0.06] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />

        <Link
          href="/"
          className="relative z-10 inline-flex w-fit items-center"
          aria-label={`${brandName ?? "SSIT CRM"} home`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brandLogoUrl || "/ssit-logo.png"}
            alt={brandName ?? "SSIT CRM"}
            className="h-11 w-auto bg-white rounded-xl px-3 py-2 shadow-lg object-contain"
          />
        </Link>

        <div className="auth-swap relative z-10 max-w-md">
          <span className="inline-block text-[11px] font-bold uppercase tracking-[0.22em] text-white/80">
            {eyebrow}
          </span>
          <h2 className="mt-4 text-[2.6rem] leading-[1.08] font-extrabold tracking-tight">{title}</h2>
          <p className="mt-5 text-white/75 text-[15px] leading-relaxed">{sub}</p>
          <ul className="mt-8 grid grid-cols-1 gap-3">
            {points.map((t) => (
              <li key={t} className="flex items-center gap-3 text-[15px] text-white/90">
                <span className="size-5 rounded-full bg-white/15 grid place-items-center shrink-0">
                  <Check className="size-3 text-white" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-white/55">
          Designed and Developed by{" "}
          <a
            href="https://ainatech.in"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white/80 hover:text-white transition-colors"
          >
            AinaTech Services LLP
          </a>{" "}
          · © {YEAR}
        </div>
      </div>

      {/* ── Right: form ── */}
      <div className="overflow-y-auto bg-secondary/20">
        <div className="min-h-screen lg:min-h-full flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {/* Mobile-only wordmark — desktop uses the left panel, never both. */}
            <div className="lg:hidden mb-8 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandLogoUrl || "/ssit-wordmark.png"}
                alt={brandName ?? "SSIT CRM"}
                className="h-9 w-auto object-contain"
              />
            </div>
            <div className="auth-swap">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
