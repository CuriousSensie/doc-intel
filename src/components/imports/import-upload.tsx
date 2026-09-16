"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { importsConfig } from "@/config/imports";
import { createImportJobAction } from "@/modules/imports/imports.actions";
import type { ImportMappingRecord } from "@/modules/imports/imports.service";
import type { ImportKind } from "@/modules/imports/imports.schemas";
import { SelectField } from "./import-controls";
import { unwrap } from "./import-utils";

export function ImportUpload({ mappings }: { mappings: ImportMappingRecord[] }) {
  const t = useTranslations("imports");
  const router = useRouter();
  const [kind, setKind] = useState<ImportKind>("entities");
  const [mappingId, setMappingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<Awaited<ReturnType<typeof createImportJobAction>>["data"]>(undefined);
  function chooseFile(next?: File) {
    setError("");
    intent.current = undefined;
    if (!next) {
      setFile(null);
      return;
    }
    if (/\.xls$/i.test(next.name)) {
      setError(t("xlsError"));
      setFile(null);
      return;
    }
    const allowed = kind === "documents" ? /\.(csv|tsv|xlsx|zip)$/i : /\.(csv|tsv|xlsx)$/i;
    if (!allowed.test(next.name) || next.size === 0 || next.size > importsConfig.maxSizeBytes) {
      setError(t("fileError"));
      setFile(null);
      return;
    }
    setFile(next);
  }
  async function upload() {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      intent.current ??= await unwrap(
        createImportJobAction({
          kind,
          filename: file.name,
          size: file.size,
          fromMappingId: mappingId || undefined
        })
      );
      const { path, token, importJobId } = intent.current;
      const { error } = await createClient()
        .storage.from(importsConfig.bucket)
        .uploadToSignedUrl(path, token, file, {
          contentType: (
            {
              csv: "text/csv",
              tsv: "text/tab-separated-values",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              zip: "application/zip"
            } as Record<string, string>
          )[file.name.split(".").pop()!.toLowerCase()]
        });
      if (error) throw new Error(t("uploadError"));
      router.push(`/dashboard/imports/${importJobId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("requestError"));
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <div className="mx-auto grid max-w-3xl gap-7">
      <Link
        className="text-sm text-muted underline-offset-4 hover:underline"
        href="/dashboard/imports"
      >
        {t("backToImports")}
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("newImport")}</h1>
        <p className="mt-2 max-w-prose text-muted">{t("newDescription")}</p>
      </header>
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <fieldset disabled={busy} className="grid min-w-0 gap-6">
          <legend className="mb-3 text-base font-semibold">{t("whatToImport")}</legend>
          <div className="divide-y divide-border border-y border-border">
            {(["entities", "documents", "metadata_only"] as const).map((value) => (
              <label
                className={`flex cursor-pointer items-start gap-3 px-3 py-4 transition-colors hover:bg-panel-strong/50 ${kind === value ? "bg-panel" : ""}`}
                key={value}
              >
                <input
                  className="mt-1 h-4 w-4 accent-accent"
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => {
                    setKind(value);
                    setMappingId("");
                    setFile(null);
                    intent.current = undefined;
                  }}
                />
                <span>
                  <span className="block font-medium">{t(`kind.${value}`)}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {t(`kindDescription.${value}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {kind !== "entities" && (
            <p className="max-w-prose text-sm text-muted">{t("entityOrderWarning")}</p>
          )}
          {mappings.some((mapping) => mapping.kind === kind) && (
            <SelectField
              label={t("savedMapping")}
              value={mappingId}
              onChange={(e) => {
                setMappingId(e.target.value);
                intent.current = undefined;
              }}
            >
              <option value="">{t("newMapping")}</option>
              {mappings
                .filter((mapping) => mapping.kind === kind)
                .map((mapping) => (
                  <option key={mapping.id} value={mapping.id}>
                    {mapping.name}
                  </option>
                ))}
            </SelectField>
          )}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) {
                if (e.dataTransfer.files.length > 1) {
                  setError(t("oneFile"));
                  return;
                }
                chooseFile(e.dataTransfer.files[0]);
              }
            }}
            className={`grid gap-3 rounded-lg border border-dashed p-6 sm:p-8 ${dragging ? "border-accent bg-accent/5" : "border-border bg-panel"}`}
          >
            <Upload className="text-muted" size={24} aria-hidden />
            <label className="font-medium" htmlFor="import-file">
              {t("chooseFile")}
            </label>
            <p className="text-sm text-muted">
              {t(kind === "documents" ? "archiveHint" : "spreadsheetHint")}
            </p>
            <input
              key={kind}
              id="import-file"
              type="file"
              accept={kind === "documents" ? ".csv,.tsv,.xlsx,.zip" : ".csv,.tsv,.xlsx"}
              className="min-w-0 w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-panel file:px-3 file:py-2 file:text-foreground focus-visible:outline-accent"
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
            {file && (
              <p className="break-all text-sm" role="status">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        </fieldset>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{t("nothingWritten")}</p>
          <Button type="submit" disabled={!file || busy}>
            {busy ? t("uploading") : t("uploadContinue")}
          </Button>
        </div>
      </form>
    </div>
  );
}
