import { Skeleton } from "@/components/ui/skeleton";

// Mirrors DocumentDetailShell's actual structure (header row, 60/40 split, tabbed card) so the
// loading state doesn't jump/reflow once the real content lands.
export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-1 lg:h-[calc(100vh-8rem)]">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton className="size-10 rounded-md" key={i} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[60%_40%]">
        <div className="flex h-[80vh] min-w-0 flex-col gap-2 lg:h-full">
          <Skeleton className="h-12 w-full shrink-0 rounded-lg" />
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-4 rounded-xl border border-border bg-panel p-6 shadow-sm lg:h-full">
          <div className="flex flex-wrap gap-4 border-b border-border pb-2">
            {["w-16", "w-16", "w-24", "w-16", "w-24"].map((w, i) => (
              <Skeleton className={`h-5 ${w}`} key={i} />
            ))}
          </div>
          <div className="grid gap-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="grid gap-1.5" key={i}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
