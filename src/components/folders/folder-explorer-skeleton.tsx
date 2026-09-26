import { Skeleton } from "@/components/ui/skeleton";

function SidebarSkeleton() {
  return (
    <div className="flex h-full w-56 shrink-0 flex-col gap-1 rounded-lg border border-border bg-panel p-2 shadow-sm">
      <div className="mb-1 flex items-center justify-between px-1.5">
        <Skeleton className="h-3 w-16" />
        <div className="flex items-center gap-0.5">
          <Skeleton className="size-6 rounded" />
          <Skeleton className="size-6 rounded" />
        </div>
      </div>
      <div className="grid gap-1 px-1.5 py-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton className="h-6 w-full rounded-md" key={index} />
        ))}
      </div>
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Skeleton className="h-9 w-48 rounded-md" />
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-9 w-[4.5rem] rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg p-3">
      <Skeleton className="size-12 rounded-md" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-2.5 w-20" />
    </div>
  );
}

function ContentPaneSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-panel p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, index) => (
          <TileSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

// Mirrors the real two-pane shell (folder-explorer.tsx: sidebar + toolbar + content pane) so
// there's no layout shift across the route's Suspense loading.tsx, the client-side fetch of
// listFolderTreeAction(), and the real content mounting.
export function FolderExplorerSkeleton() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 items-stretch gap-4">
      <SidebarSkeleton />
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_1fr] gap-3">
        <ToolbarSkeleton />
        <ContentPaneSkeleton />
      </div>
    </div>
  );
}
