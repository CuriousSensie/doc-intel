"use client";

import { Folder, FolderUp, Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { documentsConfig } from "@/config/documents";
import { createClient } from "@/lib/supabase/client";
import { resolveOrCreateFolderPathsAction } from "@/modules/folders/folders.actions";

type UploadIntentResponse = {
  data?: { upload_id: string; url: string; token: string; path: string };
  error?: { message: string };
};

type UploadCompleteResponse = {
  data?: { upload_id: string; status: string };
  error?: { message: string };
};

type QueuedFile = {
  id: string;
  file: File;
  // The directory portion of File.webkitRelativePath (e.g. "Documents/Invoices/2025") —
  // includes the user's picked root folder name as its first segment (confirmed: webkitdirectory
  // always prefixes every relative path with the folder the user chose, never just its contents).
  dirPath: string;
  status: "queued" | "uploading" | "processing" | "failed";
  error?: string;
};

// Node value is this folder's own children — a plain nested Map is enough for a display-only
// preview built from path strings, before any of them are real folders.service.ts rows yet.
type PreviewNode = Map<string, PreviewNode>;

function buildPreviewTree(dirPaths: string[]): PreviewNode {
  const root: PreviewNode = new Map();
  for (const dirPath of dirPaths) {
    let cursor = root;
    for (const segment of dirPath.split("/").filter((s) => s.length > 0)) {
      let next = cursor.get(segment);
      if (!next) {
        next = new Map();
        cursor.set(segment, next);
      }
      cursor = next;
    }
  }
  return root;
}

function FolderPreviewList({ node, depth }: { node: PreviewNode; depth: number }) {
  return (
    <ul className={depth === 0 ? "grid gap-0.5" : "ml-3 grid gap-0.5 border-l border-border pl-3"}>
      {[...node.entries()].map(([name, children]) => (
        <li key={name}>
          <div className="flex items-center gap-1.5 text-sm">
            <Folder className="size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{name}</span>
          </div>
          {children.size > 0 ? <FolderPreviewList depth={depth + 1} node={children} /> : null}
        </li>
      ))}
    </ul>
  );
}

const MAX_PARALLEL_UPLOADS = 3;

// Directory portion of a webkitdirectory-selected File's relative path — everything before the
// last "/". Always non-empty for a webkitdirectory selection (see PreviewNode's comment above).
function dirPathFor(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

function toQueuedFiles(files: FileList | File[]): QueuedFile[] {
  return Array.from(files).map((file) => ({
    id: crypto.randomUUID(),
    file,
    dirPath: dirPathFor(file),
    status: "queued" as const
  }));
}

// ADR-0019 Phase D — bulk folder upload. Mirrors document-upload-form.tsx's own queue/
// concurrency/status shape closely (same MAX_PARALLEL_UPLOADS worker-pool pattern, same per-file
// status states) but is a separate component rather than a shared refactor: the flat form's own
// request body and its test (document-upload-form.test.tsx) assert an exact JSON.stringify'd
// upload-intent body with no folderId key, so folding folderId into that shared path would have
// changed the flat upload's wire format for a feature it doesn't use.
export function FolderUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const t = useTranslations("documents.upload");

  // webkitdirectory/directory have no React/JSX typing — set as raw DOM attributes instead of
  // fighting the input's TS props.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  const uniqueDirPaths = useMemo(() => [...new Set(items.map((item) => item.dirPath))], [items]);
  const previewTree = useMemo(() => buildPreviewTree(uniqueDirPaths), [uniqueDirPaths]);
  const uploadableCount = items.filter((item) => item.status === "queued" || item.status === "failed").length;

  function addFiles(files: FileList) {
    if (files.length === 0) return;
    setItems(toQueuedFiles(files));
    if (inputRef.current) inputRef.current.value = "";
  }

  function reset() {
    setItems([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function updateItem(id: string, patch: Partial<QueuedFile>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function uploadOne(item: QueuedFile, folderId: string | null) {
    updateItem(item.id, { status: "uploading", error: undefined });

    try {
      if (item.file.size <= 0 || item.file.size > documentsConfig.maxSizeBytes) {
        throw new Error(t("invalidSize"));
      }
      if (!documentsConfig.allowedMimeTypes.includes(item.file.type)) {
        throw new Error(t("invalidType"));
      }

      const intentRes = await fetch("/api/documents/upload-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name,
          size: item.file.size,
          mimeType: item.file.type,
          folderId
        })
      });
      const intentBody = (await intentRes.json()) as UploadIntentResponse;
      if (!intentRes.ok || !intentBody.data) {
        throw new Error(intentBody.error?.message ?? t("couldNotStart"));
      }
      const { upload_id: uploadId, token, path } = intentBody.data;

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(documentsConfig.bucket)
        .uploadToSignedUrl(path, token, item.file, { contentType: item.file.type });
      if (uploadError) throw uploadError;

      const completeRes = await fetch("/api/documents/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId })
      });
      const completeBody = (await completeRes.json()) as UploadCompleteResponse;
      if (!completeRes.ok) {
        throw new Error(completeBody.error?.message ?? t("didNotComplete"));
      }

      updateItem(item.id, { status: "processing" });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("failed");
      updateItem(item.id, { status: "failed", error: message });
      return { ok: false, message };
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queued = items.filter((item) => item.status === "queued" || item.status === "failed");
    if (queued.length === 0) return;

    setUploading(true);
    try {
      let pathToFolderId: Record<string, string>;
      try {
        const dirPaths = [...new Set(queued.map((item) => item.dirPath))];
        pathToFolderId = await resolveOrCreateFolderPathsAction(dirPaths);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("folder.couldNotResolve");
        toast.error(message);
        for (const item of queued) updateItem(item.id, { status: "failed", error: message });
        return;
      }

      let cursor = 0;
      let succeeded = 0;
      let failed = 0;

      async function worker() {
        for (;;) {
          const item = queued[cursor];
          cursor++;
          if (!item) return;
          const folderId = pathToFolderId[item.dirPath] ?? null;
          const result = await uploadOne(item, folderId);
          if (result.ok) succeeded++;
          else failed++;
        }
      }

      await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, queued.length) }, () => worker()));

      if (succeeded > 0) {
        toast.success(t("receivedProcessingCount", { count: succeeded }));
        router.refresh();
      }
      if (failed > 0) {
        toast.error(t("failedCount", { count: failed }));
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      {items.length === 0 ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-background p-6 text-center transition hover:bg-muted/30">
          <input
            aria-label={t("folder.dropTitle")}
            className="sr-only"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files);
            }}
            ref={inputRef}
            type="file"
          />
          <FolderUp className="mb-3 text-muted" size={28} aria-hidden />
          <span className="text-sm font-semibold">{t("folder.dropTitle")}</span>
          <span className="mt-1 text-xs text-muted">{t("folder.dropHint")}</span>
        </label>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              {t("folder.fileCount", { count: items.length, folders: uniqueDirPaths.length })}
            </p>
            <Button disabled={uploading} onClick={reset} size="sm" type="button" variant="ghost">
              {t("folder.changeSelection")}
            </Button>
          </div>

          <div className="grid gap-1 rounded-md border border-border bg-background p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t("folder.previewTitle")}
            </p>
            <FolderPreviewList depth={0} node={previewTree} />
          </div>

          {items.some((item) => item.status === "failed") ? (
            <div className="grid gap-1" aria-live="polite">
              {items
                .filter((item) => item.status === "failed")
                .map((item) => (
                  <div
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
                    key={item.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.dirPath}/{item.file.name}</p>
                      <p className="mt-1 text-xs text-danger">{item.error}</p>
                    </div>
                    <Button
                      aria-label={t("removeFile", { name: item.file.name })}
                      disabled={uploading}
                      onClick={() => setItems((current) => current.filter((i) => i.id !== item.id))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <X size={16} aria-hidden />
                    </Button>
                  </div>
                ))}
            </div>
          ) : null}

          {uploading ? (
            <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <Loader2 className="animate-spin" size={16} aria-hidden />
              {items.some((item) => item.status === "processing")
                ? t("receivedProcessingCount", {
                    count: items.filter((item) => item.status === "processing").length
                  })
                : t("uploading")}
            </p>
          ) : null}

          <Button className="justify-self-start" disabled={uploading || uploadableCount === 0} type="submit">
            {uploading ? (
              <>
                <Loader2 className="animate-spin" size={16} aria-hidden /> {t("uploading")}
              </>
            ) : (
              <>
                <Upload size={16} aria-hidden /> {t("folder.uploadButton", { count: uploadableCount })}
              </>
            )}
          </Button>
        </div>
      )}
    </form>
  );
}
