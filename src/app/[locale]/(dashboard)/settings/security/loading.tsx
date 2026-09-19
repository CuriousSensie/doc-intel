import { FormPanelSkeleton, HeaderCardSkeleton } from "@/components/layout/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <FormPanelSkeleton fields={2} />
        <div className="grid gap-5">
          <HeaderCardSkeleton lines={2} />
          <HeaderCardSkeleton lines={1} />
        </div>
      </div>
    </div>
  );
}
