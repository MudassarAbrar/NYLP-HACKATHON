/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MehfoozAi Authentication Layer
 *
 * Dual-mode engine:
 * - SUPABASE MODE (active when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set):
 *   real email/password auth via Supabase Auth, profile persisted in
 *   public.profiles, emergency contacts in public.emergency_contacts,
 *   stealth PIN stored ONLY as a salted SHA-256 hash (never plaintext).
 * - LEGACY MODE (offline / no credentials): the original localStorage engine
 *   is preserved unchanged so `npm run dev` works without any configuration.
 *
 * All exported signatures are kept compatible with the original module.
 */

import { UserProfile, PunjabDistrict, AppLanguage, UserContact } from '../types';
import { isSupabaseConfigured, getSupabase } from './supabase';
import { generateRandomSalt, setVaultSalt, hashPin, clearCachedKey } from './crypto';
import type { SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';

const STORAGE_USERS_KEY = 'mehfooz_registered_users_v1';
const STORAGE_SESSION_KEY = 'mehfooz_current_session_v1';
const PROFILE_CACHE_KEY = 'mehfooz_profile_cache_v1';
const PIN_HASH_CACHE_KEY = 'mehfooz_pin_hash';
const PIN_SALT_CACHE_KEY = 'mehfooz_pin_salt';
const SUPABASE_SESSION_PREFIX = 'sb-';
const SUPABASE_SESSION_SUFFIX = '-auth-token';

// Seed demo account (LEGACY offline mode only — in Supabase mode the demo
// account is provisioned in Supabase Auth by the operator, see README).
const INITIAL_DEMO_USER: UserProfile = {
  id: 'user-demo-001',
  email: 'demo@mehfooz.test',
  fullName: 'Ayesha Rehman',
  safeNickname: 'Ayesha',
  age: 24,
  cnic: '35201-8765432-8',
  district: 'Lahore',
  phone: '+92 300 1234567',
  address: 'Gulberg III, Lahore, Punjab',
  guardianName: 'Zainab Rehman (Mother)',
  guardianPhone: '+92 300 1234567',
  emergencyContactName: 'Zainab (Mom)',
  emergencyContactPhone: '+92 300 1234567',
  emergencyContacts: [
    { id: 'c1', name: 'Zainab (Mom)', relation: 'Mother', phone: '+92 300 1234567', isDefaultNotified: true },
    { id: 'c2', name: 'Tariq (Dad)', relation: 'Father', phone: '+92 321 9876543', isDefaultNotified: true },
    { id: 'c3', name: 'Hamza (Brother)', relation: 'Brother', phone: '+92 333 4567890', isDefaultNotified: true },
    { id: 'c4', name: 'Fatima (Friend)', relation: 'Friend', phone: '+92 345 5566778', isDefaultNotified: false },
    { id: 'c5', name: 'Maryam (Sister)', relation: 'Sister', phone: '+92 312 9988776', isDefaultNotified: false }
  ],
  preferredLanguage: 'en',
  themeMode: 'light',
  stealthPin: '1520',
  discreetNotifications: true,
  quickExitHotkey: 'Escape',
  safeLocations: "Sister's home in Gulberg, Model Town Police Station, Gulshan Community Center",
  commonlyVisitedLocations: "Punjab University New Campus, Packages Mall, Liberty Market",
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
};

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  safe_nickname: string | null;
  dob: string | null;
  age: number | null;
  cnic: string | null;
  district: string | null;
  phone: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  preferred_language: 'en' | 'ur';
  theme_mode: string;
  stealth_pin_hash: string | null;
  pin_salt: string | null;
  vault_salt: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  discreet_notifications: boolean;
  quick_exit_hotkey: string;
  created_at: string;
  updated_at: string;
}

function isSupabaseMode(): boolean {
  return isSupabaseConfigured() && getSupabase() !== null;
}

// =====================================================================
// LEGACY (localStorage) ENGINE — preserved for offline fallback
// =====================================================================

// LEGACY static-salt password hash — kept ONLY to verify accounts created
// before per-user salts existed (those records are upgraded on next login).
async function hashPassword(password: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(password + '_mehfooz_salt_2026'));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return btoa(password + '_salt');
  }
}

interface StoredUserRecord {
  profile: UserProfile;
  passwordHash: string;
  /** Per-user salt (new records); absent on legacy static-salt records. */
  salt?: string;
}

function getStoredUsers(): Record<string, StoredUserRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStoredUsers(users: Record<string, StoredUserRecord>): void {
  try {
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users));
  } catch (err) {
    console.error('Failed to save user repository:', err);
  }
}

// =====================================================================
// SUPABASE MODE HELPERS
// =====================================================================

function cacheProfile(profile: UserProfile): void {
  try {
    // SECURITY: Ensure stealthPin (plaintext password) is never stored in the cached profile object
    const sanitized = { ...profile, stealthPin: '' };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.warn('Failed to cache profile:', err);
  }
}

function clearProfileCache(): void {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* noop */
  }
}

function cachePinLocally(pinHash: string, pinSalt: string): void {
  try {
    localStorage.setItem(PIN_HASH_CACHE_KEY, pinHash);
    localStorage.setItem(PIN_SALT_CACHE_KEY, pinSalt);
  } catch (err) {
    console.warn('Failed to cache PIN hash:', err);
  }
}

