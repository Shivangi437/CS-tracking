interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/today";

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
      <h1 className="text-lg font-semibold">CS Performance Tracker</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Enter the shared dashboard password.
      </p>
      <form
        method="POST"
        action="/api/auth/login"
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        {sp.error ? (
          <p className="text-xs text-[var(--bad)]">
            {sp.error === "wrong" ? "Wrong password." : sp.error}
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
