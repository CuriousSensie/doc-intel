"use client";

import { useRef } from "react";

import { switchOrganizationAction } from "@/modules/organizations/organizations.actions";
import type { Organization } from "@/modules/organizations/organizations.service";

export function OrganizationSwitcher({
  organizations,
  activeOrganizationId,
  next
}: {
  organizations: Organization[];
  activeOrganizationId: string | null;
  next?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (organizations.length === 0) {
    return null;
  }

  return (
    <form action={switchOrganizationAction} className="flex items-center gap-2" ref={formRef}>
      <input name="next" type="hidden" value={next ?? "/organizations"} />
      <select
        aria-label="Switch organization"
        className="min-h-10 rounded-md border border-border bg-panel px-3 text-sm font-semibold outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
        defaultValue={activeOrganizationId ?? ""}
        name="organizationId"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </form>
  );
}
