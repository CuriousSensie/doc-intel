import { Skeleton } from "@/components/ui/skeleton";

export function HeaderCardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-6 shadow-sm">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton className="mt-3 h-4 w-full max-w-md" key={index} />
      ))}
    </div>
  );
}

export function RowListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="rounded-lg border border-border bg-panel p-4 shadow-sm" key={index}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
