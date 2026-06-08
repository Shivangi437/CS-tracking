import Link from "next/link";
import { listExecutives } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const execs = await listExecutives();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Executives</h1>
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-right">Detail</th>
            </tr>
          </thead>
          <tbody>
            {execs.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-6 text-center text-[var(--muted)]"
                >
                  No active executives. Run a sync.
                </td>
              </tr>
            ) : (
              execs.map((e) => (
                <tr key={e.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-medium">
                    {e.name.split("||")[0].trim() || e.name}
                  </td>
                  <td className="px-3 py-2 text-[var(--muted)]">
                    {e.email ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/agents/${e.id}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
