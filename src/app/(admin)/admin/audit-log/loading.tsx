import { HeaderCardSkeleton, RowListSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="grid gap-5">
      <HeaderCardSkeleton lines={1} />
      <RowListSkeleton rows={3} />
    </div>
  );
}
