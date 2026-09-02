/**
 * Provider-agnostic KYC verification adapter.
 *
 * Faster onboarding is itself a service experience — a client should be verified
 * in minutes, not days of an RM transcribing KRA portals. This is the contract +
 * wiring; the actual verification is delegated to whichever provider the MFD
 * licenses (Karza / Hyperverge / IDfy / Signzy / Digio). Live mode hits a
 * configured endpoint; stub mode (default) returns a deterministic result for
 * dev/demo. Honest: real verification needs paid provider credentials — this
 * does the integration scaffolding, not the verification itself.
 *
 * Env:
 *   KYC_PROVIDER     karza | hyperverge | idfy | signzy | digio | (unset ⇒ stub)
 *   KYC_API_URL      provider verification endpoint (POST JSON)
 *   KYC_API_KEY      provider API key (sent as Authorization: Bearer / x-api-key)
 *   KYC_STUB_STATUS  dev override for stub status (default 'verified')
 */

export type KycVerifyInput = {
  pan?: string | null;
  name?: string | null;
  dob?: string | null; // yyyy-mm-dd
  aadhaarLast4?: string | null;
};

export type KycStatus = "verified" | "not_found" | "mismatch" | "pending" | "error";

export type KycVerifyResult = {
  status: KycStatus;
  ckycNumber: string | null;
  nameAsPerPan: string | null;
  panAadhaarLinked: boolean | null;
  provider: string;
  message?: string;
  raw?: unknown;
};

export function kycProvider(): string {
  return process.env.KYC_PROVIDER ?? "stub";
}

export async function verifyKyc(input: KycVerifyInput): Promise<KycVerifyResult> {
  const provider = kycProvider();

  // ── Live: delegate to the configured provider endpoint ─────────────────
  if (provider !== "stub" && process.env.KYC_API_URL) {
    try {
      const res = await fetch(process.env.KYC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.KYC_API_KEY ? { authorization: `Bearer ${process.env.KYC_API_KEY}`, "x-api-key": process.env.KYC_API_KEY } : {}),
        },
        body: JSON.stringify({ pan: input.pan, name: input.name, dob: input.dob, aadhaar_last4: input.aadhaarLast4 }),
        cache: "no-store",
      });
      if (!res.ok) return { status: "error", ckycNumber: null, nameAsPerPan: null, panAadhaarLinked: null, provider, message: `provider HTTP ${res.status}` };
      const j: any = await res.json();
      // Provider responses vary; map the common fields defensively.
      const status: KycStatus = (j.status ?? j.kyc_status ?? "pending") as KycStatus;
      return {
        status: (["verified", "not_found", "mismatch", "pending", "error"].includes(status) ? status : "pending"),
        ckycNumber: j.ckyc_number ?? j.ckycNumber ?? null,
        nameAsPerPan: j.name_as_per_pan ?? j.nameAsPerPan ?? null,
        panAadhaarLinked: typeof j.pan_aadhaar_linked === "boolean" ? j.pan_aadhaar_linked : null,
        provider,
        raw: j,
      };
    } catch (e: any) {
      return { status: "error", ckycNumber: null, nameAsPerPan: null, panAadhaarLinked: null, provider, message: e?.message ?? "provider call failed" };
    }
  }

  // Never return a believable stub verification in production. A missing paid
  // provider must be visible as an operational error, not client KYC evidence.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_PROVIDERS !== "1") {
    return {
      status: "error",
      ckycNumber: null,
      nameAsPerPan: null,
      panAadhaarLinked: null,
      provider: "unconfigured",
      message: "KYC provider is not configured for production",
    };
  }

  // ── Stub: deterministic, no network. PAN must look valid to "verify". ──
  const panOk = !!input.pan && /^[A-Z]{5}\d{4}[A-Z]$/.test(input.pan.toUpperCase());
  const status = (process.env.KYC_STUB_STATUS as KycStatus) ?? "verified";
  if (!panOk) {
    return { status: "not_found", ckycNumber: null, nameAsPerPan: null, panAadhaarLinked: null, provider, message: "PAN format invalid (stub)" };
  }
  return {
    status,
    ckycNumber: `CKYC${(input.pan ?? "").toUpperCase().slice(0, 5)}${String(Math.abs(hashCode(input.pan ?? "")) % 1e9).padStart(9, "0")}`,
    nameAsPerPan: input.name ?? null,
    panAadhaarLinked: true,
    provider,
    message: "stub verification — configure KYC_PROVIDER + KYC_API_URL for live",
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
