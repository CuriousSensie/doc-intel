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

export function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        </div>
        {action ? <Skeleton className="h-10 w-36" /> : null}
      </div>
    </div>
  );
}

export function FormPanelSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-5 shadow-sm">
      <Skeleton className="h-5 w-44" />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: fields }).map((_, index) => (
          <div className="grid gap-2" key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <Skeleton className="h-11 w-32 self-end" />
      </div>
    </div>
  );
}

export function TableSkeleton({ columns = 4, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-panel">
      <div
        className="grid min-w-[42rem] gap-4 border-b border-border bg-panel-strong/60 px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(8rem, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton className="h-3 w-24" key={index} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          className="grid min-w-[42rem] gap-4 border-b border-border px-4 py-4 last:border-0"
          key={rowIndex}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(8rem, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              className={columnIndex === 0 ? "h-4 w-44 max-w-full" : "h-4 w-24 max-w-full"}
              key={columnIndex}
            />
          ))}
        </div>
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