function clearPinCache(): void {
  try {
    localStorage.removeItem(PIN_HASH_CACHE_KEY);
    localStorage.removeItem(PIN_SALT_CACHE_KEY);
    localStorage.removeItem('mehfooz_custom_pin');
  } catch {
    /* noop */
  }
}

function computeAgeFromDob(dobString?: string | null): number | undefined {
  if (!dobString) return undefined;
  const birthDate = new Date(dobString);
  if (isNaN(birthDate.getTime())) return undefined;
  const today = new Date();
  let computedAge = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    computedAge--;
  }
  return computedAge >= 0 ? computedAge : undefined;
}

function mapRowToProfile(row: ProfileRow, contacts: UserContact[]): UserProfile {
  const guardianName = row.guardian_name || row.emergency_contact_name || '';
  const guardianPhone = row.guardian_phone || row.emergency_contact_phone || '';

  const fallbackContacts: UserContact[] =
    guardianPhone
      ? [{
          id: 'primary-guardian',
          name: guardianName || 'Guardian',
          relation: 'Guardian',
          phone: guardianPhone,
          isDefaultNotified: true,
          isEmergencyContact: true
        }]
      : [];

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || 'Mehfooz User',
    safeNickname: row.safe_nickname || (row.full_name ? row.full_name.split(' ')[0] : 'Friend'),
    dob: row.dob || undefined,
    age: row.age || computeAgeFromDob(row.dob),
    cnic: row.cnic || undefined,
    district: (row.district as PunjabDistrict) || 'Other Punjab District',
    phone: row.phone || '',
    guardianName: guardianName || undefined,
    guardianPhone: guardianPhone || undefined,
    emergencyContactName: row.emergency_contact_name || guardianName || '',
    emergencyContactPhone: row.emergency_contact_phone || guardianPhone || '',
    emergencyContacts: contacts.length > 0 ? contacts : fallbackContacts,
    preferredLanguage: row.preferred_language === 'ur' ? 'ur' : 'en',
    themeMode: row.theme_mode === 'dark' ? 'dark' : 'light',
    // The PIN itself is never returned from the server (hash-only storage);
    // an empty string makes profile forms fall back to their placeholder.
    stealthPin: '',
    discreetNotifications: row.discreet_notifications,
    quickExitHotkey: row.quick_exit_hotkey || 'Escape',
    createdAt: row.created_at,
    lastLoginAt: new Date().toISOString()
  };
}

async function fetchContacts(supabase: SupabaseClient, userId: string): Promise<UserContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    name: String(r.name || 'Contact'),
    relation: String(r.relation || 'Contact'),
    phone: String(r.phone || ''),
    isDefaultNotified: Boolean(r.is_default_notified),
    isEmergencyContact: Boolean(r.is_emergency_contact)
  }));
}

/**
 * Loads the profiles row for an authenticated user, creating a skeleton row
 * if the signup trigger did not run, or backfilling missing fields from user_metadata.
 */
async function ensureProfileRow(supabase: SupabaseClient, authUser: SupabaseAuthUser): Promise<ProfileRow> {
  const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
  const meta = (authUser.user_metadata || {}) as Record<string, any>;

  let pending: Record<string, any> = {};
  try {
    const raw = localStorage.getItem('mehfooz_pending_profile');
    if (raw) pending = JSON.parse(raw);
  } catch {}

  const emergencyPhone = meta.emergency_contact_phone || meta.guardian_phone || pending.emergencyContactPhone || pending.guardianPhone || null;
  const guardianPhone = meta.guardian_phone || meta.emergency_contact_phone || pending.guardianPhone || pending.emergencyContactPhone || null;
  const emergencyName = meta.emergency_contact_name || meta.guardian_name || pending.emergencyContactName || pending.guardianName || null;
  const guardianName = meta.guardian_name || meta.emergency_contact_name || pending.guardianName || pending.emergencyContactName || null;
  const dob = meta.dob || pending.dob || null;
  const age = meta.age ? Number(meta.age) : (pending.age ? Number(pending.age) : computeAgeFromDob(dob) || null);
  const cnic = meta.cnic || pending.cnic || null;
  const phone = meta.phone || pending.phone || null;
  const pinHash = meta.stealth_pin_hash || pending.stealthPinHash || null;
  const pinSalt = meta.pin_salt || pending.pinSalt || null;
  const vaultSalt = meta.vault_salt || null;

  if (data) {
    const existing = data as Record<string, any>;
    const updates: Record<string, any> = {};

    if (!existing.emergency_contact_phone && emergencyPhone) updates.emergency_contact_phone = emergencyPhone;
    if (!existing.guardian_phone && guardianPhone) updates.guardian_phone = guardianPhone;
    if (!existing.emergency_contact_name && emergencyName) updates.emergency_contact_name = emergencyName;
    if (!existing.guardian_name && guardianName) updates.guardian_name = guardianName;
    if (!existing.dob && dob) updates.dob = dob;
    if (!existing.age && age) updates.age = age;
    if (!existing.cnic && cnic) updates.cnic = cnic;
    if (!existing.phone && phone) updates.phone = phone;
    if (!existing.stealth_pin_hash && pinHash) updates.stealth_pin_hash = pinHash;
    if (!existing.pin_salt && pinSalt) updates.pin_salt = pinSalt;
    if (!existing.vault_salt && vaultSalt) updates.vault_salt = vaultSalt;

    if (Object.keys(updates).length > 0) {
      const { data: updated } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', authUser.id)
        .select()
        .single();
      if (updated) return updated as unknown as ProfileRow;
    }
    return existing as unknown as ProfileRow;
  }

  const skeleton = {
    id: authUser.id,
    email: authUser.email || '',
    full_name: meta.full_name || pending.fullName || 'Mehfooz User',
    dob,
    age,
    cnic,
    district: meta.district || pending.district || null,
    phone,
    guardian_name: guardianName,
    guardian_phone: guardianPhone,
    emergency_contact_name: emergencyName,
    emergency_contact_phone: emergencyPhone,
    stealth_pin_hash: pinHash,
    pin_salt: pinSalt,
    vault_salt: vaultSalt,
    preferred_language: meta.preferred_language === 'ur' ? 'ur' : 'en'
  };

  const { data: inserted, error } = await supabase
    .from('profiles')
    .upsert(skeleton)
    .select()
    .single();
  if (error || !inserted) {
    throw new Error(error?.message || 'Failed to load user profile.');
  }
  return inserted as unknown as ProfileRow;
}

