import { HeaderCardSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <HeaderCardSkeleton lines={2} />
      <HeaderCardSkeleton lines={2} />
      <HeaderCardSkeleton lines={1} />
    </div>
  );
}
