import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en/folders.json";
import documentsMessages from "@/../messages/en/documents.json";

import type { Document } from "@/modules/documents/documents.service";
import type { Folder } from "@/modules/folders/folders.service";

import { FolderExplorer } from "./folder-explorer";

const listFolderTreeAction = vi.hoisted(() => vi.fn());
const listFolderDocumentsAction = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());

// A tiny stand-in router: "current folder" now lives in the URL (`?folderId=`), not component
// state, so the test harness needs a real (if minimal) searchParams store that push()/replace()
// mutate and that useSearchParams() subscribes to — otherwise drilling into a folder would never
// be observable from the test.
const searchParamsStore = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set: (next: URLSearchParams) => {
      params = next;
      listeners.forEach((l) => l());
    },
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    reset: () => {
      params = new URLSearchParams();
    }
  };
});

function paramsFromUrl(url: string): URLSearchParams {
  const qIndex = url.indexOf("?");
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : "");
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const [, setTick] = useState(0);
    useEffect(() => searchParamsStore.subscribe(() => setTick((t) => t + 1)), []);
    return searchParamsStore.get();
  }
}));

vi.mock("@/i18n/navigation", () => ({
  // Radix's DropdownMenuItem asChild clones this; a host anchor keeps the test free of the real
  // locale-aware Link.
  Link: "a",
  usePathname: () => "/dashboard/folders",
  useRouter: () => ({
    push: (url: string) => {
      push(url);
      searchParamsStore.set(paramsFromUrl(url));
    },
    replace: (url: string) => {
      replace(url);
      searchParamsStore.set(paramsFromUrl(url));
    }
  })
}));

vi.mock("@/modules/documents/documents.actions", () => ({
  updateDocumentAction: vi.fn(),
  deleteDocumentAction: vi.fn()
}));

vi.mock("@/modules/documents/document-shares.actions", () => ({
  getDocumentPermissionsAction: vi.fn()
}));

vi.mock("@/modules/folders/folders.actions", () => ({
  listFolderTreeAction,
  listFolderDocumentsAction,
  createFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  moveFolderAction: vi.fn(),
  moveDocumentsToFolderAction: vi.fn(),
  renameFolderAction: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const invoicesFolder: Folder = {
  id: "folder-invoices",
  parentFolderId: null,
  name: "Invoices",
  path: "/Invoices",
  depth: 0,
  matchConditions: null,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  accessLevel: "full",
  documentCount: 2,
  childFolderCount: 0
};

function fakeDocument(id: string, title: string): Document {
  return { id, title } as unknown as Document;
}

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: documentsMessages, folders: messages }}>
      <FolderExplorer />
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
  replace.mockReset();
  listFolderTreeAction.mockReset();
  listFolderDocumentsAction.mockReset();
  searchParamsStore.reset();
});

function contentPane() {
  return screen.getByTestId("folder-content-pane");
}

function sidebar() {
  return screen.getByRole("navigation", { name: "Folders" });
}

describe("FolderExplorer", () => {
  it("shows root-level folders as tiles, alongside the sidebar tree", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);

    view();

    await waitFor(() => expect(within(contentPane()).getByText("Invoices")).toBeVisible());
    expect(within(contentPane()).getByText("Unfiled")).toBeVisible();
    expect(within(sidebar()).getByText("Invoices")).toBeVisible();
  });

  it("drilling into a folder updates the URL and fetches its documents once, reusing the cache on return", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [fakeDocument("doc-1", "Receipt.pdf"), fakeDocument("doc-2", "Statement.pdf")],
      totalCount: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();

    await waitFor(() => expect(within(contentPane()).getByText("Invoices")).toBeVisible());
    fireEvent.doubleClick(within(contentPane()).getByText("Invoices"));

    await waitFor(() => expect(within(contentPane()).getByText("Receipt.pdf")).toBeVisible());
    expect(push).toHaveBeenCalledWith("/dashboard/folders?folderId=folder-invoices");
    expect(listFolderDocumentsAction).toHaveBeenCalledTimes(1);
    expect(listFolderDocumentsAction).toHaveBeenCalledWith("folder-invoices", { page: 1, pageSize: 25 });

    // Navigate back to root via the breadcrumb, then re-open the same folder — the cached
    // documents must be reused, never re-fetched (ADR-0019's "instant re-open").
    const breadcrumb = screen.getByRole("navigation", { name: "Folder path" });
    fireEvent.click(within(breadcrumb).getByText("All folders"));
    await waitFor(() => expect(within(contentPane()).queryByText("Receipt.pdf")).not.toBeInTheDocument());

    fireEvent.doubleClick(within(contentPane()).getByText("Invoices"));
    await waitFor(() => expect(within(contentPane()).getByText("Receipt.pdf")).toBeVisible());
    expect(listFolderDocumentsAction).toHaveBeenCalledTimes(1);
  });

  it("navigates to a document's detail page on double-click", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [fakeDocument("doc-1", "Receipt.pdf")],
      totalCount: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();

    await waitFor(() => expect(within(contentPane()).getByText("Invoices")).toBeVisible());
    fireEvent.doubleClick(within(contentPane()).getByText("Invoices"));
    await waitFor(() => expect(within(contentPane()).getByText("Receipt.pdf")).toBeVisible());

    fireEvent.doubleClick(within(contentPane()).getByText("Receipt.pdf"));
    expect(push).toHaveBeenCalledWith("/dashboard/documents/doc-1");
  });

  it("selects an item on click, extends selection with shift-click, and clears on Escape", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [fakeDocument("doc-1", "Receipt.pdf"), fakeDocument("doc-2", "Statement.pdf")],
      totalCount: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();
    await waitFor(() => expect(within(contentPane()).getByText("Invoices")).toBeVisible());
    fireEvent.doubleClick(within(contentPane()).getByText("Invoices"));
    await waitFor(() => expect(within(contentPane()).getByText("Receipt.pdf")).toBeVisible());

    fireEvent.click(within(contentPane()).getByText("Receipt.pdf"));
    await waitFor(() => expect(within(contentPane()).getByText("1 selected")).toBeVisible());

    fireEvent.click(within(contentPane()).getByText("Statement.pdf"), { shiftKey: true });
    await waitFor(() => expect(within(contentPane()).getByText("2 selected")).toBeVisible());

    fireEvent.keyDown(within(contentPane()).getByText("Statement.pdf"), { key: "Escape" });
    await waitFor(() => expect(within(contentPane()).queryByText("2 selected")).not.toBeInTheDocument());
  });

  it("sidebar can navigate to a folder independent of the content pane", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();
    await waitFor(() => expect(within(sidebar()).getByText("Invoices")).toBeVisible());
    fireEvent.click(within(sidebar()).getByText("Invoices"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/folders?folderId=folder-invoices"));
  });
});
