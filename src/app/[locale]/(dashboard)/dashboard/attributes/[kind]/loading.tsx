import { HeaderCardSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="grid min-w-0 gap-5">
      <HeaderCardSkeleton lines={2} />
    </div>
  );
}
