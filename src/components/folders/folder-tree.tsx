"use client";

import {
  ChevronDown,
  ChevronRight,
  File,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  createFolderAction,
  deleteFolderAction,
  moveFolderAction,
  moveDocumentsToFolderAction,
  renameFolderAction
} from "@/modules/folders/folders.actions";
import type { DeleteFolderMode } from "@/modules/folders/folders.schemas";
import type { Folder } from "@/modules/folders/folders.service";
import type { Document } from "@/modules/documents/documents.service";

// The mime type used to tag a folder drag payload — kept distinct from the document drag payload
// (see document-list-view.tsx) so a drop handler can tell which kind it received.
const FOLDER_DRAG_MIME = "application/x-doc-intel-folder";
export const DOCUMENT_DRAG_MIME = "application/x-doc-intel-document-ids";

// Sentinel node key for the root-level "Unfiled" pseudo-folder — it isn't a real `folders` row
// (no id, no accessLevel, never manageable), so it's addressed by this fixed string everywhere
// expand/cache state is keyed by folder id.
export const UNFILED_KEY = "unfiled";

export type DocCacheEntry = {
  items: Document[];
  page: number;
  totalPages: number;
  totalCount: number;
  loading: boolean;
  error: string | null;
};

type FolderNode = Folder & { children: FolderNode[] };

function buildTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parentFolderId && byId.has(node.parentFolderId)) {
      byId.get(node.parentFolderId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Cheap client-side cycle check using the already-fetched flat list's parent chain — the
// move_folder RPC's own check (supabase/migrations/20260930000000_folders.sql) is the
// authoritative backstop, this is purely for instant feedback before the round trip.
function isDescendant(folders: Folder[], candidateId: string, ancestorId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(candidateId) ?? null;
  while (current?.parentFolderId) {
    if (current.parentFolderId === ancestorId) return true;
    current = byId.get(current.parentFolderId) ?? null;
  }
  return false;
}

function DeleteFolderDialog({
  folder,
  hasChildren,
  open,
  onOpenChange,
  onDeleted
}: {
  folder: Folder;
  hasChildren: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("folders");
  const [mode, setMode] = useState<DeleteFolderMode>("require_empty");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteFolderAction({ folderId: folder.id, mode });
        toast.success(t("deleted", { name: folder.name }));
        onOpenChange(false);
        onDeleted();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: folder.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p className="text-muted">{t("deleteDescription")}</p>
          <label className="flex items-start gap-2">
            <input
              checked={mode === "require_empty"}
              className="mt-1"
              name="mode"
              onChange={() => setMode("require_empty")}
              type="radio"
            />
            <span>{t("deleteMode.requireEmpty")}</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              checked={mode === "reassign_documents_to_null"}
              className="mt-1"
              name="mode"
              onChange={() => setMode("reassign_documents_to_null")}
              type="radio"
            />
            <span>{t("deleteMode.reassignToNull")}</span>
          </label>
          {hasChildren ? (
            <label className="flex items-start gap-2">
              <input
                checked={mode === "cascade_delete_subfolders"}
                className="mt-1"
                name="mode"
                onChange={() => setMode("cascade_delete_subfolders")}
                type="radio"
              />
              <span>{t("deleteMode.cascade")}</span>
            </label>
          ) : null}
          {error ? <p className="text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={submit} type="button" variant="default">
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameFolderDialog({
  folder,
  open,
  onOpenChange,
  onRenamed
}: {
  folder: Folder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const t = useTranslations("folders");
  const [name, setName] = useState(folder.name);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await renameFolderAction({ folderId: folder.id, name });
        onOpenChange(false);
        onRenamed();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("renameFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("renameTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          value={name}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending || !name.trim()} onClick={submit} type="button">
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSubfolderDialog({
  parentFolderId,
  open,
  onOpenChange,
  onCreated
}: {
  parentFolderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations("folders");
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createFolderAction({ parentFolderId, name });
        setName("");
        onOpenChange(false);
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("createFailed"));
      }
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newFolderTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t("namePlaceholder")}
          value={name}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={isPending || !name.trim()} onClick={submit} type="button">
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A document leaf row — click navigates to the detail page (same route document-list-view.tsx
// uses), draggable with the exact payload shape folder nodes' drop handlers already expect.
function DocumentLeafRow({ document, depth }: { document: Document; depth: number }) {
  const router = useRouter();

  return (
    <li
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted hover:bg-panel-strong/60"
      draggable
      onClick={() => router.push(`/dashboard/documents/${document.id}`)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DOCUMENT_DRAG_MIME, JSON.stringify([document.id]));
        e.dataTransfer.effectAllowed = "move";
      }}
      role="button"
      style={{ paddingLeft: `${depth * 14 + 24}px` }}
      tabIndex={0}
    >
      <File className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{document.title}</span>
    </li>
  );
}

function DocumentLeaves({
  folderKey,
  depth,
  docCache,
  onLoadMore
}: {
  folderKey: string;
  depth: number;
  docCache: Record<string, DocCacheEntry>;
  onLoadMore: (folderKey: string) => void;
}) {
  const t = useTranslations("folders");
  const entry = docCache[folderKey];

  if (!entry) {
    return (
      <li className="px-1.5 py-1 text-xs text-muted" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
        {t("loadingDocuments")}
      </li>
    );
  }
  if (entry.error) {
    return (
      <li className="px-1.5 py-1 text-xs text-danger" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
        {entry.error}
      </li>
    );
  }
  if (entry.items.length === 0 && !entry.loading) {
    return (
      <li className="px-1.5 py-1 text-xs text-muted" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
        {t("noDocuments")}
      </li>
    );
  }

  return (
    <>
      {entry.items.map((document) => (
        <DocumentLeafRow depth={depth} document={document} key={document.id} />
      ))}
      {entry.page < entry.totalPages ? (
        <li style={{ paddingLeft: `${depth * 14 + 24}px` }}>
          <button
            className="px-1.5 py-1 text-xs text-muted underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            disabled={entry.loading}
            onClick={(e) => {
              e.stopPropagation();
              onLoadMore(folderKey);
            }}
            type="button"
          >
            {entry.loading ? t("loadingDocuments") : t("loadMore")}
          </button>
        </li>
      ) : null}
    </>
  );
}

function FolderTreeNode({
  node,
  depth,
  allFolders,
  expandedKeys,
  docCache,
  onToggle,
  onLoadMore,
  onChanged,
  onManage,
  dragOverId,
  setDragOverId
}: {
  node: FolderNode;
  depth: number;
  allFolders: Folder[];
  expandedKeys: Set<string>;
  docCache: Record<string, DocCacheEntry>;
  onToggle: (folderId: string) => void;
  onLoadMore: (folderKey: string) => void;
  onChanged: () => void;
  onManage: (folderId: string, tab: "access" | "match") => void;
  dragOverId: string | null;
  setDragOverId: (id: string | null) => void;
}) {
  const t = useTranslations("folders");
  const [renameOpen, setRenameOpen] = useState(false);
  const [newSubOpen, setNewSubOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isAncestorOnly = node.accessLevel === "ancestor";
  const hasChildFolders = node.children.length > 0;
  const canExpand = hasChildFolders || (node.documentCount ?? 0) > 0;
  const expanded = expandedKeys.has(node.id);
  const isOver = dragOverId === node.id;

  function handleDragStart(e: React.DragEvent) {
    if (isAncestorOnly) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(FOLDER_DRAG_MIME, node.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(FOLDER_DRAG_MIME) || e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
      e.preventDefault();
      if (!isAncestorOnly) setDragOverId(node.id);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverId(null);
    if (isAncestorOnly) {
      toast.error(t("cannotManageAncestor"));
      return;
    }
    const draggedFolderId = e.dataTransfer.getData(FOLDER_DRAG_MIME);
    const draggedDocumentIds = e.dataTransfer.getData(DOCUMENT_DRAG_MIME);

    if (draggedFolderId) {
      if (draggedFolderId === node.id) return;
      if (isDescendant(allFolders, node.id, draggedFolderId)) {
        toast.error(t("cannotMoveIntoDescendant"));
        return;
      }
      startTransition(async () => {
        try {
          await moveFolderAction({ folderId: draggedFolderId, newParentFolderId: node.id });
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("moveFailed"));
        }
      });
      return;
    }

    if (draggedDocumentIds) {
      const documentIds = JSON.parse(draggedDocumentIds) as string[];
      if (documentIds.length === 0) return;
      startTransition(async () => {
        try {
          const result = await moveDocumentsToFolderAction({ documentIds, folderId: node.id });
          toast.success(t("documentsMoved", { count: result.movedCount }));
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("moveFailed"));
        }
      });
    }
  }

  const countsLabel = t("counts", {
    folders: node.childFolderCount ?? 0,
    documents: node.documentCount ?? 0
  });

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm ${
          isAncestorOnly ? "text-muted opacity-60" : "hover:bg-panel-strong/60"
        } ${isOver ? "ring-2 ring-foreground/40" : ""} ${isPending ? "opacity-60" : ""}`}
        draggable={!isAncestorOnly}
        onDragLeave={() => setDragOverId(dragOverId === node.id ? null : dragOverId)}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          aria-label={expanded ? t("collapse") : t("expand")}
          className="flex size-5 shrink-0 items-center justify-center text-muted"
          disabled={!canExpand}
          onClick={() => onToggle(node.id)}
          type="button"
        >
          {canExpand ? (
            expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )
          ) : null}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
          onClick={() => onToggle(node.id)}
          type="button"
        >
          <span className="truncate font-medium">{node.name}</span>
          <span className="shrink-0 text-xs text-muted">{countsLabel}</span>
        </button>
        {!isAncestorOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("folderActions")}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-panel"
                type="button"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setNewSubOpen(true)}>
                <FolderPlus className="size-4" /> {t("newSubfolder")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="size-4" /> {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onManage(node.id, "access")}>
                <Lock className="size-4" /> {t("manageAccess")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onManage(node.id, "match")}>
                <Sparkles className="size-4" /> {t("manageMatch")}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-danger" onSelect={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {expanded ? (
        <ul>
          {node.children.map((child) => (
            <FolderTreeNode
              allFolders={allFolders}
              depth={depth + 1}
              docCache={docCache}
              dragOverId={dragOverId}
              expandedKeys={expandedKeys}
              key={child.id}
              node={child}
              onChanged={onChanged}
              onLoadMore={onLoadMore}
              onManage={onManage}
              onToggle={onToggle}
              setDragOverId={setDragOverId}
            />
          ))}
          {(node.documentCount ?? 0) > 0 ? (
            <DocumentLeaves depth={depth} docCache={docCache} folderKey={node.id} onLoadMore={onLoadMore} />
          ) : null}
        </ul>
      ) : null}

      {!isAncestorOnly ? (
        <>
          <RenameFolderDialog folder={node} onOpenChange={setRenameOpen} onRenamed={onChanged} open={renameOpen} />
          <NewSubfolderDialog
            onCreated={onChanged}
            onOpenChange={setNewSubOpen}
            open={newSubOpen}
            parentFolderId={node.id}
          />
          <DeleteFolderDialog
            folder={node}
            hasChildren={hasChildFolders}
            onDeleted={onChanged}
            onOpenChange={setDeleteOpen}
            open={deleteOpen}
          />
        </>
      ) : null}
    </li>
  );
}

// The explorer's single-pane tree: folders AND documents in one expandable structure (ADR-0019
// redesign — replaces the old always-on rail-next-to-flat-list layout). `docCache`/`onToggle`/
// `onLoadMore` are owned by the caller (folder-explorer.tsx) so expand/collapse never re-fetches
// a folder's documents once loaded once.
export function FolderTree({
  folders,
  expandedKeys,
  docCache,
  onToggle,
  onLoadMore,
  onChanged,
  onManage
}: {
  folders: Folder[];
  expandedKeys: Set<string>;
  docCache: Record<string, DocCacheEntry>;
  onToggle: (folderId: string) => void;
  onLoadMore: (folderKey: string) => void;
  onChanged: () => void;
  onManage: (folderId: string, tab: "access" | "match") => void;
}) {
  const t = useTranslations("folders");
  const [newRootOpen, setNewRootOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverUnfiled, setDragOverUnfiled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const tree = useMemo(() => buildTree(folders), [folders]);
  const unfiledExpanded = expandedKeys.has(UNFILED_KEY);

  function handleUnfiledDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverUnfiled(false);
    const draggedDocumentIds = e.dataTransfer.getData(DOCUMENT_DRAG_MIME);
    if (!draggedDocumentIds) return;
    const documentIds = JSON.parse(draggedDocumentIds) as string[];
    if (documentIds.length === 0) return;
    startTransition(async () => {
      try {
        const result = await moveDocumentsToFolderAction({ documentIds, folderId: null });
        toast.success(t("documentsMoved", { count: result.movedCount }));
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("moveFailed"));
      }
    });
  }

  return (
    <nav aria-label={t("title")} className="grid gap-1">
      <div className="mb-1 flex items-center justify-between px-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("title")}</h2>
        <button
          aria-label={t("newFolderTitle")}
          className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-strong"
          onClick={() => setNewRootOpen(true)}
          type="button"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>

      <ul>
        {tree.map((node) => (
          <FolderTreeNode
            allFolders={folders}
            depth={0}
            docCache={docCache}
            dragOverId={dragOverId}
            expandedKeys={expandedKeys}
            key={node.id}
            node={node}
            onChanged={onChanged}
            onLoadMore={onLoadMore}
            onManage={onManage}
            onToggle={onToggle}
            setDragOverId={setDragOverId}
          />
        ))}

        <li>
          <div
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-panel-strong/60 ${
              dragOverUnfiled ? "ring-2 ring-foreground/40" : ""
            } ${isPending ? "opacity-60" : ""}`}
            onDragLeave={() => setDragOverUnfiled(false)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
                e.preventDefault();
                setDragOverUnfiled(true);
              }
            }}
            onDrop={handleUnfiledDrop}
          >
            <button
              aria-label={unfiledExpanded ? t("collapse") : t("expand")}
              className="flex size-5 shrink-0 items-center justify-center text-muted"
              onClick={() => onToggle(UNFILED_KEY)}
              type="button"
            >
              {unfiledExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            <button
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onToggle(UNFILED_KEY)}
              type="button"
            >
              {t("unfiled")}
            </button>
          </div>
          {unfiledExpanded ? (
            <ul>
              <DocumentLeaves depth={0} docCache={docCache} folderKey={UNFILED_KEY} onLoadMore={onLoadMore} />
            </ul>
          ) : null}
        </li>
      </ul>

      <NewSubfolderDialog onCreated={onChanged} onOpenChange={setNewRootOpen} open={newRootOpen} parentFolderId={null} />
    </nav>
  );
}
