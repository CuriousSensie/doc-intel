import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
    </div>
  );
}
