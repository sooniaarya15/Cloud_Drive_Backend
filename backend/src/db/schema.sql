create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text,
  auth_provider text not null default 'LOCAL',
  name text,
  image_url text,
  storage_used_bytes bigint not null default 0,
  storage_quota_bytes bigint not null default 5368709120,
  created_at timestamptz default now()
);

create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references users(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  is_deleted boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists uq_folder_name_per_parent
  on folders(owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), name)
  where is_deleted = false;

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mime_type text,
  size_bytes bigint default 0,
  storage_key text unique not null,
  owner_id uuid references users(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  version_id uuid,
  checksum text,
  is_starred boolean default false,
  is_deleted boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_files_owner on files(owner_id);
create index if not exists idx_files_folder on files(folder_id);
create index if not exists idx_files_trgm on files using gin (name gin_trgm_ops);
create index if not exists idx_files_fts on files using gin (to_tsvector('simple', name));

create table if not exists file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid references files(id) on delete cascade,
  version_number int not null,
  storage_key text not null,
  size_bytes bigint,
  checksum text,
  created_at timestamptz default now()
);

create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('file','folder')),
  resource_id uuid not null,
  grantee_user_id uuid references users(id) on delete cascade,
  role text not null check (role in ('viewer','editor')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  unique(resource_type, resource_id, grantee_user_id)
);

create table if not exists link_shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('file','folder')),
  resource_id uuid not null,
  token text not null unique,
  role text not null default 'viewer' check (role = 'viewer'),
  password_hash text,
  expires_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_link_shares_token on link_shares(token);

create table if not exists stars (
  user_id uuid references users(id) on delete cascade,
  resource_type text not null check (resource_type in ('file','folder')),
  resource_id uuid not null,
  created_at timestamptz default now(),
  primary key (user_id, resource_type, resource_id)
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id) on delete set null,
  action text not null check (action in ('upload','rename','delete','restore','move','share','download')),
  resource_type text not null check (resource_type in ('file','folder')),
  resource_id uuid not null,
  context jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_activities_created on activities(created_at desc);