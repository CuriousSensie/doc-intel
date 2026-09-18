// Easy Access ("recently accessed documents" / "most-used views") — deliberately localStorage
// only, per-browser, no Supabase table or write path (temp.md decision: avoid adding load for a
// feature with no server-side consumer). Capped, deduped-by-id, most-recent first.

const STORAGE_KEY = "pomocnik:recentActivity:v1";
const MAX_ITEMS = 10;

export type RecentItem = { id: string; label: string; href: string; openedAt: number };

type RecentActivityStore = {
  documents: RecentItem[];
  views: RecentItem[];
};

function emptyStore(): RecentActivityStore {
  return { documents: [], views: [] };
}

function readStore(): RecentActivityStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<RecentActivityStore>;
    return {
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      views: Array.isArray(parsed.views) ? parsed.views : []
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: RecentActivityStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private browsing / storage disabled / quota exceeded — Easy Access just stays empty.
  }
}

function recordItem(list: RecentItem[], item: Omit<RecentItem, "openedAt">): RecentItem[] {
  const next = list.filter((existing) => existing.id !== item.id);
  next.unshift({ ...item, openedAt: Date.now() });
  return next.slice(0, MAX_ITEMS);
}

export function recordDocumentOpen(item: { id: string; title: string }): void {
  const store = readStore();
  store.documents = recordItem(store.documents, {
    id: item.id,
    label: item.title,
    href: `/dashboard/documents/${item.id}`
  });
  writeStore(store);
}

export function recordViewOpen(item: { id: string; name: string; href: string }): void {
  const store = readStore();
  store.views = recordItem(store.views, { id: item.id, label: item.name, href: item.href });
  writeStore(store);
}

export function getRecentDocuments(): RecentItem[] {
  return readStore().documents;
}

export function getRecentViews(): RecentItem[] {
  return readStore().views;
}
