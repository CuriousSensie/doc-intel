"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listOrganizationMembersAction } from "@/modules/organizations/organizations.actions";
import {
  grantFolderAccessAction,
  listFolderAccessAction,
  revokeFolderAccessAction
} from "@/modules/folders/folders.actions";
import type { FolderPermission } from "@/modules/folders/folders.schemas";
import type { Folder, FolderAccessGrant } from "@/modules/folders/folders.service";

type Member = { userId: string; name: string | null; email: string };

function memberLabel(member: Member | undefined, userId: string): string {
  if (!member) return userId;
  return member.name || member.email || userId;
}

// ADR-0019: access cascades from ancestors — a grant made on an ancestor folder also grants this
// folder and everything under it. `ancestorFolderIds` resolves that chain (parentFolderId walk on
// the already-fetched flat tree list), one for the caller since this component only knows about
// the single folder it manages.
export function FolderAccessManager({
  folder,
  ancestorFolderIds
}: {
  folder: Folder;
  ancestorFolderIds: string[];
}) {
  const t = useTranslations("folders.access");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [directGrants, setDirectGrants] = useState<FolderAccessGrant[] | null>(null);
  const [inheritedGrants, setInheritedGrants] = useState<FolderAccessGrant[]>([]);
  const [query, setQuery] = useState("");
  const [permission, setPermission] = useState<FolderPermission>("view");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [membersResult, ownGrants, ...ancestorGrantLists] = await Promise.all([
          listOrganizationMembersAction(),
          listFolderAccessAction(folder.id),
          ...ancestorFolderIds.map((id) => listFolderAccessAction(id))
        ]);
        if (cancelled) return;
        setMembers(membersResult);
        setDirectGrants(ownGrants);
        setInheritedGrants(ancestorGrantLists.flat());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // ancestorFolderIds is derived fresh from the tree list on every render of the caller — join
    // it so this effect only reruns when the actual id set changes, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id, ancestorFolderIds.join(",")]);

  function refresh() {
    startTransition(async () => {
      try {
        const grants = await listFolderAccessAction(folder.id);
        setDirectGrants(grants);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("loadFailed"));
      }
    });
  }

  function grant(member: Member) {
    startTransition(async () => {
      try {
        await grantFolderAccessAction({ folderId: folder.id, userId: member.userId, permission });
        toast.success(t("granted", { name: memberLabel(member, member.userId) }));
        setQuery("");
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("grantFailed"));
      }
    });
  }

  function revoke(userId: string) {
    startTransition(async () => {
      try {
        await revokeFolderAccessAction({ folderId: folder.id, userId });
        toast.success(t("revoked"));
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("revokeFailed"));
      }
    });
  }

  if (!members || !directGrants) {
    return error ? (
      <p className="text-sm text-danger">{error}</p>
    ) : (
      <div className="grid gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const byUserId = new Map(members.map((m) => [m.userId, m]));
  const directUserIds = new Set(directGrants.map((g) => g.userId));
  // An inherited grant only matters here if it isn't also overridden by a direct one on this
  // folder — the direct grant is what actually governs access at this level.
  const visibleInherited = inheritedGrants.filter((g) => !directUserIds.has(g.userId));
  const inheritedByUserId = new Map(visibleInherited.map((g) => [g.userId, g]));
  const q = query.trim().toLowerCase();
  const candidates = q
    ? members.filter(
        (m) =>
          !directUserIds.has(m.userId) &&
          (memberLabel(m, m.userId).toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      )
    : [];

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("directTitle")}</h3>
        {directGrants.length === 0 ? (
          <p className="text-sm text-muted">{t("noDirectGrants")}</p>
        ) : (
          <ul className="grid gap-1.5">
            {directGrants.map((g) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md bg-panel-strong/50 px-3 py-1.5"
                key={g.id}
              >
                <span className="min-w-0 truncate text-sm">{memberLabel(byUserId.get(g.userId), g.userId)}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="muted">{t(`permission.${g.permission}`)}</Badge>
                  <Button
                    aria-label={t("revoke")}
                    className="size-7 min-h-7"
                    disabled={isPending}
                    onClick={() => revoke(g.userId)}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {visibleInherited.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("inheritedTitle")}</h3>
          <p className="text-xs text-muted">{t("inheritedHint")}</p>
          <ul className="grid gap-1.5">
            {[...inheritedByUserId.values()].map((g) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-1.5"
                key={g.id}
              >
                <span className="min-w-0 truncate text-sm text-muted">
                  {memberLabel(byUserId.get(g.userId), g.userId)}
                </span>
                <Badge variant="muted">{t(`permission.${g.permission}`)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("addTitle")}</h3>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["view", "edit"] as const).map((perm) => (
              <button
                aria-pressed={permission === perm}
                className="px-3 py-1.5 text-sm data-[active=true]:bg-panel-strong data-[active=true]:font-semibold"
                data-active={permission === perm}
                key={perm}
                onClick={() => setPermission(perm)}
                type="button"
              >
                {t(`permission.${perm}`)}
              </button>
            ))}
          </div>
        </div>
        <Input
          disabled={isPending}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchMembers")}
          value={query}
        />
        {q ? (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
            {candidates.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">{t("noMatches")}</li>
            ) : (
              candidates.map((member) => (
                <li key={member.userId}>
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-panel-strong disabled:opacity-50"
                    disabled={isPending}
                    onClick={() => grant(member)}
                    type="button"
                  >
                    <span className="truncate">{memberLabel(member, member.userId)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
