"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomFieldDataType } from "@/modules/attributes/attributes.schemas";

const customFieldDataTypes: CustomFieldDataType[] = [
  "string",
  "integer",
  "float",
  "monetary",
  "date",
  "boolean",
  "select",
  "url"
];

const controlClass =
  "min-h-10 w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50";

export function CustomFieldFormControls({
  editing,
  initialDataType,
  initialOptions,
  labels,
  dataTypeLabels
}: {
  editing: boolean;
  initialDataType: CustomFieldDataType;
  initialOptions: string[];
  labels: {
    dataType: string;
    dataTypeImmutableHint: string;
    options: string;
    optionsHint: string;
    optionPlaceholder: string;
    addOption: string;
    removeOption: string;
  };
  dataTypeLabels: Record<CustomFieldDataType, string>;
}) {
  const [dataType, setDataType] = useState<CustomFieldDataType>(initialDataType);
  const [options, setOptions] = useState<string[]>(
    initialOptions.length > 0 ? initialOptions : dataType === "select" ? [""] : []
  );

  function updateDataType(next: CustomFieldDataType) {
    setDataType(next);
    if (next === "select" && options.length === 0) setOptions([""]);
  }

  return (
    <>
      <label className="grid gap-1.5 text-sm font-medium">
        <span>{labels.dataType}</span>
        {editing ? (
          <>
            <select className={controlClass} defaultValue={initialDataType} disabled>
              {customFieldDataTypes.map((dt) => (
                <option key={dt} value={dt}>
                  {dataTypeLabels[dt]}
                </option>
              ))}
            </select>
            <input name="dataType" type="hidden" value={initialDataType} />
            <span className="text-xs text-muted">{labels.dataTypeImmutableHint}</span>
          </>
        ) : (
          <select
            className={controlClass}
            name="dataType"
            onChange={(event) => updateDataType(event.target.value as CustomFieldDataType)}
            value={dataType}
          >
            {customFieldDataTypes.map((dt) => (
              <option key={dt} value={dt}>
                {dataTypeLabels[dt]}
              </option>
            ))}
          </select>
        )}
      </label>

      {dataType === "select" ? (
        <div className="grid gap-2 text-sm font-medium">
          <span>{labels.options}</span>
          <div className="grid gap-2">
            {options.map((option, index) => (
              <div className="flex items-center gap-2" key={index}>
                <Input
                  autoComplete="off"
                  name="options"
                  onChange={(event) =>
                    setOptions((prev) => prev.map((value, i) => (i === index ? event.target.value : value)))
                  }
                  placeholder={labels.optionPlaceholder}
                  value={option}
                />
                <Button
                  aria-label={labels.removeOption}
                  disabled={options.length === 1}
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-normal text-muted">{labels.optionsHint}</span>
            <Button
              onClick={() => setOptions((prev) => [...prev, ""])}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden className="size-4" />
              {labels.addOption}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
