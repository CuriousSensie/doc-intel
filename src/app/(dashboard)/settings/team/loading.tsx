import { HeaderCardSkeleton, RowListSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <HeaderCardSkeleton lines={1} />
      <RowListSkeleton rows={3} />
    </div>
  );
}
