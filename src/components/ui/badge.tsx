import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        accent: "border-transparent bg-accent text-accent-foreground",
        outline: "border-border bg-transparent text-foreground",
        muted: "border-transparent bg-panel-strong text-muted",
        danger: "border-transparent bg-danger/12 text-danger"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
