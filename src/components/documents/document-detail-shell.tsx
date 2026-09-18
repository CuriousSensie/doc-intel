"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import { DocumentActionsBar } from "@/components/documents/document-actions-bar";
import { DocumentDetailsTab } from "@/components/documents/document-details-tab";
import { DocumentDetailTabs } from "@/components/documents/document-detail-tabs";
import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { PdfJsViewer } from "@/components/documents/pdf-js-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { recordDocumentOpen } from "@/lib/dashboard/recent-activity";
import {
  toDocumentTypeKey,
  type PaperlessCorrespondent,
  type PaperlessDocumentType,
  type PaperlessTag
} from "@/lib/paperless/documents";
import { updateDocumentAction } from "@/modules/documents/documents.actions";
import type { DocumentDetails } from "@/modules/documents/documents.service";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import {
  isCustomFieldApplicable,
  mapRawCustomFieldValues,
  type KeyedCustomFieldValues
} from "@/modules/custom-fields/custom-field-values";

export type DocumentDraft = {
  title: string;
  documentTypeId: number | null;
  correspondentId: number | null;
  tagIds: number[];
  customFieldValues: KeyedCustomFieldValues;
};

function sameTagIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function draftsEqual(a: DocumentDraft, b: DocumentDraft): boolean {
  const aCustomKeys = Object.keys(a.customFieldValues);
  const bCustomKeys = Object.keys(b.customFieldValues);
  return (
    a.title === b.title &&
    a.documentTypeId === b.documentTypeId &&
    a.correspondentId === b.correspondentId &&
    sameTagIds(a.tagIds, b.tagIds) &&
    aCustomKeys.length === bCustomKeys.length &&
    aCustomKeys.every((key) => Object.is(a.customFieldValues[key], b.customFieldValues[key]))
  );
}

function draftFrom(
  document: DocumentDetails,
  typeId: number | null,
  correspondentId: number | null,
  customFieldDefs: CustomFieldDef[]
): DocumentDraft {
  return {
    title: document.title,
    documentTypeId: typeId,
    correspondentId: correspondentId,
    tagIds: document.paperless?.tagIds ?? [],
    customFieldValues: mapRawCustomFieldValues(document.paperless?.customFields, customFieldDefs)
  };
}

