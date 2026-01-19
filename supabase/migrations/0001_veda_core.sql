-- 0001_veda_core.sql
-- Core tables + RLS + privacy-safe RPCs

-- Extensions (optional; keep simple for now)
create extension if not exists pgcrypto;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','seller')),
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- Seller location/config (one seller can operate one "zone" initially)
create table if not exists public.seller_locations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  city text not null,
  lat double precision not null,
  lng double precision not null,
  radius_km double precision not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Requests (user intent)
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  text text not null,
  mode text not null check (mode in ('now','later','takeaway')),
  scheduled_at timestamptz,
  city text not null,
  public_area text not null,       -- locality string / coarse area
  lat double precision not null,   -- PRIVATE (only to user; exact to seller after accept)
  lng double precision not null,   -- PRIVATE
  status text not null default 'open' check (status in ('open','locked','fulfilled','cancelled')),
  locked_seller_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists requests_city_status_idx on public.requests(city, status);
create index if not exists requests_created_idx on public.requests(created_at);

-- Offers (seller responses)
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  price_total numeric,
  delivery_fee numeric,
  fulfillment text not null default 'delivery' check (fulfillment in ('delivery','pickup')),
  eta_minutes int,
  status text not null default 'sent' check (status in ('sent','accepted','rejected','expired')),
  created_at timestamptz not null default now()
);

create index if not exists offers_request_idx on public.offers(request_id);
create index if not exists offers_seller_idx on public.offers(seller_id);

-- Messages (soft negotiation)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  from_role text not null check (from_role in ('user','seller')),
  from_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_request_idx on public.messages(request_id);

-- Orders (one per request)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique not null references public.requests(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  pin_hash text not null,
  status text not null default 'locked' check (status in ('locked','fulfilled','cancelled')),
  fulfilled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Device tokens (push)
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null default 'android',
  token text not null,
  updated_at timestamptz not null default now(),
  unique(profile_id, token)
);

-- ===========
-- RLS ON
-- ===========
alter table public.profiles enable row level security;
alter table public.seller_locations enable row level security;
alter table public.requests enable row level security;
alter table public.offers enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.device_tokens enable row level security;

-- ===========
-- Helper: current profile role
-- ===========
create or replace function public.my_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ===========
-- Profiles policies
-- ===========
create policy "profiles read own" on public.profiles
for select using (id = auth.uid());

create policy "profiles insert self" on public.profiles
for insert with check (id = auth.uid());

create policy "profiles update own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

-- ===========
-- Seller locations policies
-- ===========
create policy "seller_locations own read" on public.seller_locations
for select using (seller_id = auth.uid());

create policy "seller_locations own write" on public.seller_locations
for insert with check (seller_id = auth.uid());

create policy "seller_locations own update" on public.seller_locations
for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- ===========
-- Requests policies (users can read/write their requests)
-- ===========
create policy "requests user read own" on public.requests
for select using (user_id = auth.uid());

create policy "requests user insert own" on public.requests
for insert with check (user_id = auth.uid());

create policy "requests user update own" on public.requests
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- NOTE: sellers do NOT get a direct SELECT policy on requests.
-- Sellers must use RPC(s) that return safe fields.

-- ===========
-- Offers policies
-- ===========
-- Users can read offers for their own requests
create policy "offers user read for own requests" on public.offers
for select using (
  exists (
    select 1 from public.requests r
    where r.id = offers.request_id and r.user_id = auth.uid()
  )
);

-- Sellers can insert offers (but only if they are seller)
create policy "offers seller insert" on public.offers
for insert with check (public.my_role() = 'seller' and seller_id = auth.uid());

-- Sellers can read their own offers
create policy "offers seller read own" on public.offers
for select using (seller_id = auth.uid());

-- Sellers can update their own offers
create policy "offers seller update own" on public.offers
for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- ===========
-- Messages policies
-- ===========
-- Users can read/write messages on their requests
create policy "messages user read own thread" on public.messages
for select using (
  exists (select 1 from public.requests r where r.id = messages.request_id and r.user_id = auth.uid())
);

