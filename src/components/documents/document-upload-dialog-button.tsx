"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { FolderUploadForm } from "@/components/documents/folder-upload-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { documentsConfig } from "@/config/documents";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The documents list — the natural place a user looks to upload — had no upload entry point at
// all; DocumentUploadForm only existed on the dashboard home widget. Reuses that same form
// rather than a second implementation, matching PaperlessMetaPicker's "create new" dialog
// pattern already used elsewhere in this app.
//
// ADR-0019 Phase D — `foldersEnabled` adds a "Upload folder" tab alongside the original flat
// upload; without it (feature flag off, or a caller that doesn't pass it) this renders exactly
// as before folders existed.
export function DocumentUploadDialogButton({ foldersEnabled = false }: { foldersEnabled?: boolean }) {
  const t = useTranslations("documents.upload");
  const [open, setOpen] = useState(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-3" aria-hidden />
          {t("upload")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dropTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">{t("maxSize", { size: formatSize(documentsConfig.maxSizeBytes) })}</p>
        {foldersEnabled ? (
          <Tabs defaultValue="files">
            <TabsList>
              <TabsTrigger value="files">{t("filesTab")}</TabsTrigger>
              <TabsTrigger value="folder">{t("folderTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="files">
              <DocumentUploadForm />
            </TabsContent>
            <TabsContent value="folder">
              <FolderUploadForm />
            </TabsContent>
          </Tabs>
        ) : (
          <DocumentUploadForm />
        )}
      </DialogContent>
    </Dialog>
  );
}
