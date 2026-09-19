"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, use, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  shareDocumentAction,
  unshareDocumentAction
} from "@/modules/documents/document-shares.actions";
import type {
  DocumentPerson,
  DocumentPermission,
  DocumentPermissions,
  DocumentShare,
  PermissionsResult,
  ShareableMember
} from "@/modules/documents/document-shares.service";

function label(person: { name: string | null; email: string | null }): string {
  return person.name || person.email || "";
}

function MemberSearchAdd({
  candidates,
  disabled,
  onAdd
}: {
  candidates: ShareableMember[];
  disabled: boolean;
  onAdd: (member: ShareableMember) => void;
}) {
  const t = useTranslations("documents.share");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? candidates.filter((m) => label(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    : [];

  return (
    <div className="grid gap-1">
      <Input
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("searchMembers")}
        value={query}
      />
      {q ? (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t("noMatches")}</li>
          ) : (
            matches.map((member) => (
              <li key={member.userId}>
                <button
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-panel-strong disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => {
                    onAdd(member);
                    setQuery("");
                  }}
                  type="button"
                >
                  <span className="truncate">{label(member)}</span>
                  {member.isReadOnly ? (
                    <span className="shrink-0 text-xs text-muted">{t("readOnlyMember")}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function PersonList({
  people,
  emptyLabel,
  hideEmpty,
  canRemove,
  disabled,
  onRemove
}: {
  people: DocumentShare[];
  emptyLabel: string;
  // Suppresses the "no one" text when a broader everyone-grant already covers this section.
  hideEmpty: boolean;
  canRemove: boolean;
  disabled: boolean;
  onRemove: (share: DocumentShare) => void;
}) {
  const t = useTranslations("documents.share");
  if (people.length === 0) {
    return hideEmpty ? null : <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="grid gap-1.5">
      {people.map((share) => (
        <li
          className="flex items-center justify-between gap-2 rounded-md bg-panel-strong/50 px-3 py-1.5"
          key={share.id}
        >
          <span className="min-w-0 truncate text-sm">{label(share)}</span>
          {canRemove ? (
            <Button
              aria-label={t("remove")}
              className="size-7 min-h-7"
              disabled={disabled}
              onClick={() => onRemove(share)}
              size="icon"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EveryoneToggle({
  checked,
  disabled,
  label: text,
  hint,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  hint?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        checked={checked}
        className="mt-1 size-4"
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="font-medium">{text}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function PersonRow({
  person,
  badge,
  fallback
}: {
  person: DocumentPerson | null;
  badge: string;
  fallback: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-panel-strong/50 px-3 py-1.5">
      <span className="min-w-0 truncate text-sm">{person ? label(person) : fallback}</span>
      <Badge variant="muted">{badge}</Badge>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-12" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

// Owner / Created by / Can edit / Can view. Managers (creator or owner) can edit the lists;
// everyone else gets a read-only summary plus their own access. The data is fetched on the server
// by the page (started, not awaited, in parallel with the rest of the page) and streamed in as a
// promise, so opening the tab is instant; each change returns the refreshed data.
export function DocumentPermissionsTab({
  documentId,
  permissions
}: {
  documentId: string;
  permissions: Promise<PermissionsResult>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <PermissionsContent documentId={documentId} initial={permissions} />
    </Suspense>
  );
}

function PermissionsContent({
  documentId,
  initial
}: {
  documentId: string;
  initial: Promise<PermissionsResult>;
}) {
  const t = useTranslations("documents.share");
  const result = use(initial);
  const [data, setData] = useState<DocumentPermissions | null>(result.ok ? result.data : null);
  const [isPending, startTransition] = useTransition();

  function mutate(action: () => Promise<DocumentPermissions>, failure: string) {
    startTransition(async () => {
      try {
        setData(await action());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : failure);
      }
    });
  }

  if (!data) {
    return <p className="text-sm text-danger">{t("loadFailed")}</p>;
  }

  const shares = data.shares;
  const everyone = shares.find((s) => s.userId === null) ?? null;
  const everyoneCanEdit = everyone?.permission === "edit";
  const everyoneCanView = everyone !== null;
  const editors = shares.filter((s) => s.userId !== null && s.permission === "edit");
  const viewers = shares.filter((s) => s.userId !== null && s.permission === "view");
  const editorIds = new Set(editors.map((s) => s.userId));
  const viewerIds = new Set(viewers.map((s) => s.userId));
  const editCandidates = data.members.filter((m) => !m.isReadOnly && !editorIds.has(m.userId));
  const viewCandidates = data.members.filter((m) => !editorIds.has(m.userId) && !viewerIds.has(m.userId));

  const setPerson = (userId: string, permission: DocumentPermission, name: string) =>
    mutate(async () => {
      const next = await shareDocumentAction({ documentId, userId, permission });
      toast.success(t("shared", { name }));
      return next;
    }, t("shareFailed"));
  const removePerson = (share: DocumentShare) =>
    mutate(async () => {
      const next = await unshareDocumentAction({ documentId, userId: share.userId });
      toast.success(t("removed"));
      return next;
    }, t("removeFailed"));
  const setEveryone = (permission: DocumentPermission, on: boolean) =>
    mutate(
      () =>
        on
          ? shareDocumentAction({ documentId, userId: null, permission })
          : unshareDocumentAction({ documentId, userId: null }),
      t("shareFailed")
    );

  const mine = shares.find((s) => s.userId !== null && s.userId === data.currentUserId);

  return (
    <div className="grid gap-6 pb-4">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("ownerTitle")}</h3>
        <PersonRow badge={t("ownerBadge")} fallback={t("unknown")} person={data.owner} />
        <p className="text-xs text-muted">{t("ownerNote")}</p>
      </section>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("createdByTitle")}</h3>
        <PersonRow badge={t("createdByBadge")} fallback={t("unknown")} person={data.createdBy} />
      </section>

      {data.canManage ? (
        <>
          <section className="grid gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("editTitle")}</h3>
            <EveryoneToggle
              checked={everyoneCanEdit}
              disabled={isPending}
              hint={t("everyoneEditHint")}
              label={t("everyoneEdit")}
              onChange={(on) => setEveryone("edit", on)}
            />
            <PersonList
              canRemove
              disabled={isPending}
              emptyLabel={t("noEditors")}
              hideEmpty={everyoneCanEdit}
              onRemove={removePerson}
              people={editors}
            />
            {everyoneCanEdit ? null : (
              <MemberSearchAdd
                candidates={editCandidates}
                disabled={isPending}
                onAdd={(m) => setPerson(m.userId, "edit", label(m))}
              />
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("viewTitle")}</h3>
            <EveryoneToggle
              checked={everyoneCanView}
              disabled={isPending || everyoneCanEdit}
              hint={everyoneCanEdit ? t("everyoneViewImplied") : undefined}
              label={t("everyoneView")}
              onChange={(on) => setEveryone("view", on)}
            />
            <PersonList
              canRemove
              disabled={isPending}
              emptyLabel={t("noViewers")}
              hideEmpty={everyoneCanView}
              onRemove={removePerson}
              people={viewers}
            />
            {everyoneCanView ? null : (
              <MemberSearchAdd
                candidates={viewCandidates}
                disabled={isPending}
                onAdd={(m) => setPerson(m.userId, "view", label(m))}
              />
            )}
          </section>
        </>
      ) : (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("yourAccess")}</h3>
          <p className="text-sm">
            {t("yourAccessValue", {
              permission: t(`permission.${mine?.permission ?? everyone?.permission ?? "view"}`)
            })}
          </p>
          {everyone ? (
            <p className="text-xs text-muted">{t(`everyoneNotice.${everyone.permission}`)}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
