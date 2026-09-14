"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createConnectionAction } from "@/modules/connections/connections.actions";

type SearchResult = {
  kind: "entity";
  id: string;
  label: string;
  entityTypeKey: string | null;
  entityTypeName: string | null;
};

// specs/05-level-1-structure.md: "adding a connection is a single searchable picker... If it
// takes more than two interactions, the product fails at its core promise." Two interactions:
// type to search, click a result. Works from a document or an entity page — only entities are
// searchable today (see /api/search's own note), so this always creates a *-to-entity
// connection regardless of which side it's opened from.
export function ConnectionPicker({
  sourceKind,
  sourceId
}: {
  sourceKind: "document" | "entity";
  sourceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleQueryChange(value: string) {
    setQuery(value);
    setError(null);

    if (value.trim().length < 2) {
      setResults([]);
      return;
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Search failed");
      setResults(body.data as SearchResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  function handleConnect(result: SearchResult) {
    startTransition(async () => {
      try {
        await createConnectionAction({
          sourceKind,
          sourceId,
          targetKind: "entity",
          targetId: result.id,
          relation: "related"
        });
        setOpen(false);
        setQuery("");
        setResults([]);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create connection");
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        + Connect
      </Button>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-panel p-3">
      <Input
        autoFocus
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search customers, projects, contracts..."
        value={query}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {results.length > 0 ? (
        <ul className="grid gap-1">
          {results.map((result) => (
            <li key={result.id}>
              <button
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-strong disabled:opacity-50"
                disabled={isPending}
                onClick={() => handleConnect(result)}
                type="button"
              >
                <span className="truncate font-semibold">{result.label}</span>
                <span className="shrink-0 text-xs text-muted">{result.entityTypeName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        onClick={() => {
          setOpen(false);
          setQuery("");
          setResults([]);
          setError(null);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
    </div>
  );
}
