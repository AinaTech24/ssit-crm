import Link from "next/link";
import { Database } from "lucide-react";

const MASTER_TYPES = [
  { type: "lead_source", label: "Lead Sources", desc: "Where leads come from — referral, website, ads, etc." },
  { type: "campaign_type", label: "Campaign Types", desc: "Campaign categories used in marketing module." },
  { type: "service_request_type", label: "Service Request Types", desc: "Each type carries an SLA in hours." },
  { type: "task_priority", label: "Task Priority Levels", desc: "Low / Normal / High / Urgent." },
  { type: "client_category", label: "Client Categories", desc: "Individual / HUF / NRI / Corporate / Trust / Minor." },
  { type: "goal_type", label: "Goal Types", desc: "Retirement, Child Education, House, etc." },
  { type: "risk_profile_level", label: "Risk Profile Levels", desc: "Conservative → Very Aggressive." },
  { type: "ddq_checklist_item", label: "DDQ Checklist Items", desc: "Items scored in DDQ readiness." },
  { type: "document_type", label: "Document Types", desc: "Categories used across vault + uploads." },
  { type: "user_role", label: "User Roles", desc: "Roles assignable to team members." },
  { type: "interest_product", label: "Interest Products", desc: "Products leads may be interested in." },
  { type: "occupation", label: "Occupations", desc: "Investor occupation options." },
  { type: "income_range", label: "Income Ranges", desc: "Used in client profiling + segmentation." },
  { type: "meeting_type", label: "Meeting Types", desc: "Portfolio review / Goal review / etc." },
  { type: "relationship", label: "Family Relationships", desc: "Used in family mapping module." },
];

export const dynamic = "force-dynamic";

export default function MastersPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Master settings</h1>
        <p className="text-muted-foreground text-sm">
          Look-up values used across the app. System defaults are seeded on signup; you can add custom entries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {MASTER_TYPES.map((m) => (
          <Link
            key={m.type}
            href={`/dashboard/settings/masters/${m.type}`}
            className="border rounded-lg p-4 bg-card hover:bg-accent/40 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Database className="size-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{m.desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
