"use client";

/**
 * ProposalsBulkTable — the proposals list rendered through the generic BulkTable
 * so rows can be selected and bulk-deleted (select-all → Delete → clear). Per-row
 * edit/cancel stays available via RowActions. Cell rendering mirrors the previous
 * server-rendered table, and each column keeps its `data-col` so the existing
 * <ColumnManager moduleKey="proposals"> still shows/hides columns.
 */

import { useState } from "react";
import Link from "next/link";
import { Ban } from "lucide-react";
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { Avatar } from "@/components/ui/Avatar";
import { PdfModal } from "@/components/common/PdfModal";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700", ready: "bg-blue-50 text-blue-700", sent: "bg-amber-50 text-amber-700",
  viewed: "bg-cyan-50 text-cyan-700", accepted: "bg-emerald-50 text-emerald-700", rejected: "bg-rose-50 text-rose-700", expired: "bg-slate-50 text-slate-700",
};
const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive", mutual_fund: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", mixed: "Mixed",
};
const TYPE_TONE: Record<string, string> = {
  comprehensive: "bg-violet-50 text-violet-700", mutual_fund: "bg-emerald-50 text-emerald-700", insurance: "bg-blue-50 text-blue-700",
  pms: "bg-amber-50 text-amber-700", aif: "bg-rose-50 text-rose-700", mixed: "bg-purple-50 text-purple-700",
};

type Row = Record<string, any> & { id: string };

const actions: BulkAction[] = [{ kind: "delete", label: "Delete" }];

export function ProposalsBulkTable({ rows }: { rows: Row[] }) {
  const [preview, setPreview] = useState<Row | null>(null);
  const columns: BulkColumn<Row>[] = [
    {
      key: "number", colKey: "number", header: "#", thClass: "text-left px-4 py-2 font-medium", tdClass: "px-4 py-3 text-xs whitespace-nowrap",
      render: (p) => (
        <Link href={`/dashboard/proposals/${p.id}`} className="text-brand-cyan-deep hover:underline font-semibold" title={p.proposal_number}>{p._seq ?? p.proposal_number}</Link>
      ),
    },
    {
      key: "title", colKey: "title", header: "Title", tdClass: "py-3 text-xs",
      render: (p) => (
        <>
          <div className="font-medium text-foreground">{p.title}</div>
          {p.risk_rating && <div className="text-[10px] text-muted-foreground capitalize">Risk · {p.risk_rating}</div>}
        </>
      ),
    },
    {
      key: "recipient", colKey: "recipient", header: "Recipient", tdClass: "py-3 text-xs whitespace-nowrap",
      render: (p) => {
        const isLead = p.recipient_type === "lead";
        const eid = isLead ? p.lead_id : p.investor_id;
        const avatarUrl = isLead ? p.lead_avatar_url : p.investor_avatar_url;
        return (
          <div className="flex items-center gap-2">
            <Avatar
              src={eid && avatarUrl ? `/api/${isLead ? "leads" : "investors"}/${eid}/avatar` : null}
              name={p.recipient_name}
              size={26}
            />
            <div>
              <div className="font-medium">{p.recipient_name}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{p.recipient_type}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "type", colKey: "type", header: "Type", tdClass: "py-3",
      render: (p) => <span className={`chip ${TYPE_TONE[p.type] ?? ""} text-[10px]`}>{TYPE_LABEL[p.type] ?? p.type}</span>,
    },
    {
      key: "invest", colKey: "invest", header: "Invest ₹", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums text-xs whitespace-nowrap",
      render: (p) => (p.total_investment ? formatINR(Number(p.total_investment)) : "—"),
    },
    {
      key: "corpus", colKey: "corpus", header: "Corpus ₹", thClass: "text-right py-2 font-medium pr-6", tdClass: "py-3 pr-6 text-right tabular-nums text-xs text-emerald-700 font-medium whitespace-nowrap",
      render: (p) => (p.expected_corpus ? formatINR(Number(p.expected_corpus)) : "—"),
    },
    {
      key: "status", colKey: "status", header: "Status", thClass: "text-left py-2 font-medium pl-3", tdClass: "py-3 pl-3",
      render: (p) => <span className={`chip capitalize ${STATUS_TONE[p.status] ?? ""}`}>{String(p.status).replace(/_/g, " ")}</span>,
    },
    {
      key: "valid_till", colKey: "valid_till", header: "Valid till", tdClass: "py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap",
      render: (p) => (p.valid_until ? formatDate(p.valid_until) : "—"),
    },
    { key: "prepared_by", colKey: "prepared_by", header: "Prepared by", tdClass: "py-3 text-xs whitespace-nowrap", render: (p) => p.prepared_by ?? "—" },
    {
      key: "created", colKey: "created", header: "Created", tdClass: "py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap",
      render: (p) => formatDate(p.created_at),
    },
    {
      key: "actions", colKey: "actions", header: "", thClass: "px-4 py-2", tdClass: "px-4 py-3 text-right",
      render: (p) => (
        <RowActions inline deleteIcon={Ban} editHref={`/dashboard/proposals/${p.id}`} deleteUrl={`/api/proposals/${p.id}`} itemLabel="proposal" itemName={p.proposal_number} verb="Cancel" />
      ),
    },
  ];

  return (
    <>
      <BulkTable
        rows={rows}
        columns={columns}
        endpoint="/api/proposals/bulk"
        actions={actions}
        itemLabel="proposal"
        tableKey="proposals"
        scrollBody
        onRowClick={(p) => setPreview(p)}
      />
      {preview && (
        <PdfModal
          title={`Proposal · ${preview.recipient_name ?? preview.proposal_number}`}
          pdfUrl={`/api/proposals/${preview.id}/pdf`}
          downloadUrl={`/api/proposals/${preview.id}/pdf?download=1`}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