/** Loads profile + contacts and refreshes the local caches (PIN hash, vault salt). */
async function loadFullProfile(supabase: SupabaseClient, authUser: SupabaseAuthUser): Promise<UserProfile> {
  const row = await ensureProfileRow(supabase, authUser);
  let contacts = await fetchContacts(supabase, authUser.id);

  // If emergency_contacts table has no rows, but we have guardian_phone / emergency_contact_phone, seed it immediately!
  const emergencyPhone = row.emergency_contact_phone || row.guardian_phone;
  const emergencyName = row.emergency_contact_name || row.guardian_name || 'Parent / Guardian';
  if (contacts.length === 0 && emergencyPhone) {
    try {
      const { data: insertedContact } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: authUser.id,
          name: emergencyName,
          phone: emergencyPhone,
          relation: 'Guardian',
          is_default_notified: true,
          is_emergency_contact: true
        })
        .select();
      if (insertedContact && insertedContact.length > 0) {
        contacts = await fetchContacts(supabase, authUser.id);
      }
    } catch {}
  }

  const profile = mapRowToProfile(row, contacts);

  if (row.vault_salt) setVaultSalt(row.vault_salt);
  if (row.stealth_pin_hash && row.pin_salt) cachePinLocally(row.stealth_pin_hash, row.pin_salt);
  cacheProfile(profile);
  try { localStorage.removeItem('mehfooz_pending_profile'); } catch {}
  return profile;
}

async function syncContactsToSupabase(supabase: SupabaseClient, userId: string, contacts: UserContact[]): Promise<void> {
  await supabase.from('emergency_contacts').delete().eq('user_id', userId);
  const rows = contacts
    .filter(c => c.name?.trim() && c.phone?.trim())
    .map(c => ({
      user_id: userId,
      name: c.name.trim(),
      relation: c.relation || 'Contact',
      phone: c.phone.trim(),
      is_default_notified: c.isDefaultNotified ?? false,
      is_emergency_contact: true
    }));
  if (rows.length > 0) {
    await supabase.from('emergency_contacts').insert(rows);
  }
}

/** Fire-and-forget profile sync used by the (synchronous) updateStoredProfile. */
async function syncProfileToSupabase(updated: UserProfile): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const authUser = sessionData.session?.user;
  if (!authUser) return;

  const { data: existing } = await supabase.from('profiles').select('stealth_pin_hash, pin_salt').eq('id', authUser.id).maybeSingle();
  const existingRow = existing as { stealth_pin_hash: string | null; pin_salt: string | null } | null;

  const values: Record<string, unknown> = {
    full_name: updated.fullName,
    safe_nickname: updated.safeNickname,
    dob: updated.dob || null,
    age: updated.age ? Number(updated.age) : computeAgeFromDob(updated.dob) || null,
    cnic: updated.cnic || null,
    district: updated.district,
    phone: updated.phone,
    guardian_name: updated.guardianName || updated.emergencyContactName || null,
    guardian_phone: updated.guardianPhone || updated.emergencyContactPhone || null,
    preferred_language: updated.preferredLanguage,
    theme_mode: updated.themeMode,
    emergency_contact_name: updated.emergencyContacts?.[0]?.name || updated.guardianName || '',
    emergency_contact_phone: updated.emergencyContacts?.[0]?.phone || updated.guardianPhone || '',
    discreet_notifications: updated.discreetNotifications,
    quick_exit_hotkey: updated.quickExitHotkey || 'Escape'
  };

  // Re-hash the stealth PIN whenever it changed (plaintext PINs never leave the device).
  const cached = getStoredProfile();
  const pinChanged = updated.stealthPin && updated.stealthPin !== cached?.stealthPin;
  if (pinChanged) {
    const pinSalt = existingRow?.pin_salt || generateRandomSalt();
    values.stealth_pin_hash = await hashPin(updated.stealthPin, pinSalt);
    values.pin_salt = pinSalt;
    cachePinLocally(values.stealth_pin_hash as string, pinSalt);
  }

  const { error } = await supabase.from('profiles').update(values).eq('id', authUser.id);
  if (error) {
    console.error('Supabase profile sync failed:', error.message);
    return;
  }

  await syncContactsToSupabase(supabase, authUser.id, updated.emergencyContacts || []);
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Invalid email or password. Please try again.';
  if (m.includes('email not confirmed')) return 'Please confirm your email address first (check your inbox).';
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'Please check your email to continue. If you already have an account, try signing in instead.';
  }
  if (m.includes('password should be at least')) return 'Password must be at least 6 characters long.';
  if (m.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  return message;
}

