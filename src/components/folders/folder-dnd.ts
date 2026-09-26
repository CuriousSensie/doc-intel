import type { Folder } from "@/modules/folders/folders.service";

// The mime type used to tag a folder drag payload — kept distinct from the document drag payload
// so a drop handler can tell which kind it received.
export const FOLDER_DRAG_MIME = "application/x-doc-intel-folder";
export const DOCUMENT_DRAG_MIME = "application/x-doc-intel-document-ids";

// Sentinel node key for the root-level "Unfiled" pseudo-folder — it isn't a real `folders` row
// (no id, no accessLevel, never manageable), so it's addressed by this fixed string everywhere
// the "current folder" or cache is keyed by folder id.
export const UNFILED_KEY = "unfiled";

export type FolderNode = Folder & { children: FolderNode[] };

export function buildTree(folders: Folder[]): FolderNode[] {
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
// move_folder RPC's own check is the authoritative backstop, this is purely for instant feedback
// before the round trip.
export function isDescendant(folders: Folder[], candidateId: string, ancestorId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(candidateId) ?? null;
  while (current?.parentFolderId) {
    if (current.parentFolderId === ancestorId) return true;
    current = byId.get(current.parentFolderId) ?? null;
  }
  return false;
}

// Every folder in the subtree rooted at folderId (not including folderId itself) — used for the
// "delete this folder and everything inside it" recursive delete, which has to walk down to every
// descendant document across every descendant folder, not just this folder's direct children.
export function descendantFolderIds(folders: Folder[], folderId: string): string[] {
  return folders.filter((f) => isDescendant(folders, f.id, folderId)).map((f) => f.id);
}

// Resolves a folder's ancestor id chain by walking parentFolderId on the flat list — the only way
// to get it client-side since path_ids isn't exposed to the client.
export function ancestorIds(folders: Folder[], folderId: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const ids: string[] = [];
  let current = byId.get(folderId) ?? null;
  while (current?.parentFolderId) {
    ids.push(current.parentFolderId);
    current = byId.get(current.parentFolderId) ?? null;
  }
  return ids;
}
