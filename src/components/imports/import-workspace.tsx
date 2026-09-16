"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { EntityType } from "@/modules/entity-types/entity-types.service";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import type {
  ImportJob,
  AnalyzeImportResult,
  ValidateImportSummary
} from "@/modules/imports/imports.service";
import {
  analyzeImportJobAction,
  getImportJobAction,
  updateImportMappingAction,
  validateImportJobAction,
  startImportJobAction,
  pauseImportJobAction,
  resumeImportJobAction,
  cancelImportJobAction,
  retryFailedRowsAction,
  saveImportMappingAction
} from "@/modules/imports/imports.actions";
import type { AnalysisOptions, ImportMapping } from "@/modules/imports/imports.schemas";

import { controlClass, SelectField, Status } from "./import-controls";
import { importPercent, shouldPoll, terminalStatuses, unwrap } from "./import-utils";

const ImportMappingForm = dynamic(
  () => import("./import-mapping").then((module) => module.ImportMappingForm),
  { loading: ImportSectionLoading }
);
const ImportRows = dynamic(() => import("./import-rows").then((module) => module.ImportRows), {
  loading: ImportSectionLoading
});
function ImportSectionLoading() {
  const t = useTranslations("imports");
  return (
    <div role="status" className="h-32 rounded-md bg-panel-strong motion-safe:animate-pulse">
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
}

type BusyAction =
  "analyzing" | "validating" | "start" | "pause" | "resume" | "cancel" | "retry" | "save";
type DocumentProgress = { total: number; completed: number; failed: number; pending: number };
type Props = {
  initialJob: ImportJob;
  entityTypes: EntityType[];
  customFields: CustomFieldDef[];
  canWrite: boolean;
};
export function ImportWorkspace({ initialJob, entityTypes, customFields, canWrite }: Props) {
  const t = useTranslations("imports");
  const [job, setJob] = useState(initialJob);
  const options = job.options as {
    analysis?: AnalyzeImportResult;
    validation?: ValidateImportSummary;
  } | null;
  const [analysis, setAnalysis] = useState(options?.analysis);
  const [summary, setSummary] = useState(options?.validation);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<BusyAction | "">("");
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [started, setStarted] = useState(false);
  const [documentProgress, setDocumentProgress] = useState<DocumentProgress | null>(null);
  const [encoding, setEncoding] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [mappingName, setMappingName] = useState("");
  const [saved, setSaved] = useState(false);
  const [mappingVersion, setMappingVersion] = useState(0);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const done = terminalStatuses.has(job.status);
  const showMapping = editing || job.status === "mapping";
  const showReview = job.status === "ready" && !editing && !started;
  const showProgress = started || shouldPoll(job.status) || done;
  const stage = showProgress ? 3 : showReview ? 2 : showMapping ? 1 : 0;
  const pollNeeded =
    started ||
    shouldPoll(job.status) ||
    (job.kind === "documents" &&
      done &&
      (documentProgress === null || documentProgress.pending > 0));

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [stage]);
  useEffect(() => {
    if (!pollNeeded) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let failures = 0;
    async function poll() {
      if (!active) return;
      if (window.document.hidden) {
        timer = setTimeout(poll, 2000);
        return;
      }
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 15000);
      try {
        const response = await fetch(`/api/imports/${job.id}`, {
          cache: "no-store",
          signal: request.signal
        });
        if (!response.ok) throw new Error("poll");
        const result = await response.json();
        if (!result.data) throw new Error("poll");
        if (active) {
          setJob((previous) => ({ ...previous, ...result.data }));
          setDocumentProgress(result.data.document_progress ?? null);
          if (result.data.validation) setSummary(result.data.validation);
          setPollError(false);
          failures = 0;
          if (result.data.status !== "ready") setStarted(false);
        }
      } catch {
        if (active) {
          failures++;
          setPollError(true);
        }
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(poll, Math.min(15000, 2000 * 2 ** failures));
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      request?.abort();
    };
  }, [job.id, pollNeeded]);

  async function run(label: BusyAction, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("requestError"));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  async function analyze() {
    await run("analyzing", async () => {
      const result = await unwrap(
        analyzeImportJobAction(job.id, {
          ...(encoding ? { encoding: encoding as AnalysisOptions["encoding"] } : {}),
          ...(delimiter ? { delimiter: delimiter as AnalysisOptions["delimiter"] } : {})
        })
      );
      setAnalysis(result);
      setSummary(undefined);
      setConfirmed(false);
      setMappingVersion((version) => version + 1);
      setJob(await unwrap(getImportJobAction(job.id)));
      setEditing(false);
    });
  }
  async function validate(mapping: ImportMapping) {
    await run("validating", async () => {
      const mapped = await unwrap(updateImportMappingAction(job.id, mapping));
      setJob(mapped);
      setSummary(undefined);
      setConfirmed(false);
      setSaved(false);
      const result = await unwrap(validateImportJobAction(job.id));
      setSummary(result);
      setJob(await unwrap(getImportJobAction(job.id)));
      setEditing(false);
    });
  }
  async function control(action: "pause" | "resume" | "cancel" | "retry" | "start") {
    await run(action, async () => {
      if (action === "start") {
        await unwrap(startImportJobAction(job.id));
        setStarted(true);
      } else if (action === "retry") {
        const result = await unwrap(retryFailedRowsAction(job.id));
        if (result.count) {
          await unwrap(startImportJobAction(job.id));
          setStarted(true);
        }
        setJob(await unwrap(getImportJobAction(job.id)));
      } else {
        const fn =
          action === "pause"
            ? pauseImportJobAction
            : action === "resume"
              ? resumeImportJobAction
              : cancelImportJobAction;
        setJob(await unwrap(fn(job.id)));
      }
      setCancelConfirm(false);
    });
  }
  return (
    <div className="mx-auto grid max-w-5xl gap-7">
      <Link
        className="justify-self-start text-sm text-muted underline-offset-4 hover:underline"
        href="/dashboard/imports"
      >
        {t("backToImports")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            ref={heading}
            tabIndex={-1}
            className="break-words text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
          >
            {job.source_filename ?? t("untitled")}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {t(`kind.${job.kind}`)} · {t("rowCount", { count: job.total_rows })}
          </p>
        </div>
        <Status status={job.status} />
      </header>
      <ol aria-label={t("importSteps")} className="grid grid-cols-4 border-b border-border">
        {(["fileStep", "mappingStep", "reviewStep", "resultsStep"] as const).map((key, index) => (
          <li
            key={key}
            aria-current={stage === index ? "step" : undefined}
            className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-xs sm:text-sm ${stage === index ? "border-accent font-semibold text-foreground" : "border-transparent text-muted"}`}
          >
            <span aria-hidden className="hidden sm:inline">
              {stage > index ? <Check size={16} /> : index + 1}
            </span>
            {t(key)}
          </li>
        ))}
      </ol>
      {!canWrite && <p className="text-sm text-muted">{t("readOnly")}</p>}
      {error && (
        <div role="alert" className="rounded-md border border-danger/40 p-4 text-sm text-danger">
          {error}
          <p className="mt-1">{t("retryHint")}</p>
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted">
          {t(`busy.${busy}`)}
        </p>
      )}
      {(job.status === "draft" || (showMapping && !analysis)) && (
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">{t("inspectFile")}</h2>
          <p className="max-w-prose text-muted">{t("inspectHelp")}</p>
          <Button
            className="justify-self-start"
            disabled={!!busy || !canWrite}
            onClick={() => void analyze()}
          >
            {t("analyzeFile")}
          </Button>
          {job.status === "draft" && (
            <p className="text-sm text-muted">
              {t("draftRecovery")}{" "}
              <Link className="underline underline-offset-4" href="/dashboard/imports/new">
                {t("newImport")}
              </Link>
            </p>
          )}
        </section>
      )}
      {showMapping && analysis && (
        <>
          <section className="grid min-w-0 gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t("filePreview")}</h2>
              <p className="mt-1 text-sm text-muted">{t("previewHelp")}</p>
            </div>
            {analysis.encoding && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  {t("fileSettings")} · {analysis.encoding}
                </summary>
                <div className="mt-3 grid items-end gap-3 sm:grid-cols-3">
                  <SelectField
                    label={t("encoding")}
                    value={encoding}
                    onChange={(e) => setEncoding(e.target.value)}
                    disabled={!!busy}
                  >
                    <option value="">{t("automatic")}</option>
                    {[
                      "UTF-8",
                      "windows-1250",
                      "windows-1252",
                      "ISO-8859-2",
                      "UTF-16LE",
                      "UTF-16BE"
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </SelectField>
                  <SelectField
                    label={t("delimiter")}
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value)}
                    disabled={!!busy}
                  >
                    <option value="">{t("automatic")}</option>
                    <option value=";">{t("semicolon")}</option>
                    <option value=",">{t("comma")}</option>
                    <option value={"\t"}>{t("tab")}</option>
                  </SelectField>
                  <Button
                    variant="outline"
                    disabled={!!busy || !canWrite}
                    onClick={() => void analyze()}
                  >
                    {t("applyFileSettings")}
                  </Button>
                </div>
                <p className="mt-2 text-muted">{t("reparseHelp")}</p>
              </details>
            )}
            <div className="min-w-0 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t("filePreview")}</caption>
                <thead className="bg-panel-strong">
                  <tr>
                    {analysis.columns.map((column) => (
                      <th
                        scope="col"
                        key={column.index}
                        className="min-w-36 max-w-xs px-4 py-3 font-medium"
                      >
                        <span className="line-clamp-2 break-words">{column.header}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[0, 1, 2]
                    .filter((index) =>
                      analysis.columns.some((column) => column.sample[index] !== undefined)
                    )
                    .map((index) => (
                      <tr key={index}>
                        {analysis.columns.map((column) => (
                          <td className="max-w-xs px-4 py-3" key={column.index}>
                            <span className="block truncate" title={column.sample[index]}>
                              {column.sample[index] || "—"}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {analysis.rowCount === 0 && (
              <p role="alert" className="text-danger">
                {t("emptyFile")}
              </p>
            )}
          </section>
          {canWrite && (
            <ImportMappingForm
              key={mappingVersion}
              kind={job.kind}
              columns={analysis.columns}
              initial={job.mapping}
              entityTypes={entityTypes}
              customFields={customFields}
              busy={!!busy || analysis.rowCount === 0}
              onSubmit={(mapping) => void validate(mapping)}
            />
          )}
        </>
      )}
      {showReview && (
        <>
          <section className="grid gap-5">
            <div>
              <h2 className="text-xl font-semibold">{t("reviewTitle")}</h2>
              <p className="mt-2 max-w-prose text-muted">{t("reviewHelp")}</p>
            </div>
            {summary ? (
              <dl className="grid grid-cols-2 gap-5 border-y border-border py-5 sm:grid-cols-5">
                {(["ok", "skippedDuplicate", "unmatched", "needsReview", "failed"] as const).map(
                  (key) => (
                    <div key={key}>
                      <dt className="text-sm text-muted">{t(`summary.${key}`)}</dt>
                      <dd
                        className={`mt-1 text-2xl font-semibold tabular-nums ${key === "failed" && summary.failed > 0 ? "text-danger" : ""}`}
                      >
                        {(key === "failed"
                          ? summary.failed - (summary.unmatched ?? 0)
                          : (summary[key] ?? 0)
                        ).toLocaleString()}
                      </dd>
                    </div>
                  )
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">{t("validationMissing")}</p>
            )}
            {canWrite && (
              <>
                <Button
                  variant="outline"
                  className="justify-self-start"
                  disabled={!!busy}
                  onClick={() => {
                    setEditing(true);
                    setConfirmed(false);
                  }}
                >
                  {t("editMapping")}
                </Button>
                <a
                  className="justify-self-start text-sm underline underline-offset-4"
                  href={`/api/imports/${job.id}/report`}
                >
                  {t("downloadReport")}
                </a>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("saveMapping")}
                  </summary>
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("save", async () => {
                        await unwrap(
                          saveImportMappingAction({
                            name: mappingName,
                            kind: job.kind,
                            mapping: job.mapping
                          })
                        );
                        setSaved(true);
                      });
                    }}
                  >
                    <label className="grid gap-1.5 text-sm">
                      {t("mappingName")}
                      <input
                        className={controlClass}
                        required
                        maxLength={100}
                        value={mappingName}
                        onChange={(e) => {
                          setMappingName(e.target.value);
                          setSaved(false);
                        }}
                      />
                    </label>
                    <Button disabled={!!busy || !mappingName.trim()} variant="outline">
                      {t("save")}
                    </Button>
                    {saved && (
                      <p className="text-sm text-accent" role="status">
                        {t("mappingSaved")}
                      </p>
                    )}
                  </form>
                </details>
                {summary && (
                  <>
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-accent"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      <span>
                        {t(
                          summary.failed + summary.needsReview > 0
                            ? "confirmWithErrors"
                            : "confirmReview"
                        )}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="max-w-prose text-sm text-muted">{t("backgroundHelp")}</p>
                      <Button
                        disabled={
                          !confirmed || !!busy || summary.ok + summary.skippedDuplicate === 0
                        }
                        onClick={() => void control("start")}
                      >
                        {t("startImport")}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
          <ImportRows id={job.id} review />
        </>
      )}
      {showProgress && (
        <>
          <section className="grid gap-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">
                {t(
                  done
                    ? "importResults"
                    : started && job.status === "ready"
                      ? "waitingWorker"
                      : "importProgress"
                )}
              </h2>
              <span className="text-sm tabular-nums">{importPercent(job)}%</span>
            </div>
            <progress
              className="h-2 w-full overflow-hidden rounded-full accent-accent [&::-webkit-progress-bar]:bg-panel-strong [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent"
              aria-label={t("importProgress")}
              value={job.processed_rows}
              max={Math.max(job.total_rows, 1)}
            />
            <p className="text-sm text-muted" role="status">
              {t("processed", { processed: job.processed_rows, total: job.total_rows })}
            </p>
            {pollError && (
              <p role="status" className="text-sm text-danger">
                {t("pollError")}
              </p>
            )}
            {job.error && (
              <p role="alert" className="text-sm text-danger">
                {job.error}
              </p>
            )}
            <dl className="flex flex-wrap gap-x-10 gap-y-3">
              {(["succeeded_rows", "skipped_rows", "failed_rows"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-sm text-muted">{t(key)}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {job[key].toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
            {job.kind === "documents" && (
              <div className="grid gap-2 border-t border-border pt-5">
                <h3 className="font-medium">{t("documentProcessing")}</h3>
                <p className="max-w-prose text-sm text-muted">{t("ocrHelp")}</p>
                {documentProgress ? (
                  <>
                    <p className="text-sm tabular-nums">{t("ocrCounts", documentProgress)}</p>
                    {documentProgress.total > 0 && (
                      <progress
                        aria-label={t("documentProcessing")}
                        className="h-2 w-full accent-accent"
                        value={documentProgress.completed + documentProgress.failed}
                        max={documentProgress.total}
                      />
                    )}
                    {documentProgress.failed > 0 && (
                      <p className="text-sm text-danger">{t("ocrFailures")}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted">{t("loadingProcessing")}</p>
                )}
                <Link
                  className="justify-self-start text-sm underline underline-offset-4"
                  href="/dashboard/documents"
                >
                  {t("viewDocuments")}
                </Link>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {canWrite && (
                <>
                  {job.status === "running" && (
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void control("pause")}
                    >
                      {t("pause")}
                    </Button>
                  )}
                  {job.status === "paused" && (
                    <Button disabled={!!busy} onClick={() => void control("resume")}>
                      {t("resume")}
                    </Button>
                  )}
                  {["completed_with_errors", "failed"].includes(job.status) &&
                    job.failed_rows > 0 && (
                      <Button disabled={!!busy} onClick={() => void control("retry")}>
                        {t("retryFailed")}
                      </Button>
                    )}
                  {["running", "paused"].includes(job.status) && (
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() => setCancelConfirm(true)}
                    >
                      {t("cancelImport")}
                    </Button>
                  )}
                </>
              )}
              {done && (
                <Button asChild variant="outline">
                  <a href={`/api/imports/${job.id}/report`}>
                    <Download size={16} />
                    {t("downloadReport")}
                  </a>
                </Button>
              )}
            </div>
            {cancelConfirm && (
              <div className="grid gap-3 rounded-md border border-border p-4">
                <p className="text-sm">{t("cancelHelp")}</p>
                <div className="flex gap-3">
                  <Button disabled={!!busy} onClick={() => void control("cancel")}>
                    {t("confirmCancel")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => setCancelConfirm(false)}
                  >
                    {t("keepImporting")}
                  </Button>
                </div>
              </div>
            )}
            {!done && <p className="text-sm text-muted">{t("backgroundHelp")}</p>}
          </section>
          {done && <ImportRows id={job.id} />}
        </>
      )}
    </div>
  );
}
