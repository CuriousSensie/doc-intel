import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function RegisterPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center px-6">
      <section className="w-full rounded-lg border border-border bg-panel p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Auth module</p>
        <h1 className="mt-4 text-3xl font-black">Register</h1>
        <p className="mt-3 leading-7 text-muted">
          The foundation branch reserves this route. Registration, email confirmation, onboarding,
          and MFA flows are implemented in the auth branch.
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link href="/">Home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Login</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
