"use client";

import { useRouter } from "@/i18n/navigation";

import { DocumentActionsMenu } from "@/components/documents/document-actions-menu";

// Thin adapter for the flat listings (list/small/large cards): the shared DocumentActionsMenu plus
// a router.refresh() so the current page picks up a rename/delete without a manual reload. The
// folder explorer uses DocumentActionsMenu directly with its own tree+cache refresh.
export function DocumentRowActions({
  documentId,
  title,
  detailHref,
  onChanged
}: {
  documentId: string;
  title: string;
  detailHref: string;
  onChanged?: () => void;
}) {
  const router = useRouter();

  return (
    <DocumentActionsMenu
      detailHref={detailHref}
      documentId={documentId}
      onChanged={onChanged ?? (() => router.refresh())}
      title={title}
    />
  );
}
