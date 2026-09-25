"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPaperlessMetaAction } from "@/modules/documents/documents.actions";

type MetaOption = { id: number; name: string; color?: string; text_color?: string };
type Kind = "tag" | "documentType";

// A reasonable fixed palette rather than a full color wheel — quick to scan, matches the
// pastel character of Paperless's own seeded tag colors (#a6cee3 etc. — ColorBrewer-ish).
const TAG_COLOR_PALETTE = [
  "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c",
  "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"
];

// Shared by the Details tab's tags (multi-select)/document-type (single-select)
// fields — inline search, create, and assign in one control, matching paperless-ngx's own
// document-edit UX. Selecting/removing an *existing* option is a pure local state change (via
// `onChange`, synchronous) — nothing is sent to the server until the page-level Save button
// commits the whole draft. Only "create a brand-new one" needs a real network call, since the
// object has to exist in Paperless before it can be referenced by id.
export function PaperlessMetaPicker({
  kind,
  mode,
  options,
  value,
  onChange,
  disabled
}: {
  kind: Kind;
  mode: "single" | "multi";
  options: MetaOption[];
  value: number[];
  onChange: (ids: number[], newOption?: MetaOption) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("documents.detail.picker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLOR_PALETTE[0]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Real bug found via live testing: creating two brand-new tags back to back (multi-select
  // "assign multiple tags" rule action) silently dropped the first one. createAndSelect() is
  // async (a real network call to create the Paperless object) and closed over `value` at click
  // time — starting a second create before the first one's onChange had round-tripped back into
  // this component's `value` prop meant both calls computed `[...value, newId]` from the same
  // stale (pre-first-create) array, so whichever resolved last overwrote the other's addition
  // instead of both landing. This ref always holds the latest ids synchronously, independent of
  // whether the parent's state update has re-rendered this component yet, so a create started
  // while an earlier one is still in flight chains onto it instead of racing it.
  const latestIdsRef = useRef(value);
  useEffect(() => {
    latestIdsRef.current = value;
  }, [value]);

  const selected = options.filter((o) => value.includes(o.id));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.filter((o) => !value.includes(o.id));
    return options.filter((o) => !value.includes(o.id) && o.name.toLowerCase().includes(q));
  }, [options, query, value]);

  const exactMatch = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  function select(id: number) {
    const next = mode === "multi" ? [...latestIdsRef.current, id] : [id];
    latestIdsRef.current = next;
    onChange(next);
    setQuery("");
    setOpen(mode === "multi");
  }

  function remove(id: number) {
    const next = latestIdsRef.current.filter((v) => v !== id);
    latestIdsRef.current = next;
    onChange(next);
  }

  function createAndSelect() {
    const name = query.trim();
    if (!name) return;
    setQuery("");
    startTransition(async () => {
      try {
        const created = await createPaperlessMetaAction({
          kind,
          name,
          color: kind === "tag" ? newColor : undefined
        });
        const next = mode === "multi" ? [...latestIdsRef.current, created.id] : [created.id];
        latestIdsRef.current = next;
        onChange(next, created);
        setOpen(mode === "multi");
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("createFailed"));
      }
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((o) => (
          <Badge
            key={o.id}
            style={
              o.color ? { backgroundColor: o.color, color: o.text_color ?? "#000", borderColor: o.color } : undefined
            }
            variant={o.color ? undefined : "outline"}
          >
            {o.name}
            {!disabled ? (
              <button
                aria-label={t("remove", { name: o.name })}
                className="ml-0.5 rounded-full hover:opacity-70"
                onClick={() => remove(o.id)}
                type="button"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </Badge>
        ))}
        {selected.length === 0 && !open ? <span className="text-sm text-muted">—</span> : null}
        {!disabled && (mode === "multi" || selected.length === 0) ? (
          <button
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-semibold text-muted hover:bg-panel-strong"
            onClick={() => {
              setOpen((v) => !v);
              setError(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            type="button"
          >
            <Plus className="size-3" />
            {t("add")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {open ? (
        <div className="grid gap-2 rounded-md border border-border bg-panel p-2">
          <Input
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            ref={inputRef}
            value={query}
          />
          <ul className="grid max-h-40 gap-0.5 overflow-auto">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-panel-strong disabled:opacity-50"
                  onClick={() => select(o.id)}
                  type="button"
                >
                  {o.color ? (
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
                  ) : null}
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
          {query.trim() && !exactMatch ? (
            <div className="grid gap-2 border-t border-border pt-2">
              {kind === "tag" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {TAG_COLOR_PALETTE.map((c) => (
                    <button
                      aria-label={c}
                      aria-pressed={newColor === c}
                      className="size-5 rounded-full ring-offset-1 data-[active=true]:ring-2 data-[active=true]:ring-foreground"
                      data-active={newColor === c}
                      key={c}
                      onClick={() => setNewColor(c)}
                      style={{ backgroundColor: c }}
                      type="button"
                    />
                  ))}
                </div>
              ) : null}
              <button
                className="w-full rounded-md px-2 py-1 text-left text-sm font-semibold text-accent hover:bg-panel-strong disabled:opacity-50"
                disabled={isPending}
                onClick={createAndSelect}
                type="button"
              >
                {isPending ? t("creating") : t("createNew", { name: query.trim() })}
              </button>
            </div>
          ) : null}
          <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
            {t("done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