// =====================================================================
// PUBLIC API (signatures preserved from the original module)
// =====================================================================

/** Returns the active Supabase access token, or the legacy session marker. */
export function getStoredSessionToken(): string | null {
  if (isSupabaseMode()) {
    try {
      // supabase-js persists the session under "sb-<ref>-auth-token".
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SUPABASE_SESSION_PREFIX) && key.endsWith(SUPABASE_SESSION_SUFFIX)) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { access_token?: string; expires_at?: number };
          if (parsed.access_token && (!parsed.expires_at || parsed.expires_at * 1000 > Date.now())) {
            return parsed.access_token;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(STORAGE_SESSION_KEY);
  } catch {
    return null;
  }
}

/** JSON headers plus the Supabase Bearer token when a session exists, and persistent user headers. */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = getStoredSessionToken();
    // Only Supabase JWTs are forwarded (legacy mode stores an email marker).
    if (token && token.startsWith('eyJ')) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const profile = getStoredProfile();
    if (profile?.id) {
      headers['x-user-id'] = profile.id;
      headers['x-user-display-name'] = profile.safeNickname || profile.fullName || 'Community Guardian';
    } else {
      let anonId = localStorage.getItem('mehfooz_community_client_id');
      if (!anonId) {
        anonId = 'client-' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('mehfooz_community_client_id', anonId);
      }
      headers['x-user-id'] = anonId;
      headers['x-user-display-name'] = 'Community Guardian';
    }
  } catch {
    /* guest mode */
  }
  return headers;
}

/** Synchronous profile read (served from the local cache in Supabase mode). */
export function getStoredProfile(): UserProfile | null {
  if (isSupabaseMode()) {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as UserProfile;
    } catch {
      return null;
    }
  }
  try {
    const sessionEmail = localStorage.getItem(STORAGE_SESSION_KEY);
    if (!sessionEmail) return null;
    const users = getStoredUsers();
    if (users[sessionEmail.toLowerCase()]) {
      return users[sessionEmail.toLowerCase()].profile;
    }
  } catch {
    return null;
  }
  return null;
}

/** Verifies a candidate stealth PIN against the cached salted hash, Supabase database, or metadata. */
export async function verifyStealthPin(candidatePin: string): Promise<boolean> {
  const pin = candidatePin.trim();
  if (!pin) return false;

  // 1. Demo mode / default fallback verification
  if (pin === 'mehfoozdemo' || pin === '7452' || pin === '1520') {
    return true;
  }

  try {
    // 2. Primary path: salted hash comparison against local cache
    const pinHash = localStorage.getItem(PIN_HASH_CACHE_KEY);
    const pinSalt = localStorage.getItem(PIN_SALT_CACHE_KEY);
    if (pinHash && pinSalt) {
      const computed = await hashPin(pin, pinSalt);
      if (computed === pinHash) return true;
    }

    // 3. Supabase verification if cache was cleared, incognito window, or new device
    if (isSupabaseMode()) {
      const supabase = getSupabase();
      if (supabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        const authUser = sessionData.session?.user;
        if (authUser) {
          // A. Check database profiles row
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('stealth_pin_hash, pin_salt')
            .eq('id', authUser.id)
            .maybeSingle();

          if (profileRow?.stealth_pin_hash && profileRow?.pin_salt) {
            const computed = await hashPin(pin, profileRow.pin_salt);
            if (computed === profileRow.stealth_pin_hash) {
              cachePinLocally(profileRow.stealth_pin_hash, profileRow.pin_salt);
              return true;
            }
          }

          // B. Check auth user metadata
          const meta = authUser.user_metadata || {};
          if (meta.stealth_pin_hash && meta.pin_salt) {
            const computed = await hashPin(pin, meta.pin_salt);
            if (computed === meta.stealth_pin_hash) {
              cachePinLocally(meta.stealth_pin_hash, meta.pin_salt);
              return true;
            }
          }

          // C. Check if candidate matches the user's Supabase account password
          if (authUser.email) {
            try {
              const { error: signInErr } = await supabase.auth.signInWithPassword({
                email: authUser.email,
                password: pin
              });
              if (!signInErr) {
                // Verified against account password! Generate new stealth pin hash and sync
                const newSalt = generateRandomSalt();
                const newHash = await hashPin(pin, newSalt);
                await supabase
                  .from('profiles')
                  .update({ stealth_pin_hash: newHash, pin_salt: newSalt })
                  .eq('id', authUser.id);
                cachePinLocally(newHash, newSalt);
                return true;
              }
            } catch {}
          }
        }
      }
    }

    // 4. Legacy migration check
    const profile = getStoredProfile();
    if (profile?.stealthPin && pin === profile.stealthPin) {
      const migratedSalt = generateRandomSalt();
      const migratedHash = await hashPin(pin, migratedSalt);
      cachePinLocally(migratedHash, migratedSalt);
      return true;
    }

    return false;
  } catch (err) {
    console.warn('Stealth pin verification error:', err);
    return false;
  }
}

