-- =====================================================================
-- Migration 0005: Community Reporting, Regions, Corroboration & Moderation
-- =====================================================================

-- 1. Community Regions (Searchable geographical areas)
create table if not exists public.community_regions (
  id text primary key,
  name text not null,
  name_urdu text,
  region_type text not null check (region_type in ('university', 'campus', 'neighbourhood', 'public_area', 'transport_hub', 'city')),
  city text not null default 'Lahore',
  province text not null default 'Punjab',
  parent_region_id text references public.community_regions(id) on delete set null,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Community Places (Specific places within regions)
create table if not exists public.community_places (
  id text primary key,
  region_id text not null references public.community_regions(id) on delete cascade,
  name text not null,
  name_urdu text,
  place_type text not null check (place_type in ('main_campus', 'entrance_gate', 'transport_stop', 'library_zone', 'commercial_area', 'parking', 'general')),
  latitude double precision,
  longitude double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Community Reports (Main persistent complaints & safety warnings)
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  reporter_display_name text not null default 'Community Guardian',
  title text not null,
  description text not null,
  category text not null check (category in (
    'harassment',
    'unsafe_area',
    'poor_lighting',
    'suspicious_activity',
    'infrastructure',
    'transport_hazard',
    'fraud_scam',
    'stalking',
    'general_safety'
  )),
  region_id text not null references public.community_regions(id) on delete restrict,
  place_id text references public.community_places(id) on delete set null,
  location_name text not null,
  latitude double precision,
  longitude double precision,
  incident_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'published' check (status in ('pending_review', 'published', 'hidden', 'resolved', 'flagged')),
  corroboration_status text not null default 'single_report' check (corroboration_status in ('single_report', 'multiple_reports', 'community_corroborated', 'under_review', 'resolved')),
  corroboration_count int not null default 1,
  corroboration_notes text,
  resolved_at timestamptz,
  resolved_note text,
  sentiment text not null default 'uncomfortable' check (sentiment in ('very_unsafe', 'uncomfortable', 'neutral', 'safe', 'very_safe')),
  tags jsonb not null default '[]'::jsonb,
  views_count int not null default 1,
  helpful_count int not null default 0,
  related_issue_id uuid,
  content_hash text
);

-- 4. Community Report Updates (Follow-ups & progress updates)
create table if not exists public.community_report_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.community_reports(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_display_name text not null default 'Community Member',
  update_type text not null default 'status_update' check (update_type in ('status_update', 'additional_info', 'safety_alert', 'resolution_note')),
  content text not null,
  moderation_status text not null default 'published' check (moderation_status in ('published', 'hidden', 'pending_review')),
  created_at timestamptz not null default now()
);

-- 5. Community Report Confirmations (Independent community corroboration)
create table if not exists public.community_report_confirmations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.community_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  confirmation_type text not null default 'observed' check (confirmation_type in ('personally_experienced', 'observed', 'frequently_occurs')),
  created_at timestamptz not null default now(),
  constraint unique_report_user_confirmation unique (report_id, user_id)
);

-- 6. User Restrictions (Temporary posting bans & limits)
create table if not exists public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  restriction_type text not null check (restriction_type in ('report_posting', 'update_posting', 'community_ban')),
  reason_code text not null check (reason_code in ('duplicate_spam', 'repeated_abuse', 'fabricated_report', 'malicious_conduct', 'harassment', 'terms_violation')),
  details text,
  user_message text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  issued_by text not null default 'system_moderation',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'appealed')),
  appeal_status text not null default 'none' check (appeal_status in ('none', 'pending', 'accepted', 'rejected')),
  appeal_reason text,
  appeal_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 7. Community Moderation Audit Log
create table if not exists public.community_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  target_report_id uuid references public.community_reports(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action_taken text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  performed_by text not null default 'system',
  created_at timestamptz not null default now()
);

-- Indexes for lightning fast lookups
create index if not exists idx_community_reports_region on public.community_reports(region_id, status, created_at desc);
create index if not exists idx_community_reports_category on public.community_reports(category, status);
create index if not exists idx_community_reports_corroboration on public.community_reports(corroboration_status, status);
create index if not exists idx_community_reports_user on public.community_reports(user_id, created_at desc);
create index if not exists idx_community_updates_report on public.community_report_updates(report_id, created_at desc);
create index if not exists idx_community_confirmations_report on public.community_report_confirmations(report_id);
create index if not exists idx_user_restrictions_active on public.user_restrictions(user_id, status, expires_at);

-- Row Level Security (RLS) Configuration
alter table public.community_regions enable row level security;
alter table public.community_places enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_report_updates enable row level security;
alter table public.community_report_confirmations enable row level security;
alter table public.user_restrictions enable row level security;
alter table public.community_moderation_audit enable row level security;

-- Read policies: Published regions, places, reports and updates are publicly readable
create policy "public_read_community_regions" on public.community_regions for select using (is_active = true);
create policy "public_read_community_places" on public.community_places for select using (is_active = true);
create policy "public_read_community_reports" on public.community_reports for select using (status in ('published', 'resolved'));
create policy "public_read_community_updates" on public.community_report_updates for select using (moderation_status = 'published');
create policy "public_read_community_confirmations" on public.community_report_confirmations for select using (true);

-- User restriction policy: Users can read their own restrictions
create policy "own_user_restrictions" on public.user_restrictions for select using ((select auth.uid()) = user_id);