// Owns everything the document detail page needs client-side state for: the one page-level
// "Save changes" bar (not per-tab — draft edits from the Details tab, with Permissions to join
// once it has real fields; Connections stays its own instant two-interaction actions per
// specs/05-level-1-structure.md, deliberately not folded into this draft/save cycle), and —
// the actual fix for "editing is slow" — updating local state directly from what
// updateDocumentAction() already returns instead of a post-save router.refresh(). A refresh
// re-ran the *entire* page's data-fetch waterfall (document + connections + a live Paperless
// read + history + three metadata lists + two adjacent-document lookups) for a one-field edit;
// this cuts that to exactly the one PATCH the save itself needs.
export function DocumentDetailShell({
  initialDocument,
  filterOptions,
  previousId,
  nextId,
  ctxQuery,
  customFieldDefs,
  contentTab,
  historyTab,
  connectionsTab
}: {
  initialDocument: DocumentDetails;
  filterOptions: {
    tags: PaperlessTag[];
    correspondents: PaperlessCorrespondent[];
    documentTypes: PaperlessDocumentType[];
  };
  previousId: string | null;
  nextId: string | null;
  ctxQuery: string;
  customFieldDefs: CustomFieldDef[];
  // Async Server Components (getTranslations, etc.) — must be constructed in the server-side
  // page.tsx and passed down as already-rendered elements. Building `<DocumentContentTab/>` (or
  // ConnectionsPanel/DocumentHistoryTab) directly inside this "use client" file's own render
  // function breaks with "`getTranslations` is not supported in Client Components" — found live
  // the moment tabs got lifted into this shell.
  contentTab: ReactNode;
  historyTab: ReactNode;
  connectionsTab: ReactNode;
}) {
  const t = useTranslations("documents.detail");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [document, setDocument] = useState(initialDocument);
  const [tagOptions, setTagOptions] = useState(filterOptions.tags);
  const [correspondentOptions, setCorrespondentOptions] = useState(filterOptions.correspondents);
  const [documentTypeOptions, setDocumentTypeOptions] = useState(filterOptions.documentTypes);

  const initialTypeId = useMemo(
    () => documentTypeOptions.find((dt) => toDocumentTypeKey(dt.name) === document.document_type_key)?.id ?? null,
    // Deliberately only recomputed from the *initial* document type key — after that, draft/
    // baseline carry the id forward themselves (see handleSave), so this never needs to
    // re-derive from the mirror's string field again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const initialCorrespondentId = useMemo(
    () => correspondentOptions.find((c) => c.name === document.correspondent_name)?.id ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [baseline, setBaseline] = useState<DocumentDraft>(() =>
    draftFrom(document, initialTypeId, initialCorrespondentId, customFieldDefs)
  );
  const [draft, setDraft] = useState<DocumentDraft>(baseline);
  const isDirty = !draftsEqual(draft, baseline);

  // Easy Access "recently accessed documents" (dashboard, localStorage-only) — record on arrival
  // regardless of entry point (list row, search, direct link).
  useEffect(() => {
    recordDocumentOpen({ id: initialDocument.id, title: initialDocument.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocument.id]);

  function handleDraftChange(next: Partial<DocumentDraft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function handleDiscard() {
    setDraft(baseline);
    setError(null);
  }

  function handleSave() {
    const input: Record<string, unknown> = {};
    if (draft.title !== baseline.title) input.title = draft.title;
    if (draft.documentTypeId !== baseline.documentTypeId) input.documentTypeId = draft.documentTypeId;
    if (draft.correspondentId !== baseline.correspondentId) input.correspondentId = draft.correspondentId;
    if (!sameTagIds(draft.tagIds, baseline.tagIds)) input.tagIds = draft.tagIds;
    const customFieldChanged = !draftsEqual(
      { ...baseline, title: draft.title, documentTypeId: draft.documentTypeId, correspondentId: draft.correspondentId, tagIds: draft.tagIds },
      draft
    );
    if (customFieldChanged) {
      const applicableDefs = customFieldDefs.filter(
        (def) => def.data_type !== "documentlink" && isCustomFieldApplicable(def, document.document_type_key)
      );
      input.customFieldValues = applicableDefs
        .filter((def) => draft.customFieldValues[def.key] !== undefined)
        .map((def) => ({ key: def.key, value: draft.customFieldValues[def.key] }));
    }
    if (Object.keys(input).length === 0) return;

    startTransition(async () => {
      try {
        const updated = await updateDocumentAction(document.id, input);
        setDocument((prev) => ({
          ...prev,
          ...updated,
          paperless: prev.paperless ? { ...prev.paperless, tagIds: draft.tagIds } : prev.paperless
        }));
        setBaseline(draft);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("picker.saveFailed"));
      }
    });
  }

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-8rem)] lg:grid-rows-[auto_minmax(0,1fr)]">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-2xl font-black">{draft.title || document.title}</h1>
            <DocumentStatusBadge status={document.status} />
          </div>
          <DocumentActionsBar
            ctxQuery={ctxQuery}
            documentId={document.id}
            nextId={nextId}
            previousId={previousId}
          />
        </div>

        {isDirty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel p-3 shadow-sm">
            <p className="text-sm text-muted">{error ?? t("unsavedChanges")}</p>
            <div className="flex gap-2">
              <Button disabled={isPending} onClick={handleDiscard} variant="outline">
                {t("actions.cancel")}
              </Button>
              <Button disabled={isPending} onClick={handleSave}>
                {isPending ? t("saving") : t("saveChanges")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* min-w-0 on both children — grid items default to min-width:auto (their content's
          intrinsic width), which was forcing the whole row to overflow horizontally instead of
          the 60/40 split actually shrinking as the window narrows. */}
      <div className="grid min-h-0 gap-4 lg:grid-cols-[60%_40%]">
        <div className="min-h-0 min-w-0 lg:h-full">
          <PdfJsViewer documentId={document.id} title={document.title} />
        </div>

        <Card className="flex min-h-0 min-w-0 flex-col lg:h-full">
          <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
            {document.paperless === null ? (
              <p className="mb-4 shrink-0 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
                {t("liveDataUnavailable")}
              </p>
            ) : null}

            <DocumentDetailTabs
              connections={connectionsTab}
              content={contentTab}
              details={
                <DocumentDetailsTab
                  correspondentOptions={correspondentOptions}
                  document={document}
                  documentTypeOptions={documentTypeOptions}
                  draft={draft}
                  customFieldDefs={customFieldDefs.filter(
                    (def) => def.data_type !== "documentlink" && isCustomFieldApplicable(def, document.document_type_key)
                  )}
                  onCorrespondentCreated={(c) => setCorrespondentOptions((prev) => [...prev, c])}
                  onDocumentTypeCreated={(dt) => setDocumentTypeOptions((prev) => [...prev, dt])}
                  onDraftChange={handleDraftChange}
                  onTagCreated={(tag) => setTagOptions((prev) => [...prev, tag])}
                  tagOptions={tagOptions}
                />
              }
              history={historyTab}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
