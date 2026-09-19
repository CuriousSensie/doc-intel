import {
  FormPanelSkeleton,
  PageHeaderSkeleton,
  TableSkeleton
} from "@/components/layout/loading-skeleton";

export default function Loading() {
  return (
    <div className="grid w-full gap-5">
      <PageHeaderSkeleton />
      <FormPanelSkeleton fields={2} />
      <FormPanelSkeleton fields={2} />
      <TableSkeleton columns={4} rows={3} />
      <TableSkeleton columns={3} rows={5} />
    </div>
  );
}