create policy "messages user insert own thread" on public.messages
for insert with check (
  from_role = 'user'
  and from_id = auth.uid()
  and exists (select 1 from public.requests r where r.id = messages.request_id and r.user_id = auth.uid())
);

-- Sellers can read/write messages only if request is locked to them
create policy "messages seller read locked thread" on public.messages
for select using (
  public.my_role() = 'seller'
  and exists (
    select 1 from public.requests r
    where r.id = messages.request_id
      and r.status = 'locked'
      and r.locked_seller_id = auth.uid()
  )
);

create policy "messages seller insert locked thread" on public.messages
for insert with check (
  public.my_role() = 'seller'
  and from_role = 'seller'
  and from_id = auth.uid()
  and exists (
    select 1 from public.requests r
    where r.id = messages.request_id
      and r.status = 'locked'
      and r.locked_seller_id = auth.uid()
  )
);

-- ===========
-- Orders policies
-- ===========
create policy "orders user read own" on public.orders
for select using (user_id = auth.uid());

create policy "orders seller read own" on public.orders
for select using (seller_id = auth.uid());

-- ===========
-- Device tokens policies
-- ===========
create policy "device tokens read own" on public.device_tokens
for select using (profile_id = auth.uid());

create policy "device tokens upsert own" on public.device_tokens
for insert with check (profile_id = auth.uid());

create policy "device tokens update own" on public.device_tokens
for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());


