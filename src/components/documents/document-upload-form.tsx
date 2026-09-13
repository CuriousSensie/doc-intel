"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { documentsConfig } from "@/config/documents";
import { createClient } from "@/lib/supabase/client";

type UploadIntentResponse = {
  data?: { upload_id: string; url: string; token: string; path: string };
  error?: { message: string };
};

type UploadCompleteResponse = {
  data?: { upload_id: string; status: string };
  error?: { message: string };
};

// specs/01-architecture.md §Upload: intent -> direct-to-storage PUT (bypasses our server) ->
// complete. Client-side because step 2 has to run in the browser against the signed URL — a
// Server Action can't do a direct browser-to-storage upload.
export function DocumentUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const intentRes = await fetch("/api/documents/upload-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, mimeType: file.type })
      });
      const intentBody = (await intentRes.json()) as UploadIntentResponse;
      if (!intentRes.ok || !intentBody.data) {
        throw new Error(intentBody.error?.message ?? "Could not start upload");
      }
      const { upload_id: uploadId, token, path } = intentBody.data;

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(documentsConfig.bucket)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const completeRes = await fetch("/api/documents/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId })
      });
      const completeBody = (await completeRes.json()) as UploadCompleteResponse;
      if (!completeRes.ok) {
        throw new Error(completeBody.error?.message ?? "Upload did not complete");
      }

      toast.success("Upload received — processing.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <input
        accept={documentsConfig.allowedMimeTypes.join(",")}
        className="text-sm"
        disabled={uploading}
        ref={inputRef}
        required
        type="file"
      />
      <Button className="justify-self-start" disabled={uploading} type="submit">
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
