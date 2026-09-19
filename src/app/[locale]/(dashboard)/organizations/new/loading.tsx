import { FormPanelSkeleton } from "@/components/layout/loading-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      </div>
      <FormPanelSkeleton fields={2} />
    </div>
  );
}
