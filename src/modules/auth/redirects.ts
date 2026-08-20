import { appConfig } from "@/config/app";

export function getSafeRedirectPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || value.length === 0) {
    return "/dashboard";
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\n")) {
    return "/dashboard";
  }

  return value;
}

export function withStatus(path: string, key: "error" | "message", value: string) {
  const url = new URL(path, appConfig.url);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}
