# Security

## Core Rules

1. Never trust client-provided user IDs.
2. Derive identity from the authenticated Supabase session.
3. Never expose service-role credentials.
4. Never expose Stripe secrets.
5. Never rely only on frontend authorization.
6. Verify webhook signatures.
7. Use RLS for user-facing tables.
8. Validate external input.
9. Rate-limit abuse-prone endpoints.
10. Prevent duplicate payment and credit processing.
11. Do not log secrets.
12. Protect cross-tenant data.
13. Use secure redirects.
14. Prefer least privilege.
15. Treat external responses as untrusted.
16. Make destructive actions explicit.
17. Handle concurrency in financial and credit operations.

## Service Role

The Supabase service-role key may only be used from server-only modules. Browser clients and Client
Components must use the publishable key with RLS-scoped access.