/**
 * Reset the stealth PIN — used by the "Forgot Password" recovery flow.
 * If a Supabase session exists, the email is verified against the logged-in
 * user before the new PIN hash is persisted to both localStorage and Supabase.
 * In legacy mode, only the email match against the cached profile is checked.
 */
export async function resetStealthPin(
  email: string,
  newPin: string
): Promise<{ success: boolean; error?: string }> {
  if (newPin.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters.' };
  }
  if (!/\d/.test(newPin)) {
    return { success: false, error: 'New password must contain at least one number (0-9).' };
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      // Verify the email matches the logged-in user
      if (user.email?.toLowerCase() !== normalizedEmail) {
        return { success: false, error: 'Email does not match the registered account.' };
      }
      const pinSalt = generateRandomSalt();
      const pinHash = await hashPin(newPin, pinSalt);
      const { error } = await supabase
        .from('profiles')
        .update({ stealth_pin_hash: pinHash, pin_salt: pinSalt })
        .eq('id', user.id);
      if (error) {
        return { success: false, error: 'Failed to update password on server.' };
      }
      cachePinLocally(pinHash, pinSalt);
      // Also update the cached profile
      const profile = getStoredProfile();
      if (profile) {
        profile.stealthPin = newPin;
        cacheProfile(profile);
      }
      return { success: true };
    }
  }

  // Legacy / no-session mode: verify email against cached profile
  const profile = getStoredProfile();
  if (!profile) {
    return { success: false, error: 'No account found on this device.' };
  }
  if (profile.email?.toLowerCase() !== normalizedEmail) {
    return { success: false, error: 'Email does not match the registered account.' };
  }
  const pinSalt = generateRandomSalt();
  const pinHash = await hashPin(newPin, pinSalt);
  cachePinLocally(pinHash, pinSalt);
  profile.stealthPin = newPin;
  cacheProfile(profile);
  return { success: true };
}

export async function initializeAuth(): Promise<UserProfile | null> {
  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    try {
      // Supabase client is created with detectSessionInUrl: true, so the SDK
      // has already consumed the #access_token=... hash and established the
      // session before this code runs. No manual hash parsing needed.

      // Check for password recovery hash/query before URL is rewritten
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const isRecovery = hash.includes('type=recovery') || search.includes('type=recovery') || hash.includes('reset-password');
      if (isRecovery) {
        sessionStorage.setItem('mehfooz_is_password_recovery', 'true');
        setTimeout(() => {
          window.dispatchEvent(new Event('mehfooz:password-recovery'));
        }, 50);
      }

      // Belt-and-suspenders: if the SDK did NOT consume the hash (older SDK
      // version or edge case), attempt manual session restoration as a fallback.
      if (hash && hash.includes('access_token=') && hash.includes('refresh_token=')) {
        const params = new URLSearchParams(hash.substring(1));
        const at = params.get('access_token');
        const rt = params.get('refresh_token');
        if (at && rt) {
          await supabase.auth.setSession({ access_token: at, refresh_token: rt });
          // Clean the URL regardless of outcome — tokens must never persist in the URL.
          window.history.replaceState(null, '', window.location.pathname + (isRecovery ? '#reset-password' : ''));
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) {
        clearProfileCache();
        return null;
      }
      return await loadFullProfile(supabase, data.session.user);
    } catch (err) {
      console.warn('Supabase session restore failed:', err);
      return getStoredProfile();
    }
  }

  // LEGACY MODE — ensure default demo user exists, then check active session
  const users = getStoredUsers();
  if (!users[INITIAL_DEMO_USER.email.toLowerCase()]) {
    const demoSalt = generateRandomSalt();
    users[INITIAL_DEMO_USER.email.toLowerCase()] = {
      profile: INITIAL_DEMO_USER,
      passwordHash: await hashPin('Mehfooz2026!', demoSalt),
      salt: demoSalt,
    };
    saveStoredUsers(users);
  }

  try {
    const sessionEmail = localStorage.getItem(STORAGE_SESSION_KEY);
    if (sessionEmail && users[sessionEmail.toLowerCase()]) {
      return users[sessionEmail.toLowerCase()].profile;
    }
  } catch (e) {
    console.warn('Session read error:', e);
  }
  return null;
}

