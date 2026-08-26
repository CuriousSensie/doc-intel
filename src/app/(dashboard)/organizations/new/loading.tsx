import { HeaderCardSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-md">
      <HeaderCardSkeleton lines={3} />
    </div>
  );
}
