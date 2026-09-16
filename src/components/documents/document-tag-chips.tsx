import type { PaperlessTag } from "@/lib/paperless/documents";

// Real colored+named chips (not just a color stripe) — each document's actual Paperless tags,
// rendered the same way the Details tab's picker shows them. `max` caps how many render before
// collapsing the rest into a "+N" chip, for the denser list/small-card layouts.
export function DocumentTagChips({ tags, max }: { tags: PaperlessTag[]; max?: number }) {
  if (tags.length === 0) return null;

  const visible = max ? tags.slice(0, max) : tags;
  const overflow = max ? tags.length - visible.length : 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold leading-4"
          key={tag.id}
          style={{ backgroundColor: tag.color, color: tag.text_color }}
        >
          {tag.name}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex items-center rounded-full bg-panel-strong px-2 py-0.5 text-xs font-semibold text-muted">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
