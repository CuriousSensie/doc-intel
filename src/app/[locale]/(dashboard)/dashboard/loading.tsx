import { Skeleton } from "@/components/ui/skeleton";

function TileRowSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton className="h-16 rounded-md" key={index} />
      ))}
    </div>
  );
}

function CardSkeleton({ tiles }: { tiles: number }) {
  return (
    <div className="grid gap-4 rounded-xl border border-border bg-panel p-6 shadow-sm">
      <Skeleton className="h-5 w-32" />
      <TileRowSkeleton count={tiles} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <CardSkeleton tiles={7} />
      <CardSkeleton tiles={3} />
    </div>
  );
}
