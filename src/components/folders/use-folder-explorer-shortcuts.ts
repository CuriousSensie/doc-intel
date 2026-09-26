import { useCallback, useState } from "react";

import type { SelectableItem } from "@/components/folders/use-folder-selection";

export type FolderExplorerShortcutHandlers = {
  onOpen: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
};

// Keyboard shortcuts scoped to the content pane's own container element (attach the returned
// `onKeyDown` to that element, not window/document) so they never fire while a Dialog input has
// focus — Radix Dialog traps focus inside its portal, so once focus moves into a rename/delete
// dialog these handlers simply stop seeing the events.
export function useFolderExplorerShortcuts({
  items,
  selectedIds,
  isSelected,
  selectOnly,
  selectRange,
  selectAll,
  clearSelection,
  handlers
}: {
  items: SelectableItem[];
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  selectOnly: (item: SelectableItem) => void;
  selectRange: (items: SelectableItem[], toId: string) => void;
  selectAll: (items: SelectableItem[]) => void;
  clearSelection: () => void;
  handlers: FolderExplorerShortcutHandlers;
}) {
  const [focusedIdState, setFocusedId] = useState<string | null>(null);
  // Derived, not effect-reset: a focused item that scrolled out of the current folder (navigation,
  // a delete, a refetch) simply stops being "focused" on the next render, no extra render needed.
  const focusedId = focusedIdState && items.some((i) => i.id === focusedIdState) ? focusedIdState : null;

  const moveFocus = useCallback(
    (direction: 1 | -1, extend: boolean) => {
      if (items.length === 0) return;
      const currentIndex = focusedId ? items.findIndex((i) => i.id === focusedId) : -1;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), items.length - 1);
      const next = items[nextIndex];
      setFocusedId(next.id);
      if (extend) selectRange(items, next.id);
      else selectOnly(next);
    },
    [items, focusedId, selectOnly, selectRange]
  );

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (isTypingTarget(event.target)) return;
    const meta = event.metaKey || event.ctrlKey;

    if (event.key === "Enter") {
      if (focusedId) {
        event.preventDefault();
        handlers.onOpen(focusedId);
      }
      return;
    }
    if (event.key === "F2") {
      if (selectedIds.size === 1 && handlers.onRename) {
        event.preventDefault();
        handlers.onRename([...selectedIds][0]);
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedIds.size > 0 && !isTypingTarget(event.target)) {
        event.preventDefault();
        handlers.onDelete([...selectedIds]);
      }
      return;
    }
    if (meta && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAll(items);
      return;
    }
    if (meta && event.key.toLowerCase() === "x" && handlers.onCut && selectedIds.size > 0) {
      event.preventDefault();
      handlers.onCut([...selectedIds]);
      return;
    }
    if (meta && event.key.toLowerCase() === "v" && handlers.onPaste) {
      event.preventDefault();
      handlers.onPaste();
      return;
    }
    if (event.key === "Escape") {
      clearSelection();
      setFocusedId(null);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(-1, event.shiftKey);
    }
  }

  return { focusedId, setFocusedId, onKeyDown, isSelected };
}
