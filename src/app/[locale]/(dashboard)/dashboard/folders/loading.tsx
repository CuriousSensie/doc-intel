import { FolderExplorerSkeleton } from "@/components/folders/folder-explorer-skeleton";

// Mirrors the folders page's own full-height, no-page-scroll wrapper (page.tsx) so there's no
// layout shift once the real page replaces this Suspense fallback.
export default function Loading() {
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-var(--topbar-height))] min-h-0 min-w-0 flex-1 flex-col px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-my-8 lg:px-8 lg:py-8">
      <FolderExplorerSkeleton />
    </div>
  );
}
