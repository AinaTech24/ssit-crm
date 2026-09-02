import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { AwsMonitoringDashboard } from "@/components/super-admin/AwsMonitoringDashboard";

export const dynamic = "force-dynamic";

export default async function AwsMonitoringPage() {
  const session = await requireSession();
  requirePlatform(session.roles, "platform.settings.manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AWS Monitoring</h1>
        <p className="text-muted-foreground text-sm">
          Real-time host metrics (CPU, memory, disk, network, load) refresh <strong>every second</strong> straight from the
          server; EC2 / RDS / S3 / IAM detail syncs from CloudWatch (which itself updates every 1–5 min). Green / amber / red
          shows status at a glance.
        </p>
      </div>

      <AwsMonitoringDashboard />
    </div>
  );
}
