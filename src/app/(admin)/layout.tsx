import Link from "next/link";

import { requireFeature } from "@/modules/auth/authorization";
import { requireAdmin } from "@/modules/auth/session";

const adminNav = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Organizations", href: "/admin/organizations" },
  { label: "Audit Log", href: "/admin/audit-log" }
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  requireFeature("admin");
  await requireAdmin();

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <nav aria-label="Admin sections" className="mb-8 flex flex-wrap gap-2">
        {adminNav.map((item) => (
          <Link
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-panel-strong"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
