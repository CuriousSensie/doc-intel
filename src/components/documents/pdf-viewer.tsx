import { getTranslations } from "next-intl/server";

// specs/05-level-1-structure.md §Document page: "our own viewer component, no Paperless
// frontend code." Native browser rendering against our own signed, session-authenticated
// proxy route (src/app/api/documents/[id]/preview/route.ts) — no PDF.js dependency for the
// MVP; every modern browser renders a PDF inline via <object>/<iframe> on its own.
export async function PdfViewer({ documentId, title }: { documentId: string; title: string }) {
  const t = await getTranslations("documents.detail");
  const previewUrl = `/api/documents/${documentId}/preview`;

  return (
    <object
      aria-label={t("previewAlt", { title })}
      className="h-[70vh] w-full rounded-lg border border-border bg-panel-strong"
      data={previewUrl}
      // sandboxed via an <object>, not an <iframe>, so there's no embedded-JS surface at all —
      // a plain browser plugin viewer for the returned content type.
      type="application/pdf"
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">{t("cannotPreview")}</p>
        <a
          className="text-sm font-semibold text-accent underline underline-offset-4"
          href={`/api/documents/${documentId}/download`}
        >
          {t("download", { title })}
        </a>
      </div>
    </object>
  );
}
