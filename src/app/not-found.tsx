import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">404</p>
        <h1 className="mt-4 text-4xl font-black">Page not found</h1>
        <p className="mt-4 leading-7 text-muted">
          The requested page does not exist in this boilerplate.
        </p>
        <Button asChild className="mt-8">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </main>
  );
}
