import Link from "next/link";
import type { Route } from "next";

import { dashboardNavigation } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/modules/auth/auth.actions";
import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { profile, user } = await requireUser("/dashboard");

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-col justify-between gap-6 border-b border-border pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
            Dashboard shell
          </p>
          <h1 className="mt-4 text-4xl font-black">Dashboard</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">
            Signed in as {profile?.name ?? user.email}. Module dashboards land in their dedicated
            feature branches.
          </p>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Logout
          </Button>
        </form>
      </header>
      <nav aria-label="Dashboard sections" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {dashboardNavigation.map((item) => (
          <Link
            className="rounded-lg border border-border bg-panel p-4 font-semibold shadow-sm transition-colors hover:bg-panel-strong"
            href={item.href as Route}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
