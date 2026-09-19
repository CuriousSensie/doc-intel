import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <PageHeaderSkeleton action />
      <TableSkeleton columns={4} rows={6} />
    </div>
  );
}
