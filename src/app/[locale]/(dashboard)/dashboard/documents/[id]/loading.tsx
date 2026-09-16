import { Skeleton } from "@/components/ui/skeleton";

function PdfViewerSkeleton() {
  return (
    <div className="flex h-[80vh] min-w-0 flex-col gap-2 lg:h-full">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-panel px-3 py-2">
        <div className="flex items-center gap-1">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton className="size-10 rounded-md" key={index} />
          ))}
          <Skeleton className="mx-2 h-4 w-16" />
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="size-10 rounded-md" key={index} />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-panel-strong p-4">
        <div className="mx-auto h-full max-w-[34rem] rounded-md bg-panel shadow-sm">
          <div className="grid gap-3 p-8">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="mt-6 h-64 w-full" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailsCardSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-panel shadow-sm lg:h-full">
      <div className="flex min-h-0 flex-1 flex-col pt-6">
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-6">
          {["w-20", "w-20", "w-28", "w-20", "w-28"].map((width, index) => (
            <div className="px-3 py-2.5" key={index}>
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="grid gap-1.5" key={index}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-3 w-16" />
              <div className="flex flex-wrap gap-1">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-14 rounded-full" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="grid gap-1.5" key={index}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-32" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid gap-4 lg:h-[calc(100vh-8rem)] lg:grid-rows-[auto_minmax(0,1fr)]">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-8 w-72 max-w-[70vw]" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton className="size-10 rounded-md" key={index} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[60%_40%]">
        <div className="min-h-0 min-w-0 lg:h-full">
          <PdfViewerSkeleton />
        </div>
        <DetailsCardSkeleton />
      </div>
    </div>
  );
}