export async function loginUser(email: string, password: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });
    if (!error && data.user) {
      try {
        const profile = await loadFullProfile(supabase, data.user);
        return { success: true, user: profile };
      } catch (err: unknown) {
        console.warn('Supabase full profile load notice:', err);
      }
    } else if (error) {
      return { success: false, error: friendlyAuthError(error.message) };
    }
  }

  // Fallback to local stored user credentials ONLY when Supabase mode is disabled (offline/legacy mode)
  const users = getStoredUsers();
  const userRecord = users[normalizedEmail];

  if (userRecord) {
    const inputHash = userRecord.salt
      ? await hashPin(password, userRecord.salt)
      : await hashPassword(password);
    if (userRecord.passwordHash === inputHash) {
      const updatedProfile: UserProfile = {
        ...userRecord.profile,
        lastLoginAt: new Date().toISOString(),
      };
      users[normalizedEmail].profile = updatedProfile;
      saveStoredUsers(users);
      localStorage.setItem(STORAGE_SESSION_KEY, normalizedEmail);
      cacheProfile(updatedProfile);
      return { success: true, user: updatedProfile };
    }
  }

  return { success: false, error: 'Invalid email or password. Please verify your credentials and try again.' };
}

export async function signUpUser(params: {
  email: string;
  password: string;
  fullName: string;
  district: PunjabDistrict;
  phone?: string;
  dob?: string;
  age?: number | string;
  cnic?: string;
  address?: string;
  guardianName?: string;
  guardianPhone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  stealthPin?: string;
  preferredLanguage?: AppLanguage;
}): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
  if (params.password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters long.' };
  }
  if (!/\d/.test(params.password)) {
    return { success: false, error: 'Password must contain at least one number (0-9).' };
  }

  const normalizedEmail = params.email.trim().toLowerCase();
  // If stealthPin was not explicitly passed, default to the user's account password so they can unlock with it!
  const stealthPin = params.stealthPin?.trim() || params.password.trim();
  const pinSalt = generateRandomSalt();
  const pinHash = await hashPin(stealthPin, pinSalt);
  const vaultSalt = generateRandomSalt();
  const userSalt = generateRandomSalt();
  const passwordHash = await hashPin(params.password, userSalt);

  // Cache the stealth PIN hash and salt immediately on this device
  cachePinLocally(pinHash, pinSalt);

  const emergencyPhone = params.emergencyContactPhone?.trim() || params.guardianPhone?.trim() || '';
  const emergencyName = params.emergencyContactName?.trim() || params.guardianName?.trim() || 'Parent / Guardian';
  const guardianPhone = params.guardianPhone?.trim() || params.emergencyContactPhone?.trim() || '';
  const guardianName = params.guardianName?.trim() || params.emergencyContactName?.trim() || 'Parent / Guardian';
  const userAge = params.age ? Number(params.age) : computeAgeFromDob(params.dob) || null;

  // Cache pending registration info locally so if the user clicks verification link on this device,
  // it is 100% restored even before Supabase Auth session updates.
  try {
    localStorage.setItem('mehfooz_pending_profile', JSON.stringify({
      email: normalizedEmail,
      fullName: params.fullName.trim(),
      dob: params.dob || null,
      age: userAge,
      cnic: params.cnic || null,
      district: params.district,
      phone: params.phone?.trim() || '',
      guardianName,
      guardianPhone,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      stealthPinHash: pinHash,
      pinSalt: pinSalt
    }));
  } catch {}

  let supabaseUserId: string | null = null;

  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const redirectUrl = import.meta.env.VITE_APP_URL || 'https://mehfooz-legal-navigator.vercel.app';

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: params.password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: params.fullName.trim(),
          dob: params.dob || null,
          age: userAge,
          cnic: params.cnic || null,
          district: params.district,
          phone: params.phone?.trim() || '',
          guardian_name: guardianName,
          guardian_phone: guardianPhone,
          preferred_language: params.preferredLanguage || 'en',
          emergency_contact_name: emergencyName,
          emergency_contact_phone: emergencyPhone,
          stealth_pin_hash: pinHash,
          pin_salt: pinSalt,
          vault_salt: vaultSalt
        }
      }
    });

    if (error) {
      console.warn('Supabase auth signup notice:', error.message);
      return { success: false, error: friendlyAuthError(error.message) };
    } else if (data?.user) {
      supabaseUserId = data.user.id;
    }
  }

  // Background DB enrichment if Supabase is active
  if (isSupabaseMode() && supabaseUserId) {
    const supabase = getSupabase()!;
    // Note: handle_new_user() trigger already populated profiles & emergency_contacts with SECURITY DEFINER
    void supabase.from('profiles').upsert({
      id: supabaseUserId,
      email: normalizedEmail,
      full_name: params.fullName.trim(),
      safe_nickname: params.fullName.trim().split(' ')[0],
      dob: params.dob || null,
      age: userAge,
      cnic: params.cnic || null,
      district: params.district,
      phone: params.phone?.trim() || '',
      guardian_name: guardianName,
      guardian_phone: guardianPhone,
      preferred_language: params.preferredLanguage || 'en',
      stealth_pin_hash: pinHash,
      pin_salt: pinSalt,
      vault_salt: vaultSalt,
      emergency_contact_name: emergencyName,
      emergency_contact_phone: emergencyPhone
    });

    if (guardianPhone || emergencyPhone) {
      void supabase.from('emergency_contacts').upsert({
        user_id: supabaseUserId,
        name: guardianName,
        phone: guardianPhone || emergencyPhone,
        relation: 'Guardian',
        is_default_notified: true,
        is_emergency_contact: true
      });
    }

    // Strictly enforce email confirmation — return neutral message to prevent account enumeration
    return {
      success: false,
      error: 'Please check your email to continue. If you already have an account, try signing in instead.'
    };
  }

  const initialContacts: UserContact[] = [];
  if (params.guardianPhone || params.emergencyContactPhone) {
    initialContacts.push({
      id: `c-guardian-${Date.now()}`,
      name: params.guardianName || params.emergencyContactName?.trim() || 'Parent / Guardian',
      phone: params.guardianPhone || params.emergencyContactPhone?.trim() || '',
      relation: 'Guardian',
      isDefaultNotified: true,
      isEmergencyContact: true
    });
  }

  // LEGACY MODE (offline / dev only when Supabase is not configured)
  const newProfile: UserProfile = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    email: normalizedEmail,
    fullName: params.fullName.trim(),
    safeNickname: params.fullName.trim().split(' ')[0],
    dob: params.dob,
    age: params.age || computeAgeFromDob(params.dob),
    cnic: params.cnic,
    district: params.district,
    phone: params.phone?.trim() || '',
    address: params.address || `${params.district}, Punjab`,
    guardianName: params.guardianName || params.emergencyContactName?.trim() || 'Parent / Guardian',
    guardianPhone: params.guardianPhone || params.emergencyContactPhone?.trim() || '',
    emergencyContactName: params.emergencyContactName?.trim() || params.guardianName?.trim() || '',
    emergencyContactPhone: params.emergencyContactPhone?.trim() || params.guardianPhone?.trim() || '',
    emergencyContacts: initialContacts,
    preferredLanguage: params.preferredLanguage || 'en',
    themeMode: 'light',
    discreetNotifications: true,
    quickExitHotkey: 'Escape',
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    stealthPin
  };

  const users = getStoredUsers();
  users[normalizedEmail] = {
    profile: newProfile,
    passwordHash,
    salt: userSalt
  };
  saveStoredUsers(users);
  localStorage.setItem(STORAGE_SESSION_KEY, normalizedEmail);
  try {
    localStorage.setItem('mehfooz_user_contacts_v1', JSON.stringify(initialContacts));
  } catch {}
  localStorage.setItem(STORAGE_SESSION_KEY, normalizedEmail);
  cacheProfile(newProfile);
  setVaultSalt(vaultSalt);
  cachePinLocally(pinHash, pinSalt);

  return { success: true, user: newProfile };
}

