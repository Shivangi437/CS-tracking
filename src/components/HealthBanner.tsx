import type { HealthSnapshot } from "@/lib/health";

/**
 * Persistent banner at the top of the layout when the sync is unhealthy.
 * Server-rendered from `getSyncHealth()` once per request; AutoSync handles
 * the refresh on subsequent navigations.
 */
export function HealthBanner({ health }: { health: HealthSnapshot }) {
  if (health.level === "ok") return null;

  const tone =
    health.level === "broken"
      ? {
          bg: "bg-red-50",
          border: "border-red-300",
          text: "text-red-800",
          label: "Sync broken",
        }
      : {
          bg: "bg-amber-50",
          border: "border-amber-300",
          text: "text-amber-900",
          label: "Sync degraded",
        };

  const age =
    health.ageMinutes == null
      ? "never"
      : health.ageMinutes < 60
      ? `${health.ageMinutes} min ago`
      : `${Math.floor(health.ageMinutes / 60)}h ${health.ageMinutes % 60}m ago`;

  return (
    <div className={`${tone.bg} ${tone.border} border-b`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-2 text-xs">
        <div className={tone.text}>
          <span className="font-semibold">{tone.label}</span>
          <span className="mx-2">·</span>
          <span>Last successful sync: {age}</span>
          {health.stuckCount > 0 ? (
            <>
              <span className="mx-2">·</span>
              <span>
                {health.stuckCount} stuck sync{health.stuckCount === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
          {health.runningCount > 0 ? (
            <>
              <span className="mx-2">·</span>
              <span>{health.runningCount} in flight</span>
            </>
          ) : null}
        </div>
        {health.latestError ? (
          <span className={`${tone.text} opacity-70`}>
            last error: {health.latestError.slice(0, 120)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
