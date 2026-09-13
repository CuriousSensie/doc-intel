import { HeaderCardSkeleton, RowListSkeleton } from "@/components/layout/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-[70vh] w-full rounded-lg" />
      </div>
      <div className="grid gap-4">
        <HeaderCardSkeleton lines={4} />
        <RowListSkeleton rows={2} />
      </div>
    </div>
  );
}