-- ===========
-- RPC: seller gets nearby open requests with coarse fields only
-- ===========
create or replace function public.get_visible_requests_for_seller(
  p_city text,
  p_seller_lat double precision,
  p_seller_lng double precision,
  p_radius_km double precision,
  p_limit int default 50
)
returns table (
  request_id uuid,
  category text,
  text text,
  mode text,
  scheduled_at timestamptz,
  city text,
  public_area text,
  distance_km double precision,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id as request_id,
    r.category,
    r.text,
    r.mode,
    r.scheduled_at,
    r.city,
    r.public_area,
    -- simple distance (approx). upgrade to PostGIS later.
    (111.0 * sqrt( power(r.lat - p_seller_lat, 2) + power(r.lng - p_seller_lng, 2) )) as distance_km,
    r.created_at
  from public.requests r
  where r.city = p_city
    and r.status = 'open'
    and (111.0 * sqrt( power(r.lat - p_seller_lat, 2) + power(r.lng - p_seller_lng, 2) )) <= p_radius_km
  order by r.created_at desc
  limit p_limit;
$$;

revoke all on function public.get_visible_requests_for_seller(text,double precision,double precision,double precision,int) from public;
grant execute on function public.get_visible_requests_for_seller(text,double precision,double precision,double precision,int) to authenticated;

-- ===========
-- RPC: lock a request to a seller by accepting an offer (user action)
-- ===========
create or replace function public.accept_offer_and_lock(
  p_offer_id uuid
)
returns table (
  order_id uuid,
  request_id uuid,
  seller_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_request public.requests;
  v_pin text;
  v_pin_hash text;
  v_order_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  if not found then
    raise exception 'Offer not found';
  end if;

  select * into v_request from public.requests where id = v_offer.request_id;
  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.user_id <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_request.status <> 'open' then
    raise exception 'Request not open';
  end if;

  -- Generate a 4-digit PIN
  v_pin := lpad((floor(random()*10000))::int::text, 4, '0');
  v_pin_hash := encode(digest(v_pin, 'sha256'), 'hex');

  -- Lock request
  update public.requests
    set status = 'locked',
        locked_seller_id = v_offer.seller_id
  where id = v_request.id;

  -- Mark offer accepted; reject others
  update public.offers set status = 'accepted' where id = v_offer.id;
  update public.offers set status = 'rejected'
    where request_id = v_request.id and id <> v_offer.id and status = 'sent';

  -- Create order
  insert into public.orders (request_id, offer_id, user_id, seller_id, pin_hash, status)
  values (v_request.id, v_offer.id, v_request.user_id, v_offer.seller_id, v_pin_hash, 'locked')
  returning id into v_order_id;

  -- Return order identifiers (PIN is returned by a separate function to user only)
  return query select v_order_id, v_request.id, v_offer.seller_id;
end;
$$;

revoke all on function public.accept_offer_and_lock(uuid) from public;
grant execute on function public.accept_offer_and_lock(uuid) to authenticated;

-- ===========
-- RPC: user fetches plaintext PIN ONCE (store it client-side for display)
-- For MVP simplicity, we return the PIN in a separate table.
-- Better: store encrypted pin; or return it from accept function via a secure channel.
-- We'll do a lightweight approach: store PIN plaintext in a user-only table.
-- ===========
create table if not exists public.order_pins (
  order_id uuid primary key references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pin_plain text not null,
  created_at timestamptz not null default now()
);

alter table public.order_pins enable row level security;

create policy "order_pins user read own" on public.order_pins
for select using (user_id = auth.uid());

create policy "order_pins user insert own" on public.order_pins
for insert with check (user_id = auth.uid());

-- Update accept function to also store plaintext pin in order_pins
create or replace function public.accept_offer_and_lock(
  p_offer_id uuid
)
returns table (
  order_id uuid,
  request_id uuid,
  seller_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_request public.requests;
  v_pin text;
  v_pin_hash text;
  v_order_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;

  select * into v_request from public.requests where id = v_offer.request_id;
  if not found then raise exception 'Request not found'; end if;

  if v_request.user_id <> auth.uid() then raise exception 'Not allowed'; end if;
  if v_request.status <> 'open' then raise exception 'Request not open'; end if;

  v_pin := lpad((floor(random()*10000))::int::text, 4, '0');
  v_pin_hash := encode(digest(v_pin, 'sha256'), 'hex');

  update public.requests
    set status = 'locked',
        locked_seller_id = v_offer.seller_id
  where id = v_request.id;

  update public.offers set status = 'accepted' where id = v_offer.id;
  update public.offers set status = 'rejected'
    where request_id = v_request.id and id <> v_offer.id and status = 'sent';

  insert into public.orders (request_id, offer_id, user_id, seller_id, pin_hash, status)
  values (v_request.id, v_offer.id, v_request.user_id, v_offer.seller_id, v_pin_hash, 'locked')
  returning id into v_order_id;

  insert into public.order_pins (order_id, user_id, pin_plain)
  values (v_order_id, v_request.user_id, v_pin);

  return query select v_order_id, v_request.id, v_offer.seller_id;
end;
$$;

-- ===========
-- RPC: seller gets exact location ONLY for locked order they own
-- ===========
create or replace function public.get_order_location(
  p_order_id uuid
)
returns table (
  lat double precision,
  lng double precision,
  public_area text,
  city text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.lat, r.lng, r.public_area, r.city
  from public.orders o
  join public.requests r on r.id = o.request_id
  where o.id = p_order_id
    and o.seller_id = auth.uid()
    and o.status = 'locked';
$$;

revoke all on function public.get_order_location(uuid) from public;
grant execute on function public.get_order_location(uuid) to authenticated;

-- ===========
-- RPC: seller fulfills order by PIN (no plaintext stored for seller)
-- ===========
create or replace function public.fulfill_order_with_pin(
  p_order_id uuid,
  p_pin text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_hash text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return false; end if;

  if v_order.seller_id <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  if v_order.status <> 'locked' then
    return false;
  end if;

  v_hash := encode(digest(p_pin, 'sha256'), 'hex');
  if v_hash <> v_order.pin_hash then
    return false;
  end if;

  update public.orders set status='fulfilled', fulfilled_at=now() where id = p_order_id;
  update public.requests set status='fulfilled' where id = v_order.request_id;

  return true;
end;
$$;

revoke all on function public.fulfill_order_with_pin(uuid,text) from public;
grant execute on function public.fulfill_order_with_pin(uuid,text) to authenticated;
