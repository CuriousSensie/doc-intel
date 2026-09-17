"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { testRuleAction } from "@/modules/rules/rules.actions";
import type { ConditionTrace } from "@/modules/rules/rules.evaluator";

// specs/07-rules-engine.md §Dry run and backfill: "build it with the first version, not later"
// — the condition-trace UI a non-technical user needs to understand *why* a rule did or didn't
// match, per leaf condition.
function TraceNode({ trace }: { trace: ConditionTrace }) {
  if (trace.kind === "leaf") {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
          trace.matched ? "border-emerald-200 bg-emerald-50" : "border-border bg-panel"
        }`}
      >
        <span className="font-mono">
          {trace.field} {trace.op} {JSON.stringify(trace.expected)}
        </span>
        <span className="font-semibold">
          {trace.matched ? "✓" : "✗"} {JSON.stringify(trace.actual)}
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border p-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
        {trace.kind} — {trace.matched ? "✓" : "✗"}
      </span>
      <div className="grid gap-2 pl-3">
        {trace.children.map((child, index) => (
          <TraceNode key={index} trace={child} />
        ))}
      </div>
    </div>
  );
}

export function RuleTestPanel({ ruleId }: { ruleId: string }) {
  const t = useTranslations("rules.test");
  const [documentId, setDocumentId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    matched: boolean;
    conditionsTrace: ConditionTrace;
    actions: unknown[];
  } | null>(null);

  function runTest() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const response = await testRuleAction({ ruleId, documentId });
      if (response.error) {
        setError(response.error);
        return;
      }
      setResult(response.data as never);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted">{t("description")}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex gap-2">
          <Input
            aria-label={t("documentIdLabel")}
            onChange={(e) => setDocumentId(e.target.value)}
            placeholder={t("documentIdHint")}
            value={documentId}
          />
          <Button disabled={isPending || !documentId} onClick={runTest} type="button">
            {isPending ? t("running") : t("run")}
          </Button>
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {result ? (
          <div className="grid gap-3">
            <p className="text-sm font-semibold">{result.matched ? t("matched") : t("notMatched")}</p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("trace")}</p>
              <TraceNode trace={result.conditionsTrace} />
            </div>
            {result.matched ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("actions")}</p>
                <pre className="overflow-x-auto rounded-md border border-border bg-panel p-3 text-xs">
                  {JSON.stringify(result.actions, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
