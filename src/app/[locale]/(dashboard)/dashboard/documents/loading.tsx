import { Skeleton } from "@/components/ui/skeleton";

function ControlSkeleton({ className = "w-40" }: { className?: string }) {
  return <Skeleton className={`h-10 rounded-md ${className}`} />;
}

function DocumentsFilterBarSkeleton() {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-panel p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Skeleton className="h-9 w-48" />

        <div className="flex flex-wrap items-center gap-2">
          <ControlSkeleton className="w-40" />
          <ControlSkeleton className="w-10" />
          <div className="flex items-center overflow-hidden rounded-md border border-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                className="size-10 rounded-none border-r border-border last:border-r-0"
                key={index}
              />
            ))}
          </div>
          <ControlSkeleton className="w-10" />
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-64 flex-1 items-center gap-2 xl:max-w-3xl">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-10 flex-1 rounded-md" />
          <ControlSkeleton className="w-44 shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ControlSkeleton className="w-24" />
          <ControlSkeleton className="w-48" />
          <ControlSkeleton className="w-40" />
          <ControlSkeleton className="w-48" />
          <ControlSkeleton className="w-36" />
          <ControlSkeleton className="w-40" />
        </div>
      </div>
    </section>
  );
}

function BulkBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm">
      <Skeleton className="size-4 rounded-sm" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-40" />
      <span className="ml-auto" />
      <ControlSkeleton className="w-32" />
      <ControlSkeleton className="w-32" />
    </div>
  );
}

function TableSkeleton() {
  const columns = [
    "w-10",
    "min-w-72",
    "min-w-44",
    "min-w-44",
    "min-w-36",
    "w-24",
    "w-20",
    "min-w-44"
  ];

  return (
    <div className="w-full overflow-auto rounded-lg border border-border">
      <table className="w-full caption-bottom text-sm">
        <thead className="bg-panel-strong/60 [&_tr]:border-b [&_tr]:border-border">
          <tr>
            {columns.map((column, index) => (
              <th
                className={`h-11 whitespace-nowrap px-4 text-left align-middle ${column}`}
                key={index}
              >
                {index === 0 ? null : <Skeleton className="h-3 w-24" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }).map((_, rowIndex) => (
            <tr className="border-b border-border last:border-0" key={rowIndex}>
              <td className="px-4 py-3 align-middle">
                <Skeleton className="size-4 rounded-sm" />
              </td>
              <td className="min-w-72 px-4 py-3 align-middle">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="mt-2 h-3 w-36" />
              </td>
              <td className="min-w-44 px-4 py-3 align-middle">
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </td>
              <td className="min-w-44 px-4 py-3 align-middle">
                <Skeleton className="h-4 w-32" />
              </td>
              <td className="min-w-36 px-4 py-3 align-middle">
                <Skeleton className="h-4 w-24" />
              </td>
              <td className="px-4 py-3 align-middle">
                <Skeleton className="h-4 w-8" />
              </td>
              <td className="px-4 py-3 align-middle">
                <Skeleton className="h-4 w-8" />
              </td>
              <td className="min-w-44 px-4 py-3 align-middle">
                <Skeleton className="h-4 w-36" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid gap-5">
      <DocumentsFilterBarSkeleton />
      <div className="grid gap-3">
        <BulkBarSkeleton />
        <TableSkeleton />
      </div>
      <div className="flex items-center justify-between">
        <ControlSkeleton className="w-24" />
        <ControlSkeleton className="w-24" />
      </div>
    </div>
  );
}