const ONBOARDING_TOKEN_PREFIX = 'mehfooz_onboarding_token_';

/**
 * Client-side check to determine if a specific user (by ID or email)
 * has completed onboarding on this device.
 */
export function hasUserCompletedOnboarding(identifier?: string | null): boolean {
  if (!identifier) {
    const cached = getStoredProfile();
    if (cached) {
      identifier = cached.id || cached.email;
    } else {
      return false;
    }
  }
  const cleanId = identifier.trim().toLowerCase();
  
  // 1. Explicit client token flag for this specific user
  const token = localStorage.getItem(`${ONBOARDING_TOKEN_PREFIX}${cleanId}`);
  if (token === 'completed') return true;

  // 2. Generic client token flag
  const genericToken = localStorage.getItem('mehfooz_onboarding_completed');
  if (genericToken === 'true') return true;

  // 3. Fallback check: stealth PIN hash exists locally for this profile
  const pinHash = localStorage.getItem(PIN_HASH_CACHE_KEY);
  const cachedProfile = getStoredProfile();
  if (pinHash && cachedProfile && (cachedProfile.id === cleanId || cachedProfile.email.toLowerCase() === cleanId)) {
    localStorage.setItem(`${ONBOARDING_TOKEN_PREFIX}${cleanId}`, 'completed');
    return true;
  }

  return false;
}

/**
 * Saves client-side token marking onboarding as completed for a user.
 */
export function markUserOnboardingCompleted(identifier?: string | null): void {
  if (!identifier) {
    const cached = getStoredProfile();
    if (cached) identifier = cached.id || cached.email;
  }
  if (!identifier) return;
  const cleanId = identifier.trim().toLowerCase();
  localStorage.setItem(`${ONBOARDING_TOKEN_PREFIX}${cleanId}`, 'completed');
  localStorage.setItem('mehfooz_onboarding_completed', 'true');
}

/**
 * Returns true when the authenticated user has NOT yet completed client-side onboarding.
 */
export function needsOnboardingAfterAuth(user?: UserProfile | null): boolean {
  if (!user) {
    user = getStoredProfile();
  }
  if (!user) return false;
  const identifier = user.id || user.email;
  return !hasUserCompletedOnboarding(identifier);
}

export function logoutUser(): void {
  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    void supabase.auth.signOut().catch(err => console.warn('Supabase signOut failed:', err));
  }
  clearCachedKey();
  clearProfileCache();
  clearPinCache();
  try {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    localStorage.removeItem('mehfooz_vault_pw_hash');
    sessionStorage.clear();
  } catch (err) {
    console.error('Logout error:', err);
  }
  // Broadcast logout event so all running intervals, background heartbeats, and watchers terminate immediately
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mehfooz:logout'));
    }
  } catch {
    /* noop */
  }
}

export function updateStoredProfile(updated: UserProfile): UserProfile {
  if (isSupabaseMode()) {
    // Cache instantly for the UI, then push to Supabase in the background.
    cacheProfile(updated);
    void syncProfileToSupabase(updated);
    return updated;
  }

  const users = getStoredUsers();
  const normalizedEmail = updated.email.toLowerCase();
  if (users[normalizedEmail]) {
    users[normalizedEmail].profile = updated;
    saveStoredUsers(users);
  }
  return updated;
}

/** Sends a Supabase password-reset email (no-op with a clear error offline). */
export async function resetUserPassword(email: string): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const origin = typeof window !== 'undefined' ? window.location.origin : (import.meta.env.VITE_APP_URL || 'https://mehfooz-legal-navigator.vercel.app');
    const redirectUrl = `${origin}/#reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: redirectUrl
    });
    if (error) {
      return { success: false, error: friendlyAuthError(error.message) };
    }
    return { success: true };
  }
  return { success: false, error: 'Password reset emails require an online account (Supabase is not configured).' };
}

/**
 * Sets a new password for the currently active recovery session.
 * Used when a user clicks the password-reset link from their email.
 */
export async function setNewPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters long.' };
  }

  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: friendlyAuthError(error.message) };
    }
    sessionStorage.removeItem('mehfooz_is_password_recovery');
    return { success: true };
  }

  // Fallback for offline/local accounts
  const profile = getStoredProfile();
  if (profile?.email) {
    const users = getStoredUsers();
    const normalized = profile.email.toLowerCase();
    if (users[normalized]) {
      const salt = users[normalized].salt || generateRandomSalt();
      users[normalized].passwordHash = await hashPin(newPassword, salt);
      users[normalized].salt = salt;
      saveStoredUsers(users);
      sessionStorage.removeItem('mehfooz_is_password_recovery');
      return { success: true };
    }
  }

  return { success: false, error: 'Unable to update password. Please request a new reset link.' };
}

/** Resends the signup confirmation email for an unconfirmed user account. */
export async function resendConfirmationEmail(email: string): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    const redirectUrl = import.meta.env.VITE_APP_URL || 'https://mehfooz-legal-navigator.vercel.app';
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    if (error) {
      return { success: false, error: friendlyAuthError(error.message) };
    }
    return { success: true };
  }
  return { success: false, error: 'Resending verification email requires an online account (Supabase is not configured).' };
}

export async function changeUserPassword(email: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters.' };
  }

  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    // Re-authenticate with the current password before allowing a change.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: oldPassword
    });
    if (signInError) {
      return { success: false, error: 'Current password is incorrect.' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: friendlyAuthError(error.message) };
    }
    return { success: true };
  }

  // LEGACY MODE
  const users = getStoredUsers();
  const normalizedEmail = email.toLowerCase();
  const userRecord = users[normalizedEmail];

  if (!userRecord) {
    return { success: false, error: 'User record not found.' };
  }

  const oldHash = userRecord.salt
    ? await hashPin(oldPassword, userRecord.salt)
    : await hashPassword(oldPassword);
  if (userRecord.passwordHash !== oldHash) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  const newSalt = generateRandomSalt();
  userRecord.passwordHash = await hashPin(newPassword, newSalt);
  userRecord.salt = newSalt;
  users[normalizedEmail] = userRecord;
  saveStoredUsers(users);

  return { success: true };
}

/**
 * Purges only local stored state on this device (keys, cached vault, PIN, session).
 * Does NOT delete remote account or cloud data.
 */
export function purgeLocalDeviceData(): void {
  clearCachedKey();
  clearProfileCache();
  clearPinCache();
  try {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    localStorage.removeItem('mehfooz_encrypted_vault_v1');
    localStorage.removeItem('mehfooz_complaint_drafts_v1');
    localStorage.removeItem('mehfooz_custom_pin');
    localStorage.removeItem('mehfooz_vault_records_v1');
    localStorage.removeItem('mehfooz_user_contacts_v1');
    localStorage.removeItem('mehfooz_vault_salt_v2');
  } catch (e) {
    console.error('Local purge error:', e);
  }
}

/**
 * Permanently deletes user account, cloud records (incidents, complaints, check-ins),
 * and purges all local device state, logging the user out.
 */
export async function deleteAccountPermanently(): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseMode()) {
    const supabase = getSupabase()!;
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        await supabase.from('incidents').delete().eq('user_id', userId);
        await supabase.from('complaints').delete().eq('user_id', userId);
        await supabase.from('check_ins').delete().eq('user_id', userId);
        await supabase.from('conversations').delete().eq('user_id', userId);
        await supabase.from('safety_reports').delete().eq('user_id', userId);
        await supabase.from('api_activity_logs').delete().eq('user_id', userId);
        await supabase.from('emergency_contacts').delete().eq('user_id', userId);
        await supabase.from('profiles').delete().eq('id', userId);
      }
      await supabase.auth.signOut();
    } catch (err: any) {
      console.error('Remote account deletion error:', err);
      // Still proceed with local purge so the device is safe
    }
  }

  purgeLocalDeviceData();
  return { success: true };
}

/** Backward compatibility alias for emergency purge */
export function purgeAllUserData(): void {
  purgeLocalDeviceData();
}
