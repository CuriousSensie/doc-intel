// specs/05-level-1-structure.md §Document page: "our own viewer component, no Paperless
// frontend code." Native browser rendering against our own signed, session-authenticated
// proxy route (src/app/api/documents/[id]/preview/route.ts) — no PDF.js dependency for the
// MVP; every modern browser renders a PDF inline via <object>/<iframe> on its own.
export function PdfViewer({ documentId, title }: { documentId: string; title: string }) {
  const previewUrl = `/api/documents/${documentId}/preview`;

  return (
    <object
      aria-label={`Preview of ${title}`}
      className="h-[70vh] w-full rounded-lg border border-border bg-panel-strong"
      data={previewUrl}
      // sandboxed via an <object>, not an <iframe>, so there's no embedded-JS surface at all —
      // a plain browser plugin viewer for the returned content type.
      type="application/pdf"
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">
          This file can&apos;t be previewed inline in your browser.
        </p>
        <a
          className="text-sm font-semibold text-accent underline underline-offset-4"
          href={`/api/documents/${documentId}/download`}
        >
          Download {title}
        </a>
      </div>
    </object>
  );
}
