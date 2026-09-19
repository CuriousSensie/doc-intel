import { HeaderCardSkeleton, PageHeaderSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <PageHeaderSkeleton action />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <HeaderCardSkeleton lines={4} />
        <HeaderCardSkeleton lines={5} />
      </div>
    </div>
  );
}
