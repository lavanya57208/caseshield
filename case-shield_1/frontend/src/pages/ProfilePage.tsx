import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/format";
import { ShieldCheck, Smartphone, KeyRound, History, Building2 } from "lucide-react";

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Profile &amp; Security</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">Profile</h2>
          <dl className="space-y-3 text-sm">
            <Row label="Full name" value={user.fullName} />
            <Row label="Role" value={user.roles.map((r) => r.name).join(", ")} />
            <Row label="Organization" value={user.organization ?? "—"} />
            <Row label="Department" value={user.department ?? "—"} />
            <Row label="Official identifier" value={user.officialIdentifier ?? "—"} />
            <Row label="Email" value={user.email} />
            <Row label="Last login" value={formatDateTime(user.lastLoginAt)} />
            <Row label="Account status" value="Active" />
          </dl>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Multi-factor authentication
            </h2>
            <p className="text-sm text-ink-muted">
              {user.mfaEnabled ? "MFA is enabled on this account." : "MFA is not currently enabled on this demo account."}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              This prototype includes an MFA-ready verification endpoint; enforcement is configured per deployment.
            </p>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <Smartphone className="h-4 w-4" aria-hidden="true" /> Active sessions
            </h2>
            <p className="text-sm text-ink-muted">You are currently signed in on this device.</p>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <KeyRound className="h-4 w-4" aria-hidden="true" /> Password
            </h2>
            <button className="btn-secondary" disabled>
              Change password (disabled in demo environment)
            </button>
          </div>

          <div className="card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <History className="h-4 w-4" aria-hidden="true" /> Recent security events
            </h2>
            <p className="text-sm text-ink-muted">
              Review your account's login history and security events in the <a href="/audit" className="text-teal hover:underline">Audit &amp; Security Center</a>.
            </p>
          </div>
        </div>
      </div>

      <div className="card flex items-start gap-3 p-5 text-sm text-ink-muted">
        <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-subtle" aria-hidden="true" />
        This is a development/demo environment. Identities shown here are fictional and created for the Case Shield
        prototype demonstration.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2.5 last:border-0 last:pb-0">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
