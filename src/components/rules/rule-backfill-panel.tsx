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
      <CardHeader className="shrink-0">
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted">{t("description")}</p>
      </CardHeader>
      <CardContent className="grid min-h-0 gap-4 lg:overflow-y-auto">
        <form action={startRuleBackfillFormAction} className="grid gap-3 sm:grid-cols-3">
          <input name="ruleId" type="hidden" value={ruleId} />
          <Input
            aria-label={t("documentTypeLabel")}
            name="documentTypeKey"
            onChange={(e) => setDocumentTypeKey(e.target.value)}
            placeholder={t("documentTypeLabel")}
            value={documentTypeKey}
          />
          <Input
            aria-label={t("dateFromLabel")}
            name="dateFrom"
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder={t("dateFromLabel")}
            type="date"
            value={dateFrom}
          />
          <Input
            aria-label={t("dateToLabel")}
            name="dateTo"
            onChange={(e) => setDateTo(e.target.value)}
            placeholder={t("dateToLabel")}
            type="date"
            value={dateTo}
          />

          <div className="flex items-center gap-3 sm:col-span-3">
            <Button disabled={isPending} onClick={preview} type="button" variant="outline">
              {isPending ? t("previewing") : t("preview")}
            </Button>
            {matchedCount !== null ? (
              <span className="text-sm text-muted">
                {t("matchedCount", { count: matchedCount })}
              </span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-danger sm:col-span-3">{error}</p> : null}

          <Button
            className="sm:col-span-3"
            disabled={matchedCount === null || matchedCount === 0}
            type="submit"
          >
            {t("start")}
          </Button>
        </form>

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
    </Card>
  );
}
