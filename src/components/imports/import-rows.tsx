"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { listImportRowsAction } from "@/modules/imports/imports.actions";
import type { ImportRow } from "@/modules/imports/imports.service";
import { SelectField } from "./import-controls";
import type messages from "@/../messages/en/imports.json";
import { unwrap } from "./import-utils";

export function ImportRows({ id, review = false }: { id: string; review?: boolean }) {
  const t = useTranslations("imports");
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [page, setPage] = useState<{ items: ImportRow[]; nextCursor: string | null }>({
    items: [],
    nextCursor: null
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    unwrap(
      listImportRowsAction(id, {
        status: filter ? (filter as ImportRow["status"]) : undefined,
        cursor,
        limit: 25
      })
    )
      .then((result) => {
        if (active) {
          setPage(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, filter, cursor, retry]);
  function navigate(next: string | null) {
    setLoading(true);
    setError(false);
    setCursor(next);
  }
  return (
    <section className="grid min-w-0 gap-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">{t(review ? "reviewRows" : "rowResults")}</h2>
        <SelectField
          label={t("filterRows")}
          value={filter}
          onChange={(e) => {
            setLoading(true);
            setError(false);
            setFilter(e.target.value);
            setCursor(null);
            setHistory([]);
          }}
        >
          <option value="">{t("allRows")}</option>
          {(review
            ? (["failed", "needs_review"] as const)
            : (["ok", "skipped_duplicate", "failed", "needs_review", "pending"] as const)
          ).map((value) => (
            <option key={value} value={value}>
              {t(`rowStatus.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {error ? (
        <div role="alert">
          <p className="text-sm text-danger">{t("rowsError")}</p>
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setError(false);
              setRetry(retry + 1);
            }}
          >
            {t("tryAgain")}
          </Button>
        </div>
      ) : (
        <div
          className="min-w-0 overflow-x-auto rounded-md border border-border"
          aria-busy={loading}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("rowResults")}</caption>
            <thead className="bg-panel-strong">
              <tr>
                {(["rowNumber", "result", "sourceValues"] as const).map((key) => (
                  <th scope="col" key={key} className="px-4 py-3 font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={3} className="h-28 p-4 text-muted" role="status">
                    {t("loadingRows")}
                  </td>
                </tr>
              ) : page.items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-muted">
                    {t("noRows")}
                  </td>
                </tr>
              ) : (
                page.items.map((row) => {
                  const plan = row.result as { action?: keyof typeof messages.plan } | null;
                  const result =
                    review && row.status === "pending"
                      ? t(`plan.${plan?.action ?? "pending"}`)
                      : t(`rowStatus.${row.status}`);
                  return (
                    <tr key={row.id}>
                      <td className="w-16 px-4 py-3 align-top tabular-nums">{row.row_number}</td>
                      <td className="min-w-48 max-w-sm px-4 py-3 align-top">
                        <p className={row.error_code ? "text-danger" : ""}>{result}</p>
                        {row.error_code && (
                          <p className="mt-1 text-xs text-danger">
                            {t(`errors.${row.error_code as keyof typeof messages.errors}`)}
                          </p>
                        )}
                        {row.error_message && (
                          <p className="mt-1 text-xs text-muted">{row.error_message}</p>
                        )}
                      </td>
                      <td className="max-w-lg px-4 py-3 align-top">
                        <p
                          className="line-clamp-2 break-words"
                          title={Array.isArray(row.raw) ? row.raw.join(" · ") : ""}
                        >
                          {Array.isArray(row.raw) ? row.raw.join(" · ") : JSON.stringify(row.raw)}
                        </p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={loading || !history.length}
          onClick={() => {
            const previous = history.at(-1) ?? null;
            setHistory(history.slice(0, -1));
            navigate(previous);
          }}
        >
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          disabled={loading || !page.nextCursor}
          onClick={() => {
            setHistory([...history, cursor]);
            navigate(page.nextCursor);
          }}
        >
          {t("next")}
        </Button>
      </div>
    </section>
  );
}
