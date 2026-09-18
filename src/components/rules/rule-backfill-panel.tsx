"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  cancelRuleBackfillFormAction,
  pauseRuleBackfillFormAction,
  previewRuleBackfillAction,
  resumeRuleBackfillFormAction,
  startRuleBackfillFormAction,
  undoRuleBackfillFormAction
} from "@/modules/rules/rules.actions";

type Backfill = {
  id: string;
  status: string;
  matched_count: number;
  applied_count: number;
};

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "failed"]);

function BackfillRow({ ruleId, backfill: initial }: { ruleId: string; backfill: Backfill }) {
  const t = useTranslations("rules.backfill");
  const [backfill, setBackfill] = useState(initial);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(backfill.status)) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/rule-backfills/${backfill.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (active && body.data) setBackfill((prev) => ({ ...prev, ...body.data }));
      } catch {
        // transient polling failure — next tick retries, matching import-workspace.tsx's tolerance
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [backfill.id, backfill.status]);

  return (
    <div className="grid gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <Badge variant={backfill.status === "running" ? "accent" : "muted"}>
          {backfill.status}
        </Badge>
        <span className="text-xs text-muted">
          {t("progress", { applied: backfill.applied_count, matched: backfill.matched_count })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {backfill.status === "running" ? (
          <form action={pauseRuleBackfillFormAction}>
            <input name="ruleId" type="hidden" value={ruleId} />
            <input name="ruleBackfillId" type="hidden" value={backfill.id} />
            <Button size="sm" type="submit" variant="outline">
              {t("pause")}
            </Button>
          </form>
        ) : null}
        {backfill.status === "paused" ? (
          <form action={resumeRuleBackfillFormAction}>
            <input name="ruleId" type="hidden" value={ruleId} />
            <input name="ruleBackfillId" type="hidden" value={backfill.id} />
            <Button size="sm" type="submit" variant="outline">
              {t("resume")}
            </Button>
          </form>
        ) : null}
        {!TERMINAL_STATUSES.has(backfill.status) ? (
          <form action={cancelRuleBackfillFormAction}>
            <input name="ruleId" type="hidden" value={ruleId} />
            <input name="ruleBackfillId" type="hidden" value={backfill.id} />
            <Button size="sm" type="submit" variant="outline">
              {t("cancel")}
            </Button>
          </form>
        ) : null}
        {backfill.applied_count > 0 ? (
          <form
            action={undoRuleBackfillFormAction}
            onSubmit={(event) => {
              if (!window.confirm(t("confirmUndo"))) event.preventDefault();
            }}
          >
            <input name="ruleId" type="hidden" value={ruleId} />
            <input name="ruleBackfillId" type="hidden" value={backfill.id} />
            <Button size="sm" type="submit" variant="outline">
              {t("undo")}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function RuleBackfillPanel({
  ruleId,
  recentBackfills
}: {
  ruleId: string;
  recentBackfills: Backfill[];
}) {
  const t = useTranslations("rules.backfill");
  const [documentTypeKey, setDocumentTypeKey] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isPending, startTransition] = useTransition();
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function preview() {
    setError(null);
    startTransition(async () => {
      const response = await previewRuleBackfillAction({
        ruleId,
        filter: {
          documentTypeKey: documentTypeKey || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined
        }
      });
      if (response.error) {
        setError(response.error);
        return;
      }
      setMatchedCount((response.data as { matchedCount: number }).matchedCount);
    });
  }

  return (
    <Card className="flex min-h-0 flex-col lg:h-full">
      <form action={startRuleBackfillFormAction} className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="shrink-0 gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <p className="mt-1 text-sm text-muted">{t("description")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {matchedCount !== null ? (
              <span className="text-sm text-muted">
                {t("matchedCount", { count: matchedCount })}
              </span>
            ) : null}
            <Button disabled={isPending} onClick={preview} type="button" variant="outline">
              {isPending ? t("previewing") : t("preview")}
            </Button>
            <Button disabled={matchedCount === null || matchedCount === 0} type="submit">
              {t("start")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid min-h-0 gap-4 lg:overflow-y-auto">
          <input name="ruleId" type="hidden" value={ruleId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1 text-[11px] font-semibold text-muted">
                {t("documentTypeLabel")}
              </span>
              <Input
                aria-label={t("documentTypeLabel")}
                className="pb-1 pt-5"
                name="documentTypeKey"
                onChange={(e) => setDocumentTypeKey(e.target.value)}
                value={documentTypeKey}
              />
            </label>
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1 text-[11px] font-semibold text-muted">
                {t("dateFromLabel")}
              </span>
              <Input
                aria-label={t("dateFromLabel")}
                className="pb-1 pt-5"
                name="dateFrom"
                onChange={(e) => setDateFrom(e.target.value)}
                type="date"
                value={dateFrom}
              />
            </label>
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1 text-[11px] font-semibold text-muted">
                {t("dateToLabel")}
              </span>
              <Input
                aria-label={t("dateToLabel")}
                className="pb-1 pt-5"
                name="dateTo"
                onChange={(e) => setDateTo(e.target.value)}
                type="date"
                value={dateTo}
              />
            </label>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("recentBackfills")}
            </p>
            {recentBackfills.length === 0 ? (
              <p className="text-sm text-muted">{t("noBackfills")}</p>
            ) : (
              recentBackfills.map((backfill) => (
                <BackfillRow backfill={backfill} key={backfill.id} ruleId={ruleId} />
              ))
            )}
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