-- Insert Seed Data for Regions (Universities, Campuses & Neighbourhoods in Lahore & Punjab)
insert into public.community_regions (id, name, name_urdu, region_type, city, province, display_order)
values
  ('ucp', 'UCP (University of Central Punjab)', 'یونیورسٹی آف سینٹرل پنجاب', 'university', 'Lahore', 'Punjab', 1),
  ('umt', 'UMT (University of Management and Technology)', 'یونیورسٹی آف مینجمنٹ اینڈ ٹیکنالوجی', 'university', 'Lahore', 'Punjab', 2),
  ('uol', 'UOL (University of Lahore)', 'یونیورسٹی آف لاہور', 'university', 'Lahore', 'Punjab', 3),
  ('pucit', 'PU / New Campus (Punjab University)', 'پنجاب یونیورسٹی (نیو کیمپس)', 'university', 'Lahore', 'Punjab', 4),
  ('lums', 'LUMS (DHA Phase 5)', 'لمز (ڈی ایچ اے فیز 5)', 'university', 'Lahore', 'Punjab', 5),
  ('johar_town', 'Johar Town', 'جوہر ٹاؤن', 'neighbourhood', 'Lahore', 'Punjab', 6),
  ('model_town', 'Model Town', 'ماڈل ٹاؤن', 'neighbourhood', 'Lahore', 'Punjab', 7),
  ('gulberg', 'Gulberg (Main Blvd & MM Alam)', 'گلبرگ (مین بلیوارڈ و ایم ایم عالم)', 'neighbourhood', 'Lahore', 'Punjab', 8),
  ('dha_lahore', 'DHA Lahore (Phase 1-6)', 'ڈی ایچ اے لاہور', 'neighbourhood', 'Lahore', 'Punjab', 9),
  ('ferozepur_road', 'Ferozepur Road / Chuhng Corridor', 'فروز پور روڈ / چونگ کوریڈور', 'transport_hub', 'Lahore', 'Punjab', 10),
  ('canal_road', 'Canal Bank Road', 'کینال روڈ', 'transport_hub', 'Lahore', 'Punjab', 11),
  ('mall_road', 'Mall Road & Civil Lines', 'مال روڈ و سول لائنز', 'public_area', 'Lahore', 'Punjab', 12),
  ('allama_iqbal_town', 'Allama Iqbal Town', 'علامہ اقبال ٹاؤن', 'neighbourhood', 'Lahore', 'Punjab', 13),
  ('rawalpindi_cantt', 'Rawalpindi Cantt / Saddar', 'راولپنڈی کینٹ / صدر', 'neighbourhood', 'Rawalpindi', 'Punjab', 14),
  ('faisalabad_city', 'Faisalabad City Center', 'فیصل آباد سٹی سینٹر', 'neighbourhood', 'Faisalabad', 'Punjab', 15),
  ('multan_cantt', 'Multan Cantt', 'ملتان کینٹ', 'neighbourhood', 'Multan', 'Punjab', 16)
on conflict (id) do update set
  name = excluded.name,
  name_urdu = excluded.name_urdu,
  region_type = excluded.region_type;

-- Insert Seed Data for Places within Universities & Neighbourhoods
insert into public.community_places (id, region_id, name, name_urdu, place_type)
values
  ('ucp-gate1', 'ucp', 'Main Entrance Gate 1 (Khayaban-e-Jinnah)', 'مین گیٹ 1 (خیابانِ جناح)', 'entrance_gate'),
  ('ucp-bus-stop', 'ucp', 'Shaukat Khanum / UCP Public Bus Stop', 'شوکت خانم / یو سی پی پبلک بس اسٹاپ', 'transport_stop'),
  ('ucp-campus-quad', 'ucp', 'Central Academic Quad & Library Pathway', 'سینٹرل اکیڈمک کواڈ و لائبریری پاتھ', 'main_campus'),
  ('umt-gate1', 'umt', 'North Main Gate 1 (C-Block)', 'نارتھ مین گیٹ 1 (سی بلاک)', 'entrance_gate'),
  ('umt-transport', 'umt', 'UMT Roundabout & Shuttle Pick-up Zone', 'یو ایم ٹی راؤنڈ اباؤٹ و شٹل اسٹاپ', 'transport_stop'),
  ('umt-commercial', 'umt', 'Bagh-e-Jinnah Commercial Market (Opposite UMT)', 'باغ جناح مارکیٹ (بالمقابل یو ایم ٹی)', 'commercial_area'),
  ('uol-gate1', 'uol', 'Defence Road Main Entrance Gate', 'ڈیفنس روڈ مین گیٹ', 'entrance_gate'),
  ('uol-bus-bay', 'uol', 'Public Speedo / Metro Feeder Bus Bay', 'اسپیڈو / میٹرو فیڈر بس بے', 'transport_stop'),
  ('johar-expo', 'johar_town', 'Expo Centre Roundabout & Emporium Approach', 'ایکسپو سینٹر چوک و ایمپوریم اپروچ', 'transport_stop'),
  ('gulberg-mmalam', 'gulberg', 'MM Alam Road Commercial Strip', 'ایم ایم عالم روڈ کمرشل اسٹریپ', 'commercial_area'),
  ('model-central', 'model_town', 'Model Town Central Park & C-Block Market', 'ماڈل ٹاؤن سینٹرل پارک و سی بلاک مارکیٹ', 'commercial_area')
on conflict (id) do update set
  name = excluded.name,
  name_urdu = excluded.name_urdu;
