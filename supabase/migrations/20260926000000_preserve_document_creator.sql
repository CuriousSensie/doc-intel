-- A document lost its creator (created_by -> NULL) whenever it was re-synced from Paperless
-- without an upload row (webhook / reconciliation / re-sync after an edit): the sync upsert wrote
-- created_by = NULL over the real value. The sync code is fixed; this repairs existing rows and
-- guards against any other writer doing the same.

-- Best-effort repair from the upload that produced each document (rows past their retention are
-- gone, so anything else stays NULL and is only visible to the owner).
update public.documents d
set created_by = u.created_by
from public.document_uploads u
where u.document_id = d.id
  and d.created_by is null
  and u.created_by is not null;

update public.documents d
set byte_size = u.size_bytes
from public.document_uploads u
where u.document_id = d.id
  and d.byte_size is null;

-- Once a creator is recorded it can only change to another real user, never back to NULL by a
-- normal write. pg_trigger_depth() = 1 skips the nested update Postgres itself issues for
-- `on delete set null` when a user is deleted — that must still be allowed to null it.
create or replace function public.preserve_document_creator()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() = 1 and new.created_by is null and old.created_by is not null then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger documents_preserve_creator
  before update on public.documents
  for each row execute function public.preserve_document_creator();
