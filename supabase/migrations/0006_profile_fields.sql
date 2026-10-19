-- =====================================================================
-- Migration 0006: Add DOB, Age, CNIC, and Guardian Info to Profiles
-- =====================================================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS dob text,
ADD COLUMN IF NOT EXISTS age integer,
ADD COLUMN IF NOT EXISTS cnic text,
ADD COLUMN IF NOT EXISTS guardian_name text,
ADD COLUMN IF NOT EXISTS guardian_phone text;
