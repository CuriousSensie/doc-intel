"use client";

import { FileUp, Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { documentsConfig } from "@/config/documents";
import { createClient } from "@/lib/supabase/client";

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
  status: "queued" | "uploading" | "processing" | "failed";
  error?: string;
};

const MAX_PARALLEL_UPLOADS = 3;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeFiles(current: QueuedFile[], files: File[]): QueuedFile[] {
  const seen = new Set(current.map((item) => `${item.file.name}:${item.file.size}`));
  const next = [...current];
  for (const file of files) {
    const key = `${file.name}:${file.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      id: crypto.randomUUID(),
      file,
      status: "queued"
    });
  }
  return next;
}

// specs/01-architecture.md §Upload: intent -> direct-to-storage PUT (bypasses our server) ->
// complete. Client-side because step 2 has to run in the browser against the signed URL — a
// Server Action can't do a direct browser-to-storage upload.
export function DocumentUploadForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const t = useTranslations("documents.upload");
  const uploadableCount = items.filter((item) => item.status === "queued" || item.status === "failed").length;

  function addFiles(files: FileList | File[]) {
    setItems((current) => mergeFiles(current, Array.from(files)));
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function updateItem(id: string, patch: Partial<QueuedFile>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function uploadOne(item: QueuedFile) {
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
          mimeType: item.file.type
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
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;

    async function worker() {
      for (;;) {
        const item = queued[cursor];
        cursor++;
        if (!item) return;
        const result = await uploadOne(item);
        if (result.ok) succeeded++;
        else failed++;
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(MAX_PARALLEL_UPLOADS, queued.length) }, () => worker())
      );
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
      <label
        className={[
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-center transition",
          compact ? "gap-0.5 p-3" : "p-6",
          dragActive ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/30",
          uploading ? "cursor-not-allowed opacity-70" : ""
        ].join(" ")}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (!uploading) addFiles(event.dataTransfer.files);
        }}
      >
        <input
          aria-label={t("dropTitle")}
          accept={documentsConfig.allowedMimeTypes.join(",")}
          className="sr-only"
          disabled={uploading}
          multiple
          onChange={(event) => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files);
          }}
          ref={inputRef}
          type="file"
        />
        <FileUp className={compact ? "text-muted" : "mb-3 text-muted"} size={compact ? 18 : 28} aria-hidden />
        <span className="text-sm font-semibold">{t("dropTitle")}</span>
        {compact ? null : <span className="mt-1 text-xs text-muted">{t("dropHint")}</span>}
      </label>

      {items.length > 0 ? (
        <div className="grid gap-2" aria-live="polite">
          {items.map((item) => (
            <div
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
              key={item.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.file.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatSize(item.file.size)} · {t(`status.${item.status}`)}
                  {item.error ? ` · ${item.error}` : ""}
                </p>
              </div>
              {item.status === "uploading" ? (
                <Loader2 className="animate-spin text-muted" size={18} aria-hidden />
              ) : item.status === "processing" ? (
                <Upload className="text-primary" size={18} aria-hidden />
              ) : (
                <Button
                  aria-label={t("removeFile", { name: item.file.name })}
                  disabled={uploading}
                  onClick={() => removeFile(item.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X size={16} aria-hidden />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {items.length > 0 ? (
        <Button className="justify-self-start" disabled={uploading || uploadableCount === 0} type="submit">
          {uploading ? t("uploading") : uploadableCount > 1 ? t("uploadCount", { count: uploadableCount }) : t("upload")}
        </Button>
      ) : null}
    </form>
  );
}
