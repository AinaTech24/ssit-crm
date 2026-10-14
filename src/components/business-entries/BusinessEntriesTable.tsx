"use client";

/**
 * BusinessEntriesTable — the business-entries list rendered through the generic
 * BulkTable so rows can be selected and bulk-acted (status / reassign RM /
 * delete). Column rendering mirrors the previous server-rendered table.
 */

import Link from "next/link";
import { formatINR } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { BUSINESS_ENTRY_STATUSES } from "@/db/schema/business_entries";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";

const PRODUCT_LABEL: Record<string, string> = {
  mutual_fund: "Mutual Fund", pms: "PMS", aif: "AIF", sif: "SIF", bond: "Bond", ncd: "NCD", other: "Other",
};
// Derived daily from the CKYC expiry date (daily-ops-scanner), not typed by
// hand — so "expired" here is a fact about the client, not a stale label.
const KYC_TONE: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700",
  registered: "bg-sky-50 text-sky-700",
  pending: "bg-amber-50 text-amber-700",
  hold: "bg-amber-50 text-amber-700",
  re_kyc_required: "bg-amber-50 text-amber-700",
  expired: "bg-rose-50 text-rose-600",
  rejected: "bg-rose-50 text-rose-600",
};
const KYC_LABEL: Record<string, string> = {
  re_kyc_required: "Re-KYC",
};

const TXN_LABEL: Record<string, string> = {
  sip: "SIP", sip_topup: "SIP Top-Up", sip_stop: "SIP Stop", lumpsum: "Lumpsum", additional_purchase: "Add'l Purchase",
  switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption", other: "Others",
};
const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  confirmed: "bg-sky-50 text-sky-700",
  emailed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-rose-50 text-rose-600",
};

type Row = {
  id: string;
  clientName: string;
  investorId: string | null;
  avatarUrl: string | null;
  productType: string;
  businessDate: string | Date;
  status: string;
  totalAmount: string | number;
  rmName: string | null;
  lineCount: number;
  /** Distinct transaction types across the entry's lines. */
  txnTypes: string[];
  /** null for an entry logged against a free-text name with no client record. */
  kycStatus: string | null;
};

export function BusinessEntriesTable({ rows, rmOptions }: { rows: Row[]; rmOptions: { value: string; label: string }[] }) {
  const columns: BulkColumn<Row>[] = [
    {
      key: "date",
      header: "Date",
      thClass: "text-left py-2 font-medium",
      tdClass: "py-2.5 text-xs tabular-nums whitespace-nowrap",
      render: (r) => (
        <Link href={`/dashboard/business-entries/${r.id}`} className="no-underline hover:no-underline">
          {new Date(r.businessDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
        </Link>
      ),
    },
    {
      key: "client",
      header: "Client",
      thClass: "text-left py-2 font-medium",
      tdClass: "py-2.5 font-medium",
      render: (r) => (
        <Link href={`/dashboard/business-entries/${r.id}`} className="flex items-center gap-2 hover:underline">
          <Avatar
            src={r.avatarUrl && r.investorId ? `/api/investors/${r.investorId}/avatar` : null}
            name={r.clientName}
            size={24}
          />
          <span className="truncate">{r.clientName}</span>
        </Link>
      ),
    },
    {
      key: "kyc",
      header: "KYC",
      thClass: "text-left py-2 font-medium",
      tdClass: "py-2.5",
      render: (r) =>
        r.kycStatus ? (
          <span className={`chip text-[10px] capitalize ${KYC_TONE[r.kycStatus] ?? ""}`}>
            {KYC_LABEL[r.kycStatus] ?? r.kycStatus}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground" title="No client record linked to this entry">
            —
          </span>
        ),
    },
    { key: "product", header: "Product", thClass: "text-left py-2 font-medium", tdClass: "py-2.5 text-xs text-muted-foreground", render: (r) => PRODUCT_LABEL[r.productType] ?? r.productType },
    { key: "txnType", header: "Transaction type", thClass: "text-left py-2 font-medium", tdClass: "py-2.5 text-xs", render: (r) => (r.txnTypes?.length ? r.txnTypes.map((t) => TXN_LABEL[t] ?? t).join(", ") : "—") },
    { key: "schemes", header: "Schemes", thClass: "text-right py-2 font-medium", tdClass: "py-2.5 text-right text-xs tabular-nums", render: (r) => r.lineCount },
    { key: "amount", header: "Amount", thClass: "text-right py-2 font-medium", tdClass: "py-2.5 text-right tabular-nums font-medium", render: (r) => formatINR(Number(r.totalAmount)) },
    { key: "rm", header: "RM", thClass: "text-left py-2 font-medium pl-8", tdClass: "py-2.5 text-xs text-muted-foreground pl-8", render: (r) => r.rmName ?? "—" },
    {
      key: "status",
      header: "Status",
      thClass: "text-left py-2 font-medium pr-4",
      tdClass: "py-2.5 pr-4",
      render: (r) => <span className={`chip text-[10px] capitalize ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>,
    },
  ];

  const actions: BulkAction[] = [
    { kind: "status", label: "Set status", options: BUSINESS_ENTRY_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as [string, string]) },
    ...(rmOptions.length ? [{ kind: "assign", label: "Reassign RM", options: rmOptions } as BulkAction] : []),
    { kind: "delete", label: "Delete" },
  ];

  return <BulkTable rows={rows} columns={columns} endpoint="/api/business-entries/bulk" actions={actions} itemLabel="entry" rowHref={(e) => `/dashboard/business-entries/${e.id}`} />;
}
