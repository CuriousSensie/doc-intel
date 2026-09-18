"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberWithProfile } from "@/modules/organizations/organizations.service";

function memberLabel(member: MemberWithProfile): string {
  return member.profile?.name || member.profile?.email || member.user_id;
}

// Owner's per-member stats picker — brief requires "compact and usable regardless of org size":
// a searchable, scrollable dropdown over the already-fetched member list (no per-keystroke
// network call needed, org membership lists are small enough to filter client-side), never a
// rendered list of every member's stats at once. Selecting a member updates ?member= via a
// shallow route replace (same pattern as documents-filter-bar.tsx) so the server component
// re-renders just its own Suspense boundary.
export function MemberPicker({
  members,
  selectedMemberId
}: {
  members: MemberWithProfile[];
  selectedMemberId: string;
}) {
  const t = useTranslations("dashboard.home");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = members.find((member) => member.user_id === selectedMemberId);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => memberLabel(member).toLowerCase().includes(q));
  }, [members, query]);

  function selectMember(memberId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("member", memberId);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        className="justify-between gap-3"
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
        type="button"
        variant="outline"
      >
        <span className="truncate">{selected ? memberLabel(selected) : t("selectMember")}</span>
        <ChevronDown className="size-4 shrink-0" />
      </Button>

      {open ? (
        <div className="absolute z-10 mt-2 w-72 rounded-md border border-border bg-panel p-2 shadow-md">
          <Input
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchMembers")}
            value={query}
          />
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted">{t("noMembersFound")}</li>
            ) : (
              filtered.map((member) => (
                <li key={member.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-strong"
                    onClick={() => selectMember(member.user_id)}
                    type="button"
                  >
                    <span className="truncate">{memberLabel(member)}</span>
                    {member.user_id === selectedMemberId ? (
                      <span className="shrink-0 text-xs text-muted">{t("selected")}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
