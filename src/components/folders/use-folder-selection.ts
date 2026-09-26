import { useCallback, useMemo, useState } from "react";

export type SelectableKind = "folder" | "document";

export type SelectableItem = { id: string; kind: SelectableKind };

// Multi-select for the content pane's current items list — order matters for Shift-range-select,
// so `items` (the currently rendered folders-then-documents order) is passed in at call time
// rather than stored, keeping this hook agnostic of tiles vs details rendering.
export function useFolderSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [kindById, setKindById] = useState<Map<string, SelectableKind>>(new Map());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setKindById(new Map());
    setAnchorId(null);
  }, []);

  const selectOnly = useCallback((item: SelectableItem) => {
    setSelectedIds(new Set([item.id]));
    setKindById(new Map([[item.id, item.kind]]));
    setAnchorId(item.id);
  }, []);

  const toggle = useCallback((item: SelectableItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setKindById((prev) => {
      const next = new Map(prev);
      next.set(item.id, item.kind);
      return next;
    });
    setAnchorId(item.id);
  }, []);

  const selectRange = useCallback(
    (items: SelectableItem[], toId: string) => {
      const fromIndex = anchorId ? items.findIndex((i) => i.id === anchorId) : -1;
      const toIndex = items.findIndex((i) => i.id === toId);
      if (fromIndex === -1 || toIndex === -1) {
        const item = items.find((i) => i.id === toId);
        if (item) selectOnly(item);
        return;
      }
      const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const range = items.slice(start, end + 1);
      setSelectedIds(new Set(range.map((i) => i.id)));
      setKindById(new Map(range.map((i) => [i.id, i.kind])));
    },
    [anchorId, selectOnly]
  );

  const selectAll = useCallback((items: SelectableItem[]) => {
    setSelectedIds(new Set(items.map((i) => i.id)));
    setKindById(new Map(items.map((i) => [i.id, i.kind])));
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const selectedKinds = useMemo(() => {
    const kinds = new Set<SelectableKind>();
    for (const id of selectedIds) {
      const kind = kindById.get(id);
      if (kind) kinds.add(kind);
    }
    return kinds;
  }, [selectedIds, kindById]);

  return {
    selectedIds,
    selectedKinds,
    anchorId,
    isSelected,
    clear,
    selectOnly,
    toggle,
    selectRange,
    selectAll
  };
}

export type FolderSelection = ReturnType<typeof useFolderSelection>;
