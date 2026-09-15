# API Reference

Every exported function and type in `src/modules/**`, `src/lib/**`, and `src/config/**`, grouped
by file. This is the "what's the exact signature" lookup — for *why* something is shaped this way
or *how* to extend it, see [MODULES.md](MODULES.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

Conventions used throughout the codebase, so they aren't repeated per entry below:

- Every `*.actions.ts` export is a `"use server"` Server Action: it takes `FormData` (or nothing),
  never returns a value a caller uses, and always ends in a `redirect()` — hence `Promise<never>`.
- Every `*.service.ts` function is a plain async function — no `FormData`, no `redirect()`, safe
  to call from a script or another module.
- A cursor-paginated `list*` function always takes `{ cursor?: string | null; limit?: number }`
  (plus a function-specific filter like `search`) and returns `{ items: T[]; nextCursor: string |
  null }}`, built on `src/lib/pagination.ts`.

## `src/modules/auth/`

### `session.ts`
- `type Profile = Database["public"]["Tables"]["profiles"]["Row"]`
- `type AuthContext = { user: User; profile: Profile | null }`
- `getCurrentUser(): Promise<User | null>` — `null` if Supabase env vars are missing or there's no session.
- `getCurrentProfile(userId: string): Promise<Profile | null>`
- `getAuthContext(): Promise<AuthContext | null>`
- `requireUser(next?: string): Promise<AuthContext>` — redirects guests to `/login`; redirects suspended users to `/login?error=...`.
- `requireGuest(): Promise<void>` — redirects an already-authenticated user to `/dashboard`.
- `requireAdmin(): Promise<AuthContext>` — `requireUser()` + throws `AuthorizationError` unless `profile.is_app_admin`.
- `requireMfaAssurance(next = "/dashboard"): Promise<AuthenticatorAssuranceLevels>` — redirects to `/mfa/challenge` if AAL2 is required but not met.

### `auth.actions.ts`
- `registerAction(formData: FormData)`
- `loginAction(formData: FormData)`
- `logoutAction()`
- `forgotPasswordAction(formData: FormData)`
- `resetPasswordAction(formData: FormData)`
- `resendVerificationAction(formData: FormData)`
- `oauthAction(formData: FormData)` — `provider` is `"google" | "github"`.
- `updateProfileAction(formData: FormData)`
- `completeOnboardingAction(formData: FormData)`
- `changePasswordAction(formData: FormData)`
- `startMfaEnrollmentAction()` — redirects to `/mfa/enroll` with `factorId`/`qr`/`secret` query params.
- `verifyMfaEnrollmentAction(formData: FormData)`
- `verifyMfaChallengeAction(formData: FormData)`
- `disableMfaAction(formData: FormData)`

### `authorization.ts`
- `requireFeature(feature: FeatureKey): void` — throws `AuthorizationError` if the flag is off.
- `hasFeature(plan: PlanKey, feature: keyof PlanFeatureMap): boolean`
- `getLimit(plan: PlanKey, limit: keyof PlanFeatureMap): number`
- `requireSubscription(owner: BillingOwner, allowedPlans: PlanKey[]): Promise<PlanKey>` — throws `AuthorizationError` if the owner's plan isn't in the list.
- `can(role: "owner" | "admin" | "member", permission: string): boolean` — permission strings: `"organization.billing.manage"`, `"organization.members.invite"`, `"organization.settings.manage"`, `"organization.read"`, `"organization.*"` (owner wildcard).

### `redirects.ts`
- `getSafeRedirectPath(value: FormDataEntryValue | string | null | undefined): string` — defaults to `/dashboard`; blocks protocol-relative/backslash/newline paths.
- `withStatus(path: string, key: "error" | "message" | "invite", value: string): string`

### `auth.schemas.ts`
- `passwordSchema` — min 8 chars, requires upper/lower/digit.
- `registerSchema` — `{ name, email, password, confirmPassword, terms: "on", next? }`.
- `loginSchema` — `{ email, password, next? }`.
- `emailSchema` — `{ email }`.
- `resetPasswordSchema` — `{ password, confirmPassword }`.
- `profileSchema` — `{ name, timezone = "UTC", locale = "en" }`.
- `mfaCodeSchema` — `{ code: /^[0-9]{6}$/, factorId?: uuid, challengeId?: uuid }`.
- `formDataToObject(formData: FormData): Record<string, FormDataEntryValue>`
- `firstZodError(error: z.ZodError): string`

## `src/modules/organizations/`

### `organizations.service.ts`
- `type Organization`, `type OrganizationMember`, `type OrganizationInvitation` — Row types from `Database`.
- `type OrganizationRole = "owner" | "admin" | "member"`, `type AssignableRole = "admin" | "member"`.
- `type MemberWithProfile = OrganizationMember & { profile: {id,name,email,avatar_url} | null }`
- `listUserOrganizations(userId: string): Promise<{ role: OrganizationRole; organization: Organization }[]>`
- `getOrganization(organizationId: string): Promise<Organization | null>`
- `getMembership(organizationId: string, userId: string): Promise<OrganizationMember | null>`
- `createOrganization(name: string, requestedSlug?: string): Promise<string>` — returns the new org id; auto-generates a unique slug (5 retries) if none given; throws `ConflictError` if the requested slug is taken.
- `updateOrganization(organizationId: string, values: OrganizationUpdate): Promise<Organization>`
- `deleteOrganization(organizationId: string): Promise<void>` — self-service, RLS-gated (owner only).
- `listMembers(organizationId: string): Promise<MemberWithProfile[]>`
- `updateMemberRole(memberId: string, role: AssignableRole): Promise<OrganizationMember>`
- `removeMember(memberId: string): Promise<void>`
- `leaveOrganization(organizationId: string, userId: string): Promise<void>` — throws `ConflictError` if the caller is the sole owner.
- `listInvitations(organizationId: string): Promise<OrganizationInvitation[]>` — pending only.
- `createInvitation(organizationId: string, invitedBy: string, email: string, role: AssignableRole): Promise<{ invitation: OrganizationInvitation; token: string }>` — throws `ConflictError` if already a member; upserts on `(organization_id, email)`.
- `revokeInvitation(invitationId: string): Promise<void>`
- `getInvitationPreview(token: string): Promise<InvitationPreviewRow | null>` — RPC `get_organization_invitation`.
- `acceptInvitation(token: string): Promise<string>` — RPC `accept_organization_invitation`, returns the org id.
- `transferOwnership(organizationId: string, newOwnerId: string): Promise<void>` — RPC `transfer_organization_ownership`.

### `organizations.actions.ts`
- `createOrganizationAction(formData: FormData)`
- `updateOrganizationAction(formData: FormData)`
- `inviteMemberAction(formData: FormData)`
- `resendInvitationAction(formData: FormData)`
- `revokeInvitationAction(formData: FormData)`
- `updateMemberRoleAction(formData: FormData)`
- `removeMemberAction(formData: FormData)`
- `leaveOrganizationAction(formData: FormData)`
- `transferOwnershipAction(formData: FormData)`
- `deleteOrganizationAction(formData: FormData)`
- `switchOrganizationAction(formData: FormData)`
- `acceptInvitationAction(formData: FormData)` — also fires `notifyOrganizationAdminsOfNewMember` and `logEvent("organization.invitation.accepted")`.

### `active-organization.ts`
- `getActiveOrganizationId(userId: string): Promise<string | null>` — reads the `active_org` cookie, validates membership, falls back to the user's first membership.
- `setActiveOrganization(organizationId: string): Promise<void>` — httpOnly cookie, 1-year `maxAge`.
- `clearActiveOrganization(): Promise<void>`

### `organizations.schemas.ts`
- `createOrganizationSchema` — `{ name, slug?: lowercase [a-z0-9-], max 60 }`.
- `updateOrganizationSchema` — `{ name, logoUrl? }`.
- `inviteMemberSchema` — `{ email, role: "admin"|"member" }`.
- `updateMemberRoleSchema` — `{ memberId: uuid, role: "admin"|"member" }`.
- `transferOwnershipSchema` — `{ newOwnerId: uuid }`.
- `removeMemberSchema` — `{ memberId: uuid }`.

## `src/modules/email/` and `src/lib/email/`

### `src/modules/email/email.service.ts`
- `type EmailTemplateMap = { "organization-invitation": { organizationName, inviterName, role, acceptUrl } }`
- `sendEmail<T extends keyof EmailTemplateMap>(args: { to: string; template: T; variables: EmailTemplateMap[T] }): Promise<{ id: string } | null>` — never throws; logs and returns `null` on failure.

### `src/lib/email/index.ts`
- `applyDevRecipientOverride(message: RenderedEmail): RenderedEmail` — reroutes to `EMAIL_DEV_RECIPIENT` if set.
- `getEmailProvider(): EmailProvider` — memoized singleton, selected via `env.EMAIL_PROVIDER`.
- `sendRenderedEmail(message: RenderedEmail): Promise<EmailSendResult>`

### `src/lib/email/types.ts`
- `type RenderedEmail = { to, from, subject, html, text }`
- `type EmailSendResult = { id: string }`
- `interface EmailProvider { send(message: RenderedEmail): Promise<EmailSendResult> }`

### `src/lib/email/console-provider.ts` / `smtp-provider.ts`
- `class ConsoleEmailProvider implements EmailProvider` — logs, returns a synthetic id.
- `class SmtpEmailProvider implements EmailProvider` — nodemailer; requires `SMTP_HOST/PORT/USER/PASSWORD`.

**To add a provider**: implement `EmailProvider`, add a case to `getEmailProvider()`'s switch, add
the enum value to `env.ts`. See [MODULES.md#email](MODULES.md#email).

## `src/modules/billing/`

### `billing.service.ts`
- `ownerIdColumn(owner: BillingOwner): "user_id" | "organization_id"`
- `getStripeCustomerId(owner: BillingOwner, email: string): Promise<string>` — looks up or creates.
- `getOwnerPlan(owner: BillingOwner): Promise<PlanKey>` — `"free"` unless an active/trialing, non-platform-disabled subscription exists.
- `resolvePlanKeyFromPriceId(priceId: string): PlanKey | null`
- `createCheckoutSession(args: { owner, email, priceId, mode: "subscription"|"payment", successPath, cancelPath, metadata? }): Promise<string>` — returns the Checkout URL.
- `hasStripeCustomer(owner: BillingOwner): Promise<boolean>`
- `createPortalSession(args: { owner, returnPath }): Promise<string | null>`

### `credits.service.ts`
- `getCreditBalance(owner: BillingOwner): Promise<number>` — sums the ledger.
- `grantCredits(owner, amount: number, type, options?: { reference?, metadata?, createdBy? }): Promise<void>` — throws if `amount <= 0`.
- `consumeCredits(owner, amount: number, reference: string, metadata?): Promise<number>` — RPC `consume_credits`, returns the new balance.
- `refundCredits(owner, amount: number, reference: string, metadata?): Promise<void>` — `grantCredits` with type `"refund"`.
- `adminAdjustCredits(owner, amount: number, adminUserId: string, reference?, metadata?): Promise<void>` — grants (positive) or consumes (negative); throws if `amount === 0`.

### `usage.service.ts`
- `currentUsagePeriod(interval?: "daily"|"monthly"|"lifetime" = "monthly"): string`
- `getUsage(owner, feature, period): Promise<number>`
- `checkUsageLimit(owner, feature, period): Promise<{ used, limit, remaining, exceeded }>`
- `incrementUsage(owner, feature, period, amount = 1): Promise<number>` — RPC `increment_usage_counter`; throws if the limit would be exceeded.

### `owner.ts`
- `type BillingOwner = { type: "user"; id: string } | { type: "organization"; id: string }`
- `resolveBillingOwner(context: AuthContext): Promise<BillingOwner | null>`
- `requireBillingOwner(context: AuthContext): Promise<BillingOwner>` — redirects to `/organizations/new` if none.

### `billing.actions.ts`
- `createCheckoutAction(formData: FormData)`
- `createPortalAction()`
- `purchaseCreditsAction(formData: FormData)`

### `billing.schemas.ts`
- `checkoutSchema` — `{ planKey (validated against billingConfig.plans), interval: "monthly"|"yearly" }`.
- `creditPurchaseSchema` — `{ packKey (validated against billingConfig.creditPacks) }`.

## `src/modules/notifications/`

### `notifications.service.ts`
- `type Notification`
- `createNotification(userId, input: { type, title, message, metadata? }): Promise<void>` — no-op if `features.notifications` is off.
- `listNotifications(userId, options?): Promise<{ items, nextCursor }>` — cursor-paginated, default limit 20.
- `getUnreadCount(userId): Promise<number>`
- `markAsRead(notificationId, userId): Promise<void>`
- `markAllAsRead(userId): Promise<void>`

### `notifications.actions.ts`
- `markAsReadAction(formData: FormData)`
- `markAllAsReadAction()`

## `src/modules/profile/avatar.service.ts` and `src/lib/files/validate.ts`

The boilerplate's generic Files module (`src/modules/files/`) was removed entirely — see
[MODULES.md](MODULES.md). Avatar upload, the one part of it still needed, moved here.

### `avatar.service.ts`
- `uploadAvatar(actor, input: { buffer, declaredMimeType, size }): Promise<string>` — validates against `avatarConfig`, uploads to `avatars`, updates `profiles.avatar_url`, deletes the previous avatar object, logs `avatar.uploaded`, returns the public URL.

### `avatar.actions.ts`
- `uploadAvatarAction(formData: FormData)`

### `src/lib/files/validate.ts`
- `sniffMimeType(buffer: Buffer): string | null` — magic-byte detection: PNG/JPEG/GIF/WEBP/PDF/TIFF/zip.
- `validateFileAgainstConfig(input: { buffer, declaredMimeType, size }, config: { maxSizeBytes, allowedMimeTypes }): string` — returns the resolved MIME type; throws `ValidationError` on a size/type mismatch or disallowed type. Used by both `avatarConfig` (avatar upload) and `documentsConfig` (the Documents upload pipeline).

## `src/modules/admin/`

### `users.service.ts`
- `listUsers(options?: { cursor?, limit?, search? }): Promise<{ items: Profile[], nextCursor }>` — `search` does an `ilike` on email.
- `suspendUser(actorId, userId): Promise<void>` — throws `AuthorizationError` if `actorId === userId`.
- `unsuspendUser(actorId, userId): Promise<void>`
- `setAppAdmin(actorId, userId, isAdmin: boolean): Promise<void>` — throws `AuthorizationError` if self-revoking.
- `deleteUserAdmin(actorId, userId): Promise<void>` — throws `AuthorizationError` if self; deletes any solely-owned organization first (via `deleteOrganizationAdmin`), then calls the Supabase Admin Auth API.

### `organizations.service.ts`
- `type OrganizationRecord`
- `listOrganizationsAdmin(options?: { cursor?, limit?, search? }): Promise<{ items, nextCursor }>` — admin client (bypasses the members-only RLS visibility a regular query would have).
- `suspendOrganization(actorId, organizationId): Promise<void>`
- `unsuspendOrganization(actorId, organizationId): Promise<void>`
- `deleteOrganizationAdmin(actorId, organizationId, metadata?: Json): Promise<void>` — logs the event **before** deleting (the `audit_logs.organization_id` FK requires the row to still exist at insert time).
- `reprovisionOrganizationAdmin(actorId, organizationId): Promise<void>` — Pomočnik. Throws `ConflictError` unless `provisioning_status` is `pending`/`provisioning_failed`; enqueues `provisionTenant` (reusing its idempotent find-or-create) and logs `admin.organization.reprovision_requested`.

### `billing.service.ts`
- `setSubscriptionPlatformStatus(actorId, owner: BillingOwner, disabled: boolean): Promise<void>` — toggles `subscriptions.platform_disabled_at`; throws `NotFoundError` if the owner has no subscription. Never calls Stripe.

### `audit-log.service.ts`
- `type AuditLogEntry`
- `listAuditLogs(options?: { cursor?, limit? }): Promise<{ items, nextCursor }>` — read-only; default limit 20.

### `admin.actions.ts`
All `requireFeature("admin")` + `requireAdmin()` gated:
- `suspendUserAction(formData: FormData)`
- `unsuspendUserAction(formData: FormData)`
- `setAppAdminAction(formData: FormData)`
- `deleteUserAdminAction(formData: FormData)`
- `suspendOrganizationAction(formData: FormData)`
- `unsuspendOrganizationAction(formData: FormData)`
- `deleteOrganizationAdminAction(formData: FormData)`
- `reprovisionOrganizationAction(formData: FormData)` — Pomočnik. `specs/01-architecture.md`'s `POST /admin/orgs/:id/reprovision`, implemented as a Server Action per [ADR-0009](adr/0009-route-handlers-vs-server-actions.md).
- `adjustCreditsAction(formData: FormData)` — wraps `adminAdjustCredits`.
- `toggleSubscriptionPlatformStatusAction(formData: FormData)`

## `src/modules/users/profiles.service.ts`

- `type ProfileUpdate`
- `updateProfile(userId: string, values: ProfileUpdate): Promise<Profile>`

## `src/lib/events/`

### `index.ts`
- `logEvent(event: AppEvent): Promise<void>` — fans out to `sinks: EventSink[]` (currently `[consoleSink, auditLogSink]`); never throws — a sink's failure is caught and logged.

### `types.ts`
- `type AppEvent = { actorId: string | null; actorType?: "user"|"system"|"rule"|"import"|"ai"; action: string; entityType?; entityId?; organizationId?: string | null; metadata?: Json; ipAddress?: string | null; userAgent?: string | null }` — `actorType` defaults to `"user"` in the sink (ADR-0005, Pomočnik).
- `type EventSink = { name: string; handle(event: AppEvent): Promise<void> }`

### `sinks/console-sink.ts` / `sinks/audit-log-sink.ts`
- `consoleSink: EventSink` — logs via `logger.info`.
- `auditLogSink: EventSink` — inserts into `audit_logs` via the admin client.

**To add a sink**: implement `EventSink`, push it into the `sinks` array in `index.ts`. See
[MODULES.md#audit-logs](MODULES.md#audit-logs).

## `src/lib/paperless/`

Pomočnik. `paperlessFor(orgId)` is the only way to get a tenant-scoped client; `paperlessAdminClient()` is provisioning-only (ESLint-restricted to `src/modules/tenants/**` and `worker/jobs/provision-tenant.ts`).

### `client.ts`
- `class PaperlessClient` — `get<T>(path)`, `post<T>(path, body)`, `patch<T>(path, body)`, `delete(path)`, `postForm<T>(path, form)` (120s timeout), `createOwnedObject<T>(path, body, { ownerId, groupId })` (permissions required, validated against the client's own tenant — isolation test #20), `getStream(path): Promise<Response>` — raw fetch Response for binary content (document preview/download), no retry, so a Route Handler can pipe `.body` straight through without JSON-decoding mangling it.
- `paperlessFor(orgId: string): Promise<PaperlessClient>` — resolves `tenant_paperless_config` via the admin Supabase client; 60s in-memory cache per org.
- `paperlessAdminClient(): Promise<PaperlessClient>` — logs in with `PAPERLESS_ADMIN_USER`/`PASSWORD` against `PAPERLESS_ADMIN_URL`; 1h token cache.
- `resolveTenantForPaperlessDocument(paperlessDocumentId: number): Promise<string | null>` — `paperless_object_map` lookup for the event-bridge webhook.

### `errors.ts`
- `mapPaperlessError(res: Response, context): Promise<AppError>` — 403 **and** 404 both map to our `NotFoundError` (confirmed necessary live — `docs/spike-findings.md` §1 #8).
- `isRetryablePaperlessError(res, err): boolean`

### `token-crypto.ts`
- `encryptPaperlessToken(plaintext: string): Buffer` / `decryptPaperlessToken(encrypted: Buffer): string` — AES-256-GCM, key from `PAPERLESS_TOKEN_ENCRYPTION_KEY`.

### `types.ts`
- `type PaperlessTask`, `type PaperlessDocument` (includes `custom_fields: {field, value}[]`, confirmed live), `type PaperlessDocumentHistoryEntry`, `type PaperlessSetPermissions`, `type PaperlessListEnvelope<T>`
- `const TENANT_MODEL_PERMISSIONS: string[]` — Django group permission codenames a tenant group needs (bare `codename`, confirmed live — `docs/spike-findings.md` §1).

### `documents.ts` — Pomočnik
- `getPaperlessDocument(client, paperlessDocumentId): Promise<PaperlessDocument>`
- `updatePaperlessDocument(client, paperlessDocumentId, patch: {title?, created?, document_type?, custom_fields?}): Promise<PaperlessDocument>` — specs/03-api.md `PATCH /documents/:id`'s write-through; returns Paperless's own post-write shape so the caller mirrors what was actually stored.
- `getPaperlessDocumentHistory(client, paperlessDocumentId): Promise<PaperlessDocumentHistoryEntry[]>` — confirmed live: a plain array, not paginated on this version.
- `getPaperlessDocumentTypeName(client, documentTypeId): Promise<string>`, `getPaperlessCorrespondentName(client, correspondentId): Promise<string>`, `listAllPaperlessDocumentIds(client, queryString?): Promise<Set<number>>`, `toDocumentTypeKey(name): string`

## `src/modules/tenants/`

### `provision-tenant.ts`
- `provisionTenant(orgId: string): Promise<void>` — `specs/01-architecture.md` §Provisioning. Claims via `claim_provisioning()`, idempotent find-or-create for the Paperless group/service user/document types/storage path, then `complete_provisioning()`; calls `fail_provisioning()` on any error and rethrows.
- `findOrCreateGroup/findOrCreateServiceUser/findOrCreateDocumentType/findOrCreateStoragePath` — exported for `provision-tenant.test.ts`; not meant for use outside this module.

## `src/modules/documents/`

### `documents.service.ts`
- `type DocumentUpload = Database["public"]["Tables"]["document_uploads"]["Row"]`, `type Document`, `type DocumentDetails = Document & {connections, paperless, history}`, `type DocumentHistoryEntry`, `type ListDocumentsOptions`
- `createUploadIntent(userId, organizationId, { filename, size, mimeType }): Promise<{ uploadId, signedUrl, token, path }>` — validates against `src/config/documents.ts`; inserts via the caller's own RLS-scoped client; deletes the row if `createSignedUploadUrl()` fails.
- `completeUpload(userId, uploadId): Promise<DocumentUpload>` — confirms the object exists in storage (`storage.list()`) before flipping `pending` → `uploaded` and enqueueing `validateUpload`.
- `listDocuments(organizationId, options?: ListDocumentsOptions): Promise<{items, nextCursor}>` — mixed-filter (specs/05): `documentTypeKey`/`status`/`dateFrom`/`dateTo` served from our mirror; `q`/`tag` delegated to Paperless first (capped at `MAX_PAPERLESS_ID_SET` = 2000 ids), then intersected; `entityId`/`hasNoConnections` business filters resolved entirely from our DB.
- `listDocumentIds(organizationId, options?, cap?): Promise<string[]>` — Pomočnik Milestone 7. Loops `listDocuments()`'s own cursor to resolve a filter into a capped id set — backs "select all matching filter" for bulk actions and export.
- `getDocument(documentId): Promise<DocumentDetails>` — no `organizationId` param (derived from the fetched row; RLS scopes the read). One parallel `Promise.all` fan-out: mirror row's connections (`getConnections()`), a best-effort live Paperless read (`paperless: null` on any failure, never fails the page), and history.
- `getDocumentHistory(documentId, options?: {db?, organizationId?, paperlessDocumentId?}): Promise<DocumentHistoryEntry[]>` — merged Paperless `/api/documents/:id/history/` + our own `audit_logs`, sorted by timestamp. Options let `getDocument()` pass through what it already fetched, skipping a redundant row lookup.
- `updateDocument(userId, organizationId, documentId, {title?, documentDate?, documentTypeId?, customFieldValues?}): Promise<Document>` — write-through to Paperless first, mirror updated via the admin client from Paperless's own response (`documents` has no update RLS policy); explicitly rejects a `read-only` member before calling Paperless at all.

### `documents.actions.ts`
- `listDocumentsAction`, `getDocumentAction`, `getDocumentHistoryAction`, `updateDocumentAction` — typed Server Action wrappers (ADR-0009), `buildRequestContext()`-based.
- `countDocumentsMatchingFilterAction(filter?): Promise<{count}>` — Pomočnik Milestone 7. The count-confirmation step before a filter-scoped bulk action or export fires.
- `bulkEditDocumentsAction({paperlessDocumentIds, method, parameters?}): Promise<{operationId}>` — Pomočnik Milestone 7. Proxies Paperless's own `bulk_edit` (never reimplemented); writes a completed `background_operations` row purely for history/audit, since Paperless applies the edit atomically and synchronously server-side.

## `src/modules/entities/` and `src/modules/entity-types/` — Pomočnik Level 1

### `entities.service.ts`
- `type Entity`, `type EntityIdentifier`
- `createEntity(ctx, {entityTypeId, displayName, data?}): Promise<Entity>`, `updateEntity(ctx, entityId, {displayName?, status?, data?}): Promise<Entity>`, `getEntity(ctx, entityId): Promise<Entity>`, `deleteEntity(ctx, entityId, {force?}): Promise<void>` — soft delete, refused if connections exist unless `force`.
- `listEntities(ctx, {entityTypeId?, q?, status?}): Promise<Entity[]>` — `q` searches `search_tsv` + identifiers.
- `addIdentifier(ctx, entityId, {kind, value}): Promise<EntityIdentifier>`, `removeIdentifier(ctx, identifierId): Promise<void>`, `listEntityIdentifiers(ctx, entityId): Promise<EntityIdentifier[]>`
- `countEntitiesByType(ctx): Promise<Record<string, number>>`

### `entity-types.service.ts`
- `type EntityType`, `type EntityFieldDefinition`
- `listEntityTypes(ctx): Promise<EntityType[]>`, `getEntityType(ctx, entityTypeId): Promise<EntityType>`, `getEntityTypeByKey(ctx, key): Promise<EntityType>`, `createEntityType(ctx, {key, name, namePlural, fieldSchema?}): Promise<EntityType>`
- `addField(ctx, entityTypeId, field): Promise<EntityType>`, `renameFieldLabel(ctx, entityTypeId, key, label): Promise<EntityType>`, `changeFieldType(ctx, entityTypeId, key, type): Promise<EntityType>` (lossless cases only), `removeField(ctx, entityTypeId, key): Promise<EntityType>` (hides, doesn't delete data)
- `getVisibleFieldSchema(entityType)`, `getFieldSchema(entityType)` — pure helpers, not DB calls.

### `identifier-normalization.ts`
- `normalizeIdentifier(kind, value): string` — per-kind rules (`vat`, `company_reg`, `erp_id`, `email`, generic).

### `entities.actions.ts` / `entity-types.actions.ts`
- `createEntityFormAction(formData)`, `createEntityTypeFormAction(formData)`, `addFieldFormAction(formData)`, `removeFieldFormAction(formData)` — native-form Server Actions (ADR-0009); every success path redirects via `withStatus()` (a query-param-bearing URL), not the bare list path — this codebase has no `revalidatePath`, so a same-URL redirect does not refetch stale Server Component data (a real bug found via e2e testing).

## `src/modules/connections/` — Pomočnik Level 1

### `connections.service.ts`
- `type Connection`, `type ConnectableKind = "document" | "entity"`, `type Relation`, `type ConnectionWithOther`
- `getConnections(ctx, kind, id): Promise<ConnectionWithOther[]>` — the one union-query helper (both directions, hydrated with the other side's label/entity-type).
- `createConnection(ctx, {sourceKind, sourceId, targetKind, targetId, relation?, createdVia?, ruleId?}): Promise<Connection>` — rejects self-connection; rejects a source/target id that doesn't belong to the caller's org (`assertBelongsToOrg()`, isolation test #9); maps a unique-pair violation to `ConflictError`.
- `deleteConnection(ctx, connectionId): Promise<void>` — soft delete.
- `bulkCreateConnections(ctx, {sourceKind, sourceIds, targetKind, targetId, relation?, createdVia?}, onProgress?): Promise<{createdIds, skippedIds, failures}>` — Pomočnik Milestone 7. Loops `createConnection()` per item.

### `entity-merge.service.ts`
- `mergeEntities(ctx, {keepId, mergeId}): Promise<void>` — thin wrapper over the `merge_entities()` Postgres function (`docs/DATABASE.md`). Requires a request-context `ctx` (the RPC checks `auth.uid()` itself).

### `connections.actions.ts`
- `createConnectionAction`, `deleteConnectionAction`, `getConnectionsAction`, `mergeEntitiesAction` — Server Action wrappers.
- `bulkConnectDocumentsAction({documentIds?, filter?, targetKind, targetId, relation?}): Promise<{mode:"sync",operationId,created,skipped,failed} | {mode:"async",operationId,total}>` — Pomočnik Milestone 7. ≤50 items resolved runs synchronously; above that, enqueues `worker/jobs/bulk-action.ts`.
- `undoBulkConnectAction(operationId): Promise<void>` — reverses the connections a given bulk-connect operation created.
- `getBackgroundOperationAction(operationId)` — polling read for both bulk-connect and export progress.

## `src/modules/saved-views/` — Pomočnik Level 1
- `ensureStarterViews(ctx): Promise<SavedView[]>` — lazily seeds the five spec-required starter views on first call, no-ops if any already exist.
- `listSavedViews(ctx): Promise<SavedView[]>`

## `src/modules/background-operations/` — Pomočnik Level 1
- `type BackgroundOperation`
- `createBackgroundOperation(ctx, {kind, params, totalCount?}): Promise<BackgroundOperation>`, `getBackgroundOperation(ctx, id): Promise<BackgroundOperation>`
- `updateBackgroundOperationProgress(ctx, id, {processedCount, successCount?, failureCount?}): Promise<void>`, `completeBackgroundOperation(ctx, id, {successCount, failureCount, failures?, result?}): Promise<void>`, `failBackgroundOperation(ctx, id, errorMessage): Promise<void>` — worker-only (no update RLS policy on this table; callers use the admin client from a job context).

## `src/modules/exports/` — Pomočnik Level 1
- `resolveExportData(ctx, documentIds): Promise<{rows, entityTypeColumns}>` — batched (one connections query per direction, one entities query, one entity_types query) connected-entity column resolution.
- `buildCsv(data): string` (`file-builders.ts`) — `;` delimiter, UTF-8 BOM, `dd.mm.yyyy` dates.
- `buildXlsx(data): Promise<Buffer>` — streams via `exceljs`.
- `createExportAction({documentIds?, filter?, format}): Promise<{operationId, total}>` — always enqueues `worker/jobs/export.ts` (never runs synchronously, regardless of row count).
- `getExportAction(operationId)` — polling read.

## Route Handlers — Pomočnik

Per [ADR-0009](adr/0009-route-handlers-vs-server-actions.md): fetch/polling/streaming/download
surfaces only; everything else is a Server Action (see the modules above).

| Route | Purpose |
| --- | --- |
| `POST /api/documents/upload-intent` | Signed upload URL — `createUploadIntent()`. |
| `POST /api/documents/upload-complete` | Confirms the storage object landed — `completeUpload()`. |
| `GET /api/documents/[id]/preview` | Streams the file inline (sandboxed `<object>` target) — pipes `PaperlessClient#getStream()`'s body straight through, never a redirect to a raw Paperless URL carrying the tenant token. |
| `GET /api/documents/[id]/download` | Same shape as preview; Paperless itself sets `Content-Disposition: attachment`. |
| `POST /api/internal/paperless/document-consumed` | HMAC-verified post-consume webhook — see `docs/SECURITY.md`. |
| `GET /api/search?q=` | Pomočnik Level 1. Entity name/identifier match, scoped to the active org — backs the two-interaction connection picker. Entities only today; documents aren't searchable from this endpoint. |
| `GET /api/exports/[id]/download` | Pomočnik Level 1 (Milestone 7). Loads the `background_operations` row (RLS-scoped), issues a 5-minute signed URL against the private `exports` bucket, 307-redirects. |

## `src/lib/api-response.ts`

`specs/03-api.md`'s `{data,meta}`/`{error}` envelope for Route Handlers — Pomočnik.
- `apiSuccess<T>(data, meta?, init?: { status? }): NextResponse`
- `apiError(error, details?): NextResponse` — maps any thrown value through `toSafeError()`; error codes are the existing lowercase `AppError` convention, not `specs/03-api.md`'s literal UPPER_SNAKE (`docs/GLOSSARY.md`).

## `src/lib/pagination.ts`, `errors.ts`, `logger.ts`

### `pagination.ts`
- `type Cursor = { createdAt: string; id: string }`
- `encodeCursor(cursor: Cursor): string` — base64url of `"createdAt|id"`.
- `decodeCursor(value: string | null | undefined): Cursor | null`

### `errors.ts`
- `type SafeErrorShape = { code: string; message: string; status: number }`
- `class AppError extends Error` — `constructor(message, { code, status, expose? })`; `expose` defaults to `status < 500`.
- `class ValidationError` (400), `AuthenticationError` (401), `AuthorizationError` (403), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429), `BillingError` (400) — all `extends AppError`.
- `toSafeError(error: unknown): SafeErrorShape` — masks the message to a generic 500 for anything not an exposed `AppError`.

### `logger.ts`
- `type LogContext = Record<string, string | number | boolean | null | undefined>`
- `logger: { debug, info, warn, error }` — each `(message: string, context?: LogContext) => void`, writes structured JSON to console.

## `src/config/`

### `app.ts`
- `appConfig` — `{ name, description, url, supportEmail, logo, social, auth: {...}, features: featureConfig, billing: billingConfig }`.

### `features.ts`
- `featureConfig` — `{ billing, organizations, credits, documents, admin, notifications, mfa, outgoingWebhooks, cookieConsent }`.
- `type FeatureKey = keyof typeof featureConfig`
- `isFeatureEnabled(feature: FeatureKey): boolean`

### `billing.ts`
- `type BillingOwnerType`, `PlanKey`, `PlanFeatureMap`, `BillingPlan`, `CreditPack`.
- `billingOwnerType: BillingOwnerType` — derived from `featureConfig.organizations`.
- `billingConfig` — `{ currency, creditPacks, plans }`.

### `documents.ts`
- `documentsConfig` — `{ bucket, maxSizeBytes, allowedMimeTypes, pendingExpiryMinutes }` — Pomočnik, direct-to-storage, no spec'd size limit (see the file's own comment for the reasoning).

### `avatar.ts`
- `avatarConfig` — `{ bucket, maxSizeBytes, allowedMimeTypes }`.

### `navigation.ts`
- `type NavigationItem = { label, href, feature?: FeatureKey }`
- `marketingNavigation`, `dashboardNavigation`, `settingsNavigation: NavigationItem[]`.

### `modules.ts`
- `type ModuleStatus = "required" | "optional" | "recommended"`, `ModuleDefinition`.
- `moduleMatrix: ModuleDefinition[]`.

## `src/lib/supabase/`

- `server.ts` → `createClient(): Promise<SupabaseClient<Database>>` — SSR cookie client for Server Components/Actions.
- `admin.ts` → `createAdminClient(): SupabaseClient<Database>` — service-role client, `autoRefreshToken:false, persistSession:false`.
- `client.ts` → `createClient(): SupabaseClient<Database>` — browser client.
- `middleware.ts` → `updateSession(request: NextRequest): Promise<NextResponse>` — refreshes session cookies in Next middleware; no-ops if Supabase env vars are absent.

## `src/lib/stripe/client.ts`

- `getStripeClient(): Stripe` — memoized singleton, `apiVersion: "2025-08-27.basil"`, requires `STRIPE_SECRET_KEY`.
