import { FormPanelSkeleton } from "@/components/layout/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-panel p-5 shadow-sm">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-3 h-4 w-full max-w-xs" />
          <div className="mt-6 flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="grid flex-1 gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </div>
        <FormPanelSkeleton fields={3} />
      </div>
    </div>
  );
}
