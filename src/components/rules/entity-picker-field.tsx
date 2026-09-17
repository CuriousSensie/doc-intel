"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type SearchResult = {
  kind: "entity";
  id: string;
  label: string;
  entityTypeKey: string | null;
  entityTypeName: string | null;
};

// A lighter sibling of connections/connection-picker.tsx: that component immediately creates a
// connection on selection (right for the document detail page's inline "connect" affordance).
// A rule action just needs to *name* an entity to reference later, at evaluation time — nothing
// is created here, so this hands the picked entity back to the parent via onSelect instead.
export function EntityPickerField({
  value,
  onSelect
}: {
  value: { id: string; label: string } | null;
  onSelect: (entity: { id: string; label: string } | null) => void;
}) {
  const t = useTranslations("rules.form");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleQueryChange(next: string) {
    setQuery(next);
    setError(null);
    if (next.trim().length < 2) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(next)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message ?? t("searchFailed"));
        setResults(body.data as SearchResult[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("searchFailed"));
      }
    });
  }

  if (value) {
    return (
      <Badge variant="outline">
        {value.label}
        <button
          aria-label={t("removeEntityValue")}
          className="ml-0.5 rounded-full hover:opacity-70"
          onClick={() => onSelect(null)}
          type="button"
        >
          ×
        </button>
      </Badge>
    );
  }

  return (
    <div className="grid gap-2">
      <Input
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder={t("searchPlaceholder")}
        value={query}
      />
      {isPending ? <p className="text-xs text-muted">…</p> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {results.length > 0 ? (
        <ul className="grid max-h-40 gap-0.5 overflow-auto rounded-md border border-border bg-panel p-1">
          {results.map((result) => (
            <li key={result.id}>
              <button
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-strong"
                onClick={() => {
                  onSelect({ id: result.id, label: result.label });
                  setQuery("");
                  setResults([]);
                }}
                type="button"
              >
                <span className="truncate font-semibold">{result.label}</span>
                <span className="shrink-0 text-xs text-muted">{result.entityTypeName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
