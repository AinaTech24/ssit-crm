/**
 * Public document-collection submission — POST /api/public/docs/submit.
 *
 * Two accepted shapes:
 *   1. application/json  — presigned path. The browser already PUT each file
 *      straight to S3 (via /api/public/docs/presign) and sends the resulting
 *      storage keys here. We verify each object exists + is a real PDF/JPG/PNG
 *      (magic bytes) before indexing — a forged key can't smuggle anything in.
 *   2. multipart/form-data — legacy path. Files stream through the server and we
 *      putObject them. Kept for older cached form pages.
 *
 * Either way: validate the token, atomically claim it (single-use), index the
 * docs into compliance_documents linked to the lead/investor, capture KYC fields
 * into the client master, advance the lead stage, and push an outbox event.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens, complianceDocuments, leads, investors, eventsOutbox } from "@/db/schema";
import { claimShareToken, releaseShareToken, finalizeShareToken } from "@/lib/share-tokens";
import { putObject, getObjectBytes, deleteObject, vaultKey } from "@/lib/storage/s3";
import { isAllowedDocType } from "@/lib/storage/file-sniff";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { transitionTo } from "@/lib/blueprints/engine";
import { mapKycFieldsToInvestorUpdate } from "@/lib/onboarding/kyc-fields";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 10 MB per file (legacy multipart path)
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

/** Normalised inbound document — either raw bytes (multipart) or a pre-uploaded
 *  S3 key (presigned). */
type Incoming =
  | { kind: "bytes"; docKey: string; label: string; name: string; mime: string; buf: Buffer }
  | { kind: "key"; docKey: string; label: string; name: string; mime: string; key: string; size: number };

