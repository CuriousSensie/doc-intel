import { getTranslations } from "next-intl/server";

import type { DocumentDetails } from "@/modules/documents/documents.service";

// specs/02-data-model.md: content lives only in Paperless, fetched live for this render —
// never mirrored. "Summary" is an explicitly upcoming (Level 2 AI) feature, shown as a disabled
// placeholder so the tab's eventual shape is visible without promising it works yet.
export async function DocumentContentTab({ document }: { document: DocumentDetails }) {
  const t = await getTranslations("documents.detail.content");

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-dashed border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("summaryTitle")}</h3>
          <span className="rounded-full bg-panel-strong px-2 py-0.5 text-xs font-semibold text-muted">
            {t("comingSoon")}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{t("summaryDescription")}</p>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("fullContent")}</h3>
        {document.paperless === null ? (
          <p className="mt-2 text-sm text-muted">{t("unavailable")}</p>
        ) : document.paperless.content.trim().length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("empty")}</p>
        ) : (
          <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-panel-strong/40 p-4 text-sm leading-6">
            {document.paperless.content}
          </pre>
        )}
      </div>
    </div>
  );
}
