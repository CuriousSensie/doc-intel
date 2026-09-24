import { Link } from "@/i18n/navigation";

// One organization per account (see plan: organizations/team revamp) — replaces the old
// multi-org switcher dropdown with a plain link to the org's team settings.
export function OrganizationBadge({ name }: { name: string }) {
  return (
    <Link
      className="flex min-h-10 min-w-0 items-center truncate rounded-md border border-border bg-panel px-3 text-sm font-semibold transition hover:border-foreground"
      href="/organizations"
    >
      {name}
    </Link>
  );
}