export async function POST(req: NextRequest) {
  try {
    // 10 submissions per IP per hour (each can carry multiple files).
    const limited = enforce(req, "public.docs", { limit: 10, windowSec: 60 * 60 });
    if (limited) return limited;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";
    const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

    // ── Parse inputs into a normalised shape ──────────────────────────────
    let tokenId = "";
    let signatureName = "";
    let extraNotes = "";
    const kycValues: Record<string, string> = {};
    const incoming: Incoming[] = [];

    if (isJson) {
      const body = (await req.json().catch(() => ({}))) as {
        tokenId?: string;
        signatureName?: string;
        extraNotes?: string;
        fields?: Record<string, string>;
        files?: Array<{ docKey?: string; label?: string; name?: string; mimeType?: string; storageKey?: string; sizeBytes?: number }>;
      };
      tokenId = String(body.tokenId ?? "");
      signatureName = String(body.signatureName ?? "").trim();
      extraNotes = String(body.extraNotes ?? "");
      for (const [k, v] of Object.entries(body.fields ?? {})) {
        if (typeof v === "string" && v.trim()) kycValues[k] = v.trim();
      }
      for (const f of body.files ?? []) {
        if (!f?.storageKey) continue;
        if (!ALLOWED_MIMES.has(String(f.mimeType ?? ""))) {
          return NextResponse.json({ error: `${f.label ?? "file"}: only PDF, JPG or PNG allowed` }, { status: 400 });
        }
        incoming.push({
          kind: "key",
          docKey: String(f.docKey ?? ""),
          label: String(f.label ?? f.docKey ?? "document"),
          name: String(f.name ?? f.label ?? "document"),
          mime: String(f.mimeType ?? ""),
          key: String(f.storageKey),
          size: Number(f.sizeBytes ?? 0),
        });
      }
    } else {
      const formData = await req.formData();
      tokenId = String(formData.get("tokenId") ?? "");
      signatureName = String(formData.get("signatureName") ?? "").trim();
      extraNotes = String(formData.get("extraNotes") ?? "");
      for (const [name, value] of formData.entries()) {
        if (name.startsWith("field_") && typeof value === "string") {
          const v = value.trim();
          if (v) kycValues[name.slice(6)] = v;
        }
      }
      for (const [name, value] of formData.entries()) {
        if (!name.startsWith("file_") || !(value instanceof File)) continue;
        const docKey = name.slice(5);
        const label = String(formData.get(`label_${docKey}`) ?? docKey);
        const file = value as File;
        if (file.size === 0) continue;
        if (file.size > MAX_BYTES) return NextResponse.json({ error: `${label}: file too large (max 10 MB)` }, { status: 400 });
        if (!ALLOWED_MIMES.has(file.type)) return NextResponse.json({ error: `${label}: only PDF, JPG or PNG allowed` }, { status: 400 });
        incoming.push({ kind: "bytes", docKey, label, name: file.name, mime: file.type, buf: Buffer.from(await file.arrayBuffer()) });
      }
    }

    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });

    // DPDP / UIDAI: never persist a full Aadhaar number. Mask any captured value
    // that is (or is labelled) an Aadhaar to keep only the last 4 digits.
    for (const [k, v] of Object.entries(kycValues)) {
      const digits = v.replace(/\D/g, "");
      const looksAadhaar = /aadhaar|aadhar|\buid\b/i.test(k) || digits.length === 12;
      if (looksAadhaar && digits.length === 12) {
        kycValues[k] = `XXXX XXXX ${digits.slice(-4)}`;
      }
    }
    const hasKyc = Object.keys(kycValues).length > 0;

    // Step 1: token lookup (cross-tenant — no session yet).
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "document_collection") throw new Error("Not a document-collection token");
      return t;
    });

    // Step 1b: atomically CLAIM the single-use token before any work.
    const claimed = await claimShareToken(tokenId);
    if (!claimed) {
      return NextResponse.json({ error: "This link has already been used" }, { status: 409 });
    }

    // Step 2: writes happen inside the token's tenant scope (RLS-protected).
    let out;
    try {
      out = await withTenant(tk.tenantId!, async (tx) => {
        const firm = await firmFolderName(tk.tenantId!);
        let clientName: string | null = null;
        if (tk.subjectType === "investor") {
          const [r] = await tx.select({ n: investors.name }).from(investors).where(eq(investors.id, tk.subjectId)).limit(1);
          clientName = r?.n ?? null;
        } else if (tk.subjectType === "lead") {
          const [r] = await tx.select({ n: leads.name }).from(leads).where(eq(leads.id, tk.subjectId)).limit(1);
          clientName = r?.n ?? null;
        }

        const uploaded: Array<{ docId: string; key: string; label: string; size: number; mime: string }> = [];
        for (const item of incoming) {
          let key: string;
          let size: number;
          if (item.kind === "bytes") {
            // Verify real type by bytes — declared mime is attacker-controlled.
            if (!isAllowedDocType(item.buf)) throw new Error(`${item.label}: file is not a valid PDF, JPG or PNG`);
            key = vaultKey(tk.tenantId!, "kyc", item.name, { firm, uploader: "client-upload", client: clientName, docType: "kyc" });
            await putObject(key, item.buf, item.mime);
            size = item.buf.length;
          } else {
            // Presigned path: the object is already in S3 — fetch it back and
            // verify the bytes, deleting + rejecting anything that isn't a real
            // PDF/JPG/PNG (a forged key, or a bait-and-switch upload).
            let bytes: Buffer;
            try {
              bytes = await getObjectBytes(item.key);
            } catch {
              throw new Error(`${item.label}: upload not found — please retry`);
            }
            if (bytes.length === 0) throw new Error(`${item.label}: empty upload`);
            if (bytes.length > MAX_BYTES) {
              await deleteObject(item.key).catch(() => {});
              throw new Error(`${item.label}: file too large (max 10 MB)`);
            }
            if (!isAllowedDocType(bytes)) {
              await deleteObject(item.key).catch(() => {});
              throw new Error(`${item.label}: file is not a valid PDF, JPG or PNG`);
            }
            key = item.key;
            size = item.size || bytes.length;
          }

          const docId = uuid();
          await tx.insert(complianceDocuments).values({
            id: docId,
            tenantId: tk.tenantId,
            category: "kyd" as any,
            name: item.label,
            description: item.docKey,
            storageKey: key,
            mimeType: item.mime,
            sizeBytes: String(size),
            relatedEntityType: tk.subjectType,
            relatedEntityId: tk.subjectId,
            tags: ["onboarding", "client_uploaded", item.docKey] as any,
          } as any);
          uploaded.push({ docId, key, label: item.label, size, mime: item.mime });
        }

        if (uploaded.length === 0 && !hasKyc) throw new Error("No documents or details received");

        // ─── Write collected KYC fields into the client master ──────────────
        if (hasKyc) {
          try {
            if (tk.subjectType === "investor") {
              const [inv] = await tx
                .select({
                  pan: investors.pan,
                  email: investors.email,
                  phone: investors.phone,
                  whatsappPhone: investors.whatsappPhone,
                  address: investors.address,
                  bankAccounts: investors.bankAccounts,
                  nominees: investors.nominees,
                  kycData: investors.kycData,
                })
                .from(investors)
                .where(eq(investors.id, tk.subjectId));
              const update = mapKycFieldsToInvestorUpdate(kycValues, inv ?? undefined);
              await tx
                .update(investors)
                .set({ ...update, kycData: { ...((inv?.kycData as any) ?? {}), ...kycValues }, updatedAt: new Date() } as any)
                .where(eq(investors.id, tk.subjectId));
            } else if (tk.subjectType === "lead") {
              await tx
                .update(leads)
                .set({ kycData: kycValues, updatedAt: new Date() } as any)
                .where(eq(leads.id, tk.subjectId));
            }
          } catch (kErr) {
            console.error("[docs/submit] client-master KYC write failed:", (kErr as Error)?.message);
          }
        }

        // Advance lead stage
        if (tk.subjectType === "lead") {
          await tx
            .update(leads)
            .set({ stage: "docs_received" as any, stageChangedAt: new Date(), updatedAt: new Date() } as any)
            .where(eq(leads.id, tk.subjectId));
          try {
            await transitionTo(tx, tk.tenantId!, tk.subjectId, "docs_received", {
              systemBypass: true,
              remarks: `Client uploaded ${uploaded.length} document(s) via secure link.`,
            });
          } catch (e) {
            console.error("[docs/submit] blueprint advance failed:", e);
          }
        }

        await tx.insert(eventsOutbox).values({
          tenantId: tk.tenantId,
          kind: "documents.received",
          entityType: tk.subjectType,
          entityId: tk.subjectId,
          after: { docs: uploaded, kyc: kycValues, signature: signatureName, notes: extraNotes },
          meta: { tokenId, ip, userAgent: ua } as any,
        } as any);

        return { uploaded: uploaded.length, uploadedDocs: uploaded };
      });
    } catch (e) {
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    await finalizeShareToken({
      id: tokenId,
      result: { uploaded: out.uploadedDocs, signature: signatureName, notes: extraNotes },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json({ uploaded: out.uploaded }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
