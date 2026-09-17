import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en/documents.json";
import { documentsConfig } from "@/config/documents";

import { DocumentUploadForm } from "./document-upload-form";

const refresh = vi.hoisted(() => vi.fn());
const uploadToSignedUrl = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh })
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl })
    }
  })
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: messages }}>
      <DocumentUploadForm />
    </NextIntlClientProvider>
  );
}

function pdf(name: string) {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockReset();
  uploadToSignedUrl.mockReset();
});

describe("DocumentUploadForm", () => {
  it("queues multiple selected files and uploads each through the existing signed-url flow", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/documents/upload-intent") {
        const body = JSON.parse(String(init?.body)) as { filename: string };
        const suffix = body.filename === "one.pdf" ? "1" : "2";
        return {
          ok: true,
          json: async () => ({
            data: {
              upload_id: `upload-${suffix}`,
              token: `token-${suffix}`,
              path: `org/path-${suffix}.pdf`
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ data: { upload_id: "upload-complete", status: "uploaded" } })
      };
    });
    vi.stubGlobal("fetch", fetch);
    uploadToSignedUrl.mockResolvedValue({ error: null });

    view();
    const input = screen.getByLabelText("Choose documents or drop them here");
    fireEvent.change(input, { target: { files: [pdf("one.pdf"), pdf("two.pdf")] } });

    expect(screen.getByText("one.pdf")).toBeVisible();
    expect(screen.getByText("two.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Upload 2 documents" }));

    await waitFor(() => expect(screen.getAllByText(/Processing/)).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/documents/upload-intent",
      expect.objectContaining({
        body: JSON.stringify({
          filename: "one.pdf",
          size: pdf("one.pdf").size,
          mimeType: "application/pdf"
        })
      })
    );
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "org/path-1.pdf",
      "token-1",
      expect.any(File),
      { contentType: "application/pdf" }
    );
    expect(refresh).toHaveBeenCalled();
  });


  it("queues multiple dropped files", () => {
    view();
    const dropZone = screen.getByText("Choose documents or drop them here").closest("label");
    expect(dropZone).not.toBeNull();

    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [pdf("drop-one.pdf"), pdf("drop-two.pdf")] }
    });

    expect(screen.getByText("drop-one.pdf")).toBeVisible();
    expect(screen.getByText("drop-two.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "Upload 2 documents" })).toBeEnabled();
  });

  it("keeps failed files visible and retryable without reselecting them", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "File type is not allowed" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { upload_id: "upload-1", token: "token-1", path: "org/path-1.pdf" }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { upload_id: "upload-1", status: "uploaded" } })
      });
    vi.stubGlobal("fetch", fetch);
    uploadToSignedUrl.mockResolvedValue({ error: null });

    view();
    fireEvent.change(screen.getByLabelText("Choose documents or drop them here"), {
      target: { files: [pdf("retry.pdf")] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(screen.getByText(/File type is not allowed/)).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(screen.getByText(/Processing/)).toBeVisible());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized files before creating an upload intent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const oversized = new File(["x"], "too-large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", {
      value: documentsConfig.maxSizeBytes + 1
    });

    view();
    fireEvent.change(screen.getByLabelText("Choose documents or drop them here"), {
      target: { files: [oversized] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(screen.getByText(/outside the allowed range/)).toBeVisible());
    expect(fetch).not.toHaveBeenCalled();
  });
});
