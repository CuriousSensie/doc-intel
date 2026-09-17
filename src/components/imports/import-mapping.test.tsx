import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import en from "@/../messages/en/imports.json";
import sl from "@/../messages/sl/imports.json";
import { ImportMappingForm } from "./import-mapping";
import type { EntityType } from "@/modules/entity-types/entity-types.service";

const types: EntityType[] = [
  {
    id: "type",
    organization_id: "org",
    key: "customer",
    name: "Customer",
    name_plural: "Customers",
    field_schema: [
      { key: "vat", label: "VAT", type: "string", identifier_kind: "vat" },
      { key: "amount", label: "Amount", type: "decimal" },
      { key: "date", label: "Date", type: "date" }
    ],
    is_system: false,
    icon: null,
    created_at: "",
    updated_at: ""
  }
];
const columns = [
  { index: 0, header: "name", sample: ["Čebelica"] },
  { index: 1, header: "vat", sample: ["SI17894839"] },
  { index: 2, header: "amount", sample: ["1.234,56"] },
  { index: 3, header: "date", sample: ["03.09.2026"] }
];
afterEach(cleanup);
it("uses Slovenian date/number defaults and submits the same format shown in actual samples", () => {
  const submit = vi.fn();
  render(
    <NextIntlClientProvider locale="sl" messages={{ imports: sl }}>
      <ImportMappingForm
        kind="entities"
        columns={columns}
        entityTypes={types}
        customFields={[]}
        initial={{}}
        busy={false}
        onSubmit={submit}
      />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByLabelText("VAT"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "3" } });
  expect(screen.getByText("1.234,56 → 1234.56")).toBeVisible();
  expect(screen.getByText("03.09.2026 → 2026-09-03")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Preveri vse vrstice" }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      identifierColumns: [{ kind: "vat", column: 1 }],
      fields: expect.arrayContaining([
        expect.objectContaining({ key: "amount", decimalSeparator: "," }),
        expect.objectContaining({ key: "date", dateFormat: "dd.MM.yyyy" })
      ])
    })
  );
});
it("rejects a saved mapping that references a column absent from this file", () => {
  const submit = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ imports: en }}>
      <ImportMappingForm
        kind="entities"
        columns={columns}
        entityTypes={types}
        customFields={[]}
        initial={{
          entityTypeKey: "customer",
          displayNameColumn: 0,
          identifierColumns: [{ kind: "vat", column: 1 }],
          fields: [{ key: "amount", type: "decimal", column: 99 }]
        }}
        busy={false}
        onSubmit={submit}
      />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Validate all rows" }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("columns missing from this file");
});
it("keeps the English and Slovenian UI dictionaries complete", () => {
  const keys = (value: object): string[] =>
    Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === "object" ? keys(item).map((nested) => `${key}.${nested}`) : [key]
      )
      .sort();
  expect(keys(sl)).toEqual(keys(en));
});
it("maps document matching, missing-record behavior and date fields without exposing deferred match strategies", () => {
  const submit = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ imports: en }}>
      <ImportMappingForm
        kind="metadata_only"
        columns={columns}
        entityTypes={types}
        customFields={[]}
        initial={{}}
        busy={false}
        onSubmit={submit}
      />
    </NextIntlClientProvider>
  );
  fireEvent.change(screen.getByLabelText("Match documents using"), {
    target: { value: "paperless_id" }
  });
  expect(screen.queryByRole("option", { name: "Custom field" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
  fireEvent.change(screen.getByLabelText("When no record matches"), {
    target: { value: "create" }
  });
  fireEvent.change(screen.getByLabelText("Document date"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Date format"), { target: { value: "dd.MM.yyyy" } });
  expect(screen.getByText("03.09.2026 → 2026-09-03")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Validate all rows" }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      documentBy: { strategy: "paperless_id", column: 0 },
      entityLinks: [
        expect.objectContaining({
          entityTypeKey: "customer",
          matchBy: "identifier",
          identifierKind: "vat",
          onMissing: "create"
        })
      ],
      fields: [{ target: "document_date", column: 3, dateFormat: "dd.MM.yyyy" }]
    })
  );
  expect(submit.mock.calls[0][0]).not.toHaveProperty("duplicateStrategy");
});
