import { HeaderCardSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <HeaderCardSkeleton lines={4} />
    </div>
  );
}
