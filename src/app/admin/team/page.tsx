import { listTeamMembers } from "@/lib/team-members";
import { TeamMemberAdmin } from "@/components/TeamMemberAdmin";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const members = await listTeamMembers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team roster</h1>
        <p className="text-sm text-[var(--muted)]">
          Manually-curated list. Drives the &quot;Editing as&quot; dropdown on
          the escalation detail page and the Slack DM target for credit /
          status / agent-change notifications. Slack member IDs are entered by
          hand — no Slack API lookup happens.
        </p>
      </div>

      <TeamMemberAdmin initial={members} />

      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--muted)]">
        <p>
          <strong>How to find a Slack member ID:</strong> in Slack, click the
          person&apos;s name → <em>View full profile</em> → <em>... menu</em> →{" "}
          <em>Copy member ID</em>. It looks like <code>U07ABC123XY</code>.
        </p>
        <p className="mt-2">
          <strong>Removing vs deactivating:</strong> uncheck Active to keep the
          row for audit-log lookups but hide them from dropdowns. Remove fully
          deletes the row (audit log entries that reference their name remain
          as plain text).
        </p>
      </div>
    </div>
  );
}
