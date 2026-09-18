import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";

export type StatTile = {
  key: string;
  label: string;
  value: number | null;
  href?: string;
};

// Shared tile shape for every stats section (org-wide, per-member) — `value: null` renders the
// skeleton in the exact grid position it resolves into, so a section streaming in behind
// Suspense never shifts layout once its data arrives.
export function StatsTileRow({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const content = (
          <div className="flex h-full flex-col justify-between gap-2 rounded-md border border-border bg-panel px-3 py-2.5">
            <span className="text-sm text-muted">{tile.label}</span>
            {tile.value === null ? (
              <Skeleton className="h-7 w-12" />
            ) : (
              <span className="text-2xl font-black">{tile.value}</span>
            )}
          </div>
        );

        return tile.href && tile.value !== null ? (
          <Link className="transition-opacity hover:opacity-80" href={tile.href} key={tile.key}>
            {content}
          </Link>
        ) : (
          <div key={tile.key}>{content}</div>
        );
      })}
    </div>
  );
}
