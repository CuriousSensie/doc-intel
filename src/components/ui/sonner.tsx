"use client";

import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)"
        } as CSSProperties
      }
      theme={resolvedTheme as ToasterProps["theme"]}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
