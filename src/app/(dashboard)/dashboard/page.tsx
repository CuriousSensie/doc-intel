import { requireUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { profile, user } = await requireUser("/dashboard");

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Dashboard</p>
      <h1 className="mt-3 text-3xl font-black">
        Welcome back{profile?.name ? `, ${profile.name}` : ""}
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted">
        Signed in as {profile?.name ?? user.email}. Module dashboards land in their dedicated
        feature branches — use the sidebar to get around.
      </p>
    </div>
  );
}
