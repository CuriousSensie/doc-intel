import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { filesConfig } from "@/config/files";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { deleteFileAction, uploadFileAction } from "@/modules/files/files.actions";
import { listFiles } from "@/modules/files/files.service";

export const dynamic = "force-dynamic";

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function FilesPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; error?: string; message?: string }>;
}) {
  requireFeature("files");
  await requireUser("/dashboard/files");
  const params = await searchParams;
  const { items, nextCursor } = await listFiles({ cursor: params.cursor });

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl gap-5 px-6 py-10">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Dashboard</p>
        <h1 className="mt-3 text-3xl font-black">Files</h1>
        <p className="mt-1 text-sm text-muted">
          Up to {formatSize(filesConfig.categories.document.maxSizeBytes)} per file.
        </p>
        <form action={uploadFileAction} className="mt-6 grid gap-4" encType="multipart/form-data">
          <FormMessage error={params.error} message={params.message} />
          <input
            accept={filesConfig.categories.document.allowedMimeTypes.join(",")}
            className="text-sm"
            name="file"
            required
            type="file"
          />
          <Button className="justify-self-start" type="submit">
            Upload
          </Button>
        </form>
      </section>

      <section className="grid gap-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">
            You have no files yet.
          </p>
        ) : (
          items.map((file) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm sm:flex-row sm:items-center"
              key={file.id}
            >
              <div>
                <p className="font-semibold">{file.filename}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatSize(file.size)} &middot; {new Date(file.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/api/files/${file.id}/download`}>Download</Link>
                </Button>
                <form action={deleteFileAction}>
                  <input name="fileId" type="hidden" value={file.id} />
                  <Button size="sm" type="submit" variant="outline">
                    Delete
                  </Button>
                </form>
              </div>
            </div>
          ))
        )}
      </section>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={`/dashboard/files?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>
          </Button>
        </div>
      ) : null}
    </main>
  );
}
