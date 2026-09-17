import { Link } from "@/i18n/navigation";

import { appConfig } from "@/config/app";

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center px-6 py-10">
      <section className="w-full rounded-lg border border-border bg-panel p-6 shadow-sm">
        <Link className="text-sm font-semibold" href="/">
          {appConfig.name}
        </Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-muted">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-black">{title}</h1>
        <p className="mt-3 leading-7 text-muted">{description}</p>
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-6 border-t border-border pt-5 text-sm text-muted">{footer}</div> : null}
      </section>
    </main>
  );
}
