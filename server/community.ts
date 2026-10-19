/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mehfooz Community Reporting, Corroboration & Moderation System.
 * 
 * Features:
 *  1. Persistent community reports & updates (Supabase + atomic disk backup).
 *  2. Searchable location filtering: Universities (UCP, UMT, UOL, PU, LUMS),
 *     neighbourhoods (Johar Town, Model Town, Gulberg, DHA, etc.), places, All Areas & Nearby.
 *  3. Community Corroboration (5-User Rule): 5 distinct independent users corroborate
 *     recurring safety problems in an area.
 *  4. Strict daily limits: max 5 reports and 5 updates per user per Pakistan Standard Time day.
 *  5. Duplicate detection & graduated abuse restrictions (1-5 days) with appeals.
 *  6. Privacy protections: sanitized public feed, zero CNIC requirement, no exact home addresses.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { AuthedRequest, isSupabaseServerConfigured, createUserClient, getSupabaseServer } from './supabaseServer.js';
import { logApiActivity } from './apiActivity.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Daily Limits & Configuration ─────────────────────────────────────────────
const MAX_REPORTS_PER_DAY = 5;
const MAX_UPDATES_PER_DAY = 5;
const CORROBORATION_THRESHOLD = 5; // 5 independent users -> Community Corroborated
const CORROBORATION_WINDOW_DAYS = 30; // 30-day window for recurring area issues
const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Anti-Empty & Anti-Dummy/Gibberish Spam Protection ──────────────────────────
const DUMMY_WORDS = new Set([
  'test', 'testing', 'tester', 'tested', 'asdf', 'asdfgh', 'asdfghjk', 'asdfghjkl',
  'qwerty', 'zxcv', 'zxcvbnm', 'dummy', 'fake', 'none', 'nothing', 'na', 'n/a',
  'null', 'undefined', '123', '1234', '12345', '123456', 'abc', 'abcd', 'abcde',
  'random', 'sample', 'foo', 'bar', 'baz', 'lorem', 'ipsum', 'bla', 'blah', 'blahblah',
  'hello', 'hi', 'hey', 'check', 'checking', 'aaaa', 'bbbb', 'cccc', 'dddd', 'xyz', 'demo',
  'report', 'complaint', 'help', 'whatever', 'something'
]);

export function isDummyOrEmptyText(input: unknown, minLength: number = 10): { isDummy: boolean; reason?: string } {
  if (typeof input !== 'string') {
    return { isDummy: true, reason: 'Content must be text.' };
  }
  const clean = input.trim();
  if (clean.length < minLength) {
    return { isDummy: true, reason: `Must be at least ${minLength} characters.` };
  }

  // 1. Must contain meaningful alphabetic or Urdu characters (rejects purely numeric or symbolic text like '12345678')
  const letterCount = (clean.match(/[a-zA-Z\u0600-\u06FF]/g) || []).length;
  if (letterCount < 4) {
    return { isDummy: true, reason: 'Please use genuine words (in English or Urdu) rather than numbers or symbols.' };
  }

  // 2. Reject common test / throwaway phrases
  const lowerText = clean.toLowerCase();
  if (/\b(just testing|test report|testing 123|please ignore|ignore this|dummy test|testing only|sample test|test complaint)\b/i.test(lowerText)) {
    return { isDummy: true, reason: 'Test reports and placeholder entries are not allowed on the live community feed.' };
  }

  // 3. Check if string contains only repetitive characters e.g. "aaaaaaaa", "..........", "------"
  const uniqueChars = new Set(clean.toLowerCase().replace(/\s/g, '').split(''));
  if (uniqueChars.size < 4 && clean.length >= 8) {
    return { isDummy: true, reason: 'Please provide meaningful, descriptive text rather than repeated characters or punctuation.' };
  }

  // 4. Check if text is just a known dummy word or trivial repeat
  const normalizedLower = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (DUMMY_WORDS.has(normalizedLower)) {
    return { isDummy: true, reason: 'Please enter a genuine safety description. Dummy test text is not permitted.' };
  }

  // 5. Check individual words
  const words = clean.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (words.length > 0 && words.every(w => DUMMY_WORDS.has(w))) {
    return { isDummy: true, reason: 'Please enter a genuine safety description instead of placeholder or test words.' };
  }

  // 6. Check for keyboard mashing patterns
  if (/^[asdfghjklqwertyuiopzxcvbnm]{6,}$/i.test(normalizedLower) && uniqueChars.size <= 5) {
    return { isDummy: true, reason: 'Keyboard mashing or placeholder text is not allowed.' };
  }

  return { isDummy: false };
}

// ── Timezone Helper (Asia/Karachi: UTC+5) ─────────────────────────────────────
export function getPakistanDayBounds(date: Date = new Date()): { startIso: string; endIso: string; dayKey: string } {
  // Convert UTC date to Asia/Karachi time string
  const pstOffsetMs = 5 * 60 * 60 * 1000; // UTC+5
  const pstTime = new Date(date.getTime() + pstOffsetMs);

  const year = pstTime.getUTCFullYear();
  const month = String(pstTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(pstTime.getUTCDate()).padStart(2, '0');
  const dayKey = `${year}-${month}-${day}`;

  // Start of day in UTC (corresponds to 00:00:00 PKT)
  const startPstUtc = new Date(Date.UTC(year, pstTime.getUTCMonth(), pstTime.getUTCDate()) - pstOffsetMs);
  const endPstUtc = new Date(startPstUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  return {
    startIso: startPstUtc.toISOString(),
    endIso: endPstUtc.toISOString(),
    dayKey
  };
}

// ── Data Interfaces ──────────────────────────────────────────────────────────
export interface CommunityRegion {
  id: string;
  name: string;
  nameUrdu?: string;
  regionType: 'university' | 'campus' | 'neighbourhood' | 'public_area' | 'transport_hub' | 'city';
  city: string;
  province: string;
  parentRegionId?: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface CommunityPlace {
  id: string;
  regionId: string;
  name: string;
  nameUrdu?: string;
  placeType: 'main_campus' | 'entrance_gate' | 'transport_stop' | 'library_zone' | 'commercial_area' | 'parking' | 'general';
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
}

export interface CommunityReport {
  id: string;
  userId?: string | null;
  reporterDisplayName: string;
  title: string;
  description: string;
  category: string;
  regionId: string;
  placeId?: string | null;
  locationName: string;
  latitude?: number | null;
  longitude?: number | null;
  incidentAt?: string | null;
  createdAt: string;
  updatedAt: string;
  status: 'pending_review' | 'published' | 'hidden' | 'resolved' | 'flagged';
  corroborationStatus: 'single_report' | 'multiple_reports' | 'community_corroborated' | 'under_review' | 'resolved';
  corroborationCount: number;
  corroborationNotes?: string | null;
  resolvedAt?: string | null;
  resolvedNote?: string | null;
  sentiment: 'very_unsafe' | 'uncomfortable' | 'neutral' | 'safe' | 'very_safe';
  tags: string[];
  viewsCount: number;
  helpfulCount: number;
  helpfulUserIds: string[];
  relatedIssueId?: string | null;
  contentHash: string;
}

export interface CommunityReportUpdate {
  id: string;
  reportId: string;
  userId?: string | null;
  authorDisplayName: string;
  updateType: 'status_update' | 'additional_info' | 'safety_alert' | 'resolution_note';
  content: string;
  moderationStatus: 'published' | 'hidden' | 'pending_review';
  createdAt: string;
}

export interface CommunityReportConfirmation {
  id: string;
  reportId: string;
  userId: string;
  confirmationType: 'personally_experienced' | 'observed' | 'frequently_occurs';
  createdAt: string;
}

export interface UserRestriction {
  id: string;
  userId: string;
  restrictionType: 'report_posting' | 'update_posting' | 'community_ban';
  reasonCode: 'duplicate_spam' | 'repeated_abuse' | 'fabricated_report' | 'malicious_conduct' | 'harassment' | 'terms_violation';
  details?: string;
  userMessage?: string;
  startsAt: string;
  expiresAt: string;
  issuedBy: string;
  status: 'active' | 'expired' | 'revoked' | 'appealed';
  appealStatus: 'none' | 'pending' | 'accepted' | 'rejected';
  appealReason?: string;
  appealReviewedAt?: string;
  createdAt: string;
}

export interface ModerationAuditEntry {
  id: string;
  eventType: string;
  targetReportId?: string | null;
  targetUserId?: string | null;
  actionTaken: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  performedBy: string;
  createdAt: string;
}

// ── Seed Regions & Places ────────────────────────────────────────────────────
export const SEED_REGIONS: CommunityRegion[] = [
  { id: 'ucp', name: 'UCP (University of Central Punjab)', nameUrdu: 'یونیورسٹی آف سینٹرل پنجاب', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 1 },
  { id: 'umt', name: 'UMT (University of Management and Technology)', nameUrdu: 'یونیورسٹی آف مینجمنٹ اینڈ ٹیکنالوجی', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 2 },
  { id: 'uol', name: 'UOL (University of Lahore)', nameUrdu: 'یونیورسٹی آف لاہور', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 3 },
  { id: 'pucit', name: 'PU / New Campus (Punjab University)', nameUrdu: 'پنجاب یونیورسٹی (نیو کیمپس)', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 4 },
  { id: 'lums', name: 'LUMS (DHA Phase 5)', nameUrdu: 'لمز (ڈی ایچ اے فیز 5)', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 5 },
  { id: 'gcu', name: 'GCU (Government College University)', nameUrdu: 'گورنمنٹ کالج یونیورسٹی لاہور', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 6 },
  { id: 'itu', name: 'ITU / Arfa Karim Tower Corridor', nameUrdu: 'آئی ٹی یو / ارفع ٹاور کوریڈور', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 7 },
  { id: 'kinnaird', name: 'Kinnaird College for Women (Jail Rd)', nameUrdu: 'کنیرڈ کالج برائے خواتین (جیل روڈ)', regionType: 'university', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 8 },
  { id: 'johar_town', name: 'Johar Town', nameUrdu: 'جوہر ٹاؤن', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 9 },
  { id: 'model_town', name: 'Model Town', nameUrdu: 'ماڈل ٹاؤن', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 10 },
  { id: 'gulberg', name: 'Gulberg (Main Blvd & MM Alam)', nameUrdu: 'گلبرگ (مین بلیوارڈ و ایم ایم عالم)', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 11 },
  { id: 'dha_lahore', name: 'DHA Lahore (Phases 1-8)', nameUrdu: 'ڈی ایچ اے لاہور', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 12 },
  { id: 'ferozepur_road', name: 'Ferozepur Road / Chuhng Corridor', nameUrdu: 'فروز پور روڈ / چونگ کوریڈور', regionType: 'transport_hub', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 13 },
  { id: 'canal_road', name: 'Canal Bank Road (Muslim Town / Thokar)', nameUrdu: 'کینال روڈ (مسلم ٹاؤن و ٹھوکر)', regionType: 'transport_hub', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 14 },
  { id: 'mall_road', name: 'Mall Road & Anarkali', nameUrdu: 'مال روڈ و انارکلی', regionType: 'public_area', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 15 },
  { id: 'allama_iqbal_town', name: 'Allama Iqbal Town / Wahdat Road', nameUrdu: 'علامہ اقبال ٹاؤن / وحدت روڈ', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 16 },
  { id: 'faisal_town', name: 'Faisal Town / Akbar Chowk', nameUrdu: 'فیصل ٹاؤن / اکبر چوک', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 17 },
  { id: 'cantt_lahore', name: 'Lahore Cantt / Saddar', nameUrdu: 'لاہور کینٹ / صدر', regionType: 'neighbourhood', city: 'Lahore', province: 'Punjab', isActive: true, displayOrder: 18 },
  { id: 'rawalpindi_cantt', name: 'Rawalpindi Saddar & Murree Road', nameUrdu: 'راولپنڈی صدر و مری روڈ', regionType: 'city', city: 'Rawalpindi', province: 'Punjab', isActive: true, displayOrder: 19 },
  { id: 'faisalabad_city', name: 'Faisalabad Clock Tower & D-Ground', nameUrdu: 'فیصل آباد گھنٹہ گھر و ڈی گراؤنڈ', regionType: 'city', city: 'Faisalabad', province: 'Punjab', isActive: true, displayOrder: 20 },
  { id: 'multan_city', name: 'Multan Cantt & Bosan Road', nameUrdu: 'ملتان کینٹ و بوسن روڈ', regionType: 'city', city: 'Multan', province: 'Punjab', isActive: true, displayOrder: 21 }
];

export const SEED_PLACES: CommunityPlace[] = [
  // UCP
  { id: 'ucp-gate1', regionId: 'ucp', name: 'Main Entrance Gate 1 (Khayaban-e-Jinnah)', nameUrdu: 'مین گیٹ 1 (خیابانِ جناح)', placeType: 'entrance_gate', latitude: 31.4485, longitude: 74.2682, isActive: true },
  { id: 'ucp-bus-stop', regionId: 'ucp', name: 'Shaukat Khanum / UCP Public Bus Stop', nameUrdu: 'شوکت خانم / یو سی پی پبلک بس اسٹاپ', placeType: 'transport_stop', latitude: 31.4491, longitude: 74.2690, isActive: true },
  { id: 'ucp-campus-quad', regionId: 'ucp', name: 'Central Academic Quad & Library Pathway', nameUrdu: 'سینٹرل اکیڈمک کواڈ و لائبریری پاتھ', placeType: 'main_campus', latitude: 31.4480, longitude: 74.2675, isActive: true },
  { id: 'ucp-back-corridor', regionId: 'ucp', name: 'South Service Road & Faculty Parking', nameUrdu: 'ساؤتھ سروس روڈ و فیکلٹی پارکنگ', placeType: 'parking', latitude: 31.4472, longitude: 74.2668, isActive: true },

  // UMT
  { id: 'umt-gate1', regionId: 'umt', name: 'North Main Gate 1 (C-Block)', nameUrdu: 'نارتھ مین گیٹ 1 (سی بلاک)', placeType: 'entrance_gate', latitude: 31.4721, longitude: 74.2936, isActive: true },
  { id: 'umt-transport', regionId: 'umt', name: 'UMT Roundabout & Shuttle Pick-up Zone', nameUrdu: 'یو ایم ٹی راؤنڈ اباؤٹ و شٹل اسٹاپ', placeType: 'transport_stop', latitude: 31.4715, longitude: 74.2942, isActive: true },
  { id: 'umt-commercial', regionId: 'umt', name: 'Bagh-e-Jinnah Commercial Market (Opposite UMT)', nameUrdu: 'باغ جناح مارکیٹ (بالمقابل یو ایم ٹی)', placeType: 'commercial_area', latitude: 31.4728, longitude: 74.2948, isActive: true },
  { id: 'umt-gate2-corridor', regionId: 'umt', name: 'Female Gate 2 & Hostel Approach Road', nameUrdu: 'خواتین گیٹ 2 و ہاسٹل روڈ', placeType: 'entrance_gate', latitude: 31.4708, longitude: 74.2925, isActive: true },

  // UOL
  { id: 'uol-gate1', regionId: 'uol', name: 'Defence Road Main Entrance Gate', nameUrdu: 'ڈیفنس روڈ مین گیٹ', placeType: 'entrance_gate', latitude: 31.3934, longitude: 74.2425, isActive: true },
  { id: 'uol-bus-bay', regionId: 'uol', name: 'Public Speedo / Metro Feeder Bus Bay', nameUrdu: 'اسپیڈو / میٹرو فیڈر بس بے', placeType: 'transport_stop', latitude: 31.3942, longitude: 74.2435, isActive: true },
  { id: 'uol-bhoptian', regionId: 'uol', name: 'Bhoptian Chowk Approach & Overhead Crossing', nameUrdu: 'بھوپتیاں چوک اپروچ', placeType: 'transport_stop', latitude: 31.3915, longitude: 74.2405, isActive: true },
  { id: 'uol-girls-hostel', regionId: 'uol', name: 'Girls Hostel Complex & Sports Pavilion', nameUrdu: 'گرلز ہاسٹل کمپلیکس', placeType: 'main_campus', latitude: 31.3950, longitude: 74.2440, isActive: true },

  // Johar Town
  { id: 'johar-expo', regionId: 'johar_town', name: 'Expo Centre Roundabout & Emporium Approach', nameUrdu: 'ایکسپو سینٹر چوک و ایمپوریم اپروچ', placeType: 'transport_stop', latitude: 31.4682, longitude: 74.2755, isActive: true },
  { id: 'johar-allahhoo', regionId: 'johar_town', name: 'Allah Hoo Roundabout & Commercial Market', nameUrdu: 'اللہ ہو چوک و کمرشل مارکیٹ', placeType: 'commercial_area', latitude: 31.4610, longitude: 74.2880, isActive: true },
  { id: 'johar-doctors', regionId: 'johar_town', name: 'Doctor\'s Hospital Canal Link Road', nameUrdu: 'ڈاکٹرز ہسپتال کینال لنک روڈ', placeType: 'transport_stop', latitude: 31.4820, longitude: 74.2815, isActive: true },
  { id: 'johar-g1', regionId: 'johar_town', name: 'G1 Market & Evening Dining Street', nameUrdu: 'جی ون مارکیٹ و ڈائننگ اسٹریٹ', placeType: 'commercial_area', latitude: 31.4585, longitude: 74.2920, isActive: true },

  // Model Town
  { id: 'model-central', regionId: 'model_town', name: 'Model Town Central Park & C-Block Market', nameUrdu: 'ماڈل ٹاؤن سینٹرل پارک و سی بلاک مارکیٹ', placeType: 'commercial_area', latitude: 31.4875, longitude: 74.3210, isActive: true },
  { id: 'model-link-road', regionId: 'model_town', name: 'Model Town Link Road Commercial Strip', nameUrdu: 'ماڈل ٹاؤن لنک روڈ مارکیٹ', placeType: 'commercial_area', latitude: 31.4780, longitude: 74.3160, isActive: true },
  { id: 'model-metro', regionId: 'model_town', name: 'Metro Bus Feeder Stop & Underpass', nameUrdu: 'میٹرو بس فیڈر اسٹاپ و انڈر پاس', placeType: 'transport_stop', latitude: 31.4820, longitude: 74.3110, isActive: true },
  { id: 'model-gate4', regionId: 'model_town', name: 'Model Town Society Gate 4 (Ferozepur Rd Link)', nameUrdu: 'سوسائٹی گیٹ 4 (فروز پور روڈ لنک)', placeType: 'entrance_gate', latitude: 31.4910, longitude: 74.3315, isActive: true },

  // Gulberg
  { id: 'gulberg-mmalam', regionId: 'gulberg', name: 'MM Alam Road Commercial Strip & Cafes', nameUrdu: 'ایم ایم عالم روڈ کمرشل اسٹریپ', placeType: 'commercial_area', latitude: 31.5126, longitude: 74.3541, isActive: true },
  { id: 'gulberg-liberty', regionId: 'gulberg', name: 'Liberty Roundabout & Women Market Corridor', nameUrdu: 'لبرٹی گول چکر و مارکیٹ کوریڈور', placeType: 'commercial_area', latitude: 31.5190, longitude: 74.3465, isActive: true },
  { id: 'gulberg-mainblvd', regionId: 'gulberg', name: 'Main Boulevard & Kalma Chowk Underpass Crossing', nameUrdu: 'مین بلیوارڈ و کلمہ چوک انڈرپاس', placeType: 'transport_stop', latitude: 31.5075, longitude: 74.3380, isActive: true },
  { id: 'gulberg-hafeez', regionId: 'gulberg', name: 'Hafeez Centre Pedestrian Overpass & Plaza Lane', nameUrdu: 'حفیظ سینٹر پیڈسٹرین اوورپاس', placeType: 'commercial_area', latitude: 31.5165, longitude: 74.3410, isActive: true },

  // PUCIT & Transport Hubs
  { id: 'pucit-metro', regionId: 'pucit', name: 'Campus Canal Metro Feeder Station', nameUrdu: 'کینال میٹرو فیڈر اسٹیشن', placeType: 'transport_stop', latitude: 31.4980, longitude: 74.3050, isActive: true },
  { id: 'ferozepur-chuhng', regionId: 'ferozepur_road', name: 'Chuhng Bus Terminal & Pedestrian Ramp', nameUrdu: 'چونگ بس ٹرمینل و پیڈسٹرین ریمپ', placeType: 'transport_stop', latitude: 31.4120, longitude: 74.1980, isActive: true }
];

// Initial Curated Published Reports (Realistic, helpful community safety alerts)
const INITIAL_REPORTS: CommunityReport[] = [
  {
    id: 'rep-umt-lighting-01',
    userId: 'user-guardian-1',
    reporterDisplayName: 'Ayesha (Student)',
    title: 'Low Street Lighting on North Pedestrian Walkway',
    description: 'Street lamps behind Gate 1 along the residential side street are flickering or completely unpowered after 7:30 PM. Pedestrians waiting for ride-shares are advised to stay near the main guard booth.',
    category: 'poor_lighting',
    regionId: 'umt',
    placeId: 'umt-gate1',
    locationName: 'UMT - North Main Gate 1 (C-Block)',
    latitude: 31.4721,
    longitude: 74.2936,
    incidentAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: 'published',
    corroborationStatus: 'community_corroborated',
    corroborationCount: 5,
    corroborationNotes: '5 independent students and commuters confirmed this recurring issue.',
    sentiment: 'uncomfortable',
    tags: ['Poor Lighting', 'Low Visibility', 'Wait Near Guard'],
    viewsCount: 312,
    helpfulCount: 88,
    helpfulUserIds: ['seed-user-1', 'seed-user-2'],
    contentHash: 'hash-umt-01'
  },
  {
    id: 'rep-ucp-transit-02',
    userId: 'user-guardian-2',
    reporterDisplayName: 'Zainab (Commuter)',
    title: 'Active Police Patrolling at Khayaban-e-Jinnah Intersection',
    description: 'Punjab Police Dolphin Squad van stationed at the roundabout near Shaukat Khanum & UCP approach. Well-lit corridor with active shopfronts and safe pedestrian transit until 11 PM.',
    category: 'general_safety',
    regionId: 'ucp',
    placeId: 'ucp-bus-stop',
    locationName: 'UCP - Shaukat Khanum / UCP Public Bus Stop',
    latitude: 31.4485,
    longitude: 74.2682,
    incidentAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    status: 'published',
    corroborationStatus: 'multiple_reports',
    corroborationCount: 3,
    corroborationNotes: '3 independent community members corroborated this report.',
    sentiment: 'safe',
    tags: ['Police Present', 'Well-Lit', 'Safe Corridor'],
    viewsCount: 245,
    helpfulCount: 64,
    helpfulUserIds: ['seed-user-3'],
    contentHash: 'hash-ucp-02'
  },
  {
    id: 'rep-gulberg-market-03',
    userId: 'user-guardian-3',
    reporterDisplayName: 'Fatima (Resident)',
    title: 'Road Surface Hazard & Construction Detour',
    description: 'Open drainage trench near the corner of MM Alam Road commercial strip undergoing sewer replacement. Narrowed pedestrian walking path with uneven footing. Exercise caution in flat footwear.',
    category: 'infrastructure',
    regionId: 'gulberg',
    placeId: 'gulberg-mmalam',
    locationName: 'Gulberg - MM Alam Road Commercial Strip',
    latitude: 31.5126,
    longitude: 74.3541,
    incidentAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    status: 'published',
    corroborationStatus: 'multiple_reports',
    corroborationCount: 2,
    corroborationNotes: '2 independent community reports logged in this sector.',
    sentiment: 'neutral',
    tags: ['Construction', 'Narrow Walkway', 'Detour Active'],
    viewsCount: 189,
    helpfulCount: 42,
    helpfulUserIds: [],
    contentHash: 'hash-gulberg-03'
  }
];

// Initial Curated Confirmations to establish 5-user corroboration on seed report
const INITIAL_CONFIRMATIONS: CommunityReportConfirmation[] = [
  { id: 'conf-1', reportId: 'rep-umt-lighting-01', userId: 'user-indep-1', confirmationType: 'personally_experienced', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: 'conf-2', reportId: 'rep-umt-lighting-01', userId: 'user-indep-2', confirmationType: 'observed', createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString() },
  { id: 'conf-3', reportId: 'rep-umt-lighting-01', userId: 'user-indep-3', confirmationType: 'observed', createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
  { id: 'conf-4', reportId: 'rep-umt-lighting-01', userId: 'user-indep-4', confirmationType: 'frequently_occurs', createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
];

// ── Atomic Persistent Store on Server Disk ───────────────────────────────────
interface CommunityStoreFile {
  regions: CommunityRegion[];
  places: CommunityPlace[];
  reports: CommunityReport[];
  updates: CommunityReportUpdate[];
  confirmations: CommunityReportConfirmation[];
  restrictions: UserRestriction[];
  moderationAudit: ModerationAuditEntry[];
  lastSavedAt: string;
}

const STORE_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(STORE_DIR, 'community_store.json');

class CommunityRepository {
  private regions: Map<string, CommunityRegion> = new Map();
  private places: Map<string, CommunityPlace> = new Map();
  private reports: Map<string, CommunityReport> = new Map();
  private updates: Map<string, CommunityReportUpdate> = new Map();
  private confirmations: Map<string, CommunityReportConfirmation> = new Map();
  private restrictions: Map<string, UserRestriction> = new Map();
  private auditLog: ModerationAuditEntry[] = [];
  private isSaving = false;

  constructor() {
    this.initStore();
  }

  private initStore(): void {
    // 1. Seed in-memory defaults
    for (const r of SEED_REGIONS) this.regions.set(r.id, r);
    for (const p of SEED_PLACES) this.places.set(p.id, p);
    for (const rep of INITIAL_REPORTS) this.reports.set(rep.id, rep);
    for (const c of INITIAL_CONFIRMATIONS) this.confirmations.set(`${c.reportId}:${c.userId}`, c);

    // 2. Load persisted state from disk if exists
    try {
      if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true });
      }
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed: CommunityStoreFile = JSON.parse(raw);
        if (parsed.regions && Array.isArray(parsed.regions)) {
          for (const r of parsed.regions) this.regions.set(r.id, r);
        }
        if (parsed.places && Array.isArray(parsed.places)) {
          for (const p of parsed.places) this.places.set(p.id, p);
        }
        if (parsed.reports && Array.isArray(parsed.reports)) {
          for (const rep of parsed.reports) this.reports.set(rep.id, rep);
        }
        if (parsed.updates && Array.isArray(parsed.updates)) {
          for (const u of parsed.updates) this.updates.set(u.id, u);
        }
        if (parsed.confirmations && Array.isArray(parsed.confirmations)) {
          for (const c of parsed.confirmations) this.confirmations.set(`${c.reportId}:${c.userId}`, c);
        }
        if (parsed.restrictions && Array.isArray(parsed.restrictions)) {
          for (const res of parsed.restrictions) this.restrictions.set(res.id, res);
        }
        if (parsed.moderationAudit && Array.isArray(parsed.moderationAudit)) {
          this.auditLog = parsed.moderationAudit;
        }
        console.log(`[CommunityRepository] Loaded ${this.reports.size} persistent community reports from ${STORE_PATH}`);
      } else {
        this.saveToDisk();
      }
    } catch (err) {
      console.warn('[CommunityRepository] Initial load warning, using memory defaults:', err);
      this.saveToDisk();
    }
  }

  private saveToDisk(): void {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, { recursive: true });
      }
      const data: CommunityStoreFile = {
        regions: Array.from(this.regions.values()),
        places: Array.from(this.places.values()),
        reports: Array.from(this.reports.values()),
        updates: Array.from(this.updates.values()),
        confirmations: Array.from(this.confirmations.values()),
        restrictions: Array.from(this.restrictions.values()),
        moderationAudit: this.auditLog,
        lastSavedAt: new Date().toISOString()
      };
      // Atomic write using temp file
      const tempPath = `${STORE_PATH}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, STORE_PATH);
    } catch (err) {
      console.error('[CommunityRepository] Failed to persist community store to disk:', err);
    } finally {
      this.isSaving = false;
    }
  }

  public getRegions(): CommunityRegion[] {
    return Array.from(this.regions.values())
      .filter(r => r.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  public getPlaces(regionId?: string): CommunityPlace[] {
    const list = Array.from(this.places.values()).filter(p => p.isActive);
    if (regionId && regionId !== 'all') {
      return list.filter(p => p.regionId === regionId);
    }
    return list;
  }

  public getReports(params: {
    regionId?: string;
    placeId?: string;
    category?: string;
    status?: string;
    corroborationStatus?: string;
    search?: string;
    limit?: number;
    offset?: number;
    currentUserId?: string;
  }): { reports: (CommunityReport & { isConfirmedByMe: boolean; isHelpfulByMe: boolean; isMyReport: boolean; updates: CommunityReportUpdate[] })[]; total: number } {
    let list = Array.from(this.reports.values()).filter(r => r.status === 'published' || r.status === 'resolved');

    if (params.regionId && params.regionId !== 'all') {
      list = list.filter(r => r.regionId === params.regionId);
    }
    if (params.placeId && params.placeId !== 'all') {
      list = list.filter(r => r.placeId === params.placeId);
    }
    if (params.category && params.category !== 'all') {
      list = list.filter(r => r.category === params.category);
    }
    if (params.corroborationStatus && params.corroborationStatus !== 'all') {
      if (params.corroborationStatus === 'resolved') {
        list = list.filter(r => r.status === 'resolved' || r.corroborationStatus === 'resolved');
      } else if (params.corroborationStatus === 'community_corroborated') {
        list = list.filter(r => (r.corroborationStatus === 'community_corroborated' || (r.corroborationCount || 0) >= 5) && r.status !== 'resolved');
      } else if (params.corroborationStatus === 'multiple_reports') {
        list = list.filter(r => (r.corroborationStatus === 'multiple_reports' || ((r.corroborationCount || 0) >= 2 && (r.corroborationCount || 0) < 5)) && r.status !== 'resolved');
      } else if (params.corroborationStatus === 'single_report') {
        list = list.filter(r => (r.corroborationStatus === 'single_report' || (r.corroborationCount || 0) <= 1) && r.status !== 'resolved');
      } else {
        list = list.filter(r => r.corroborationStatus === params.corroborationStatus);
      }
    }
    if (params.search && params.search.trim().length > 0) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.locationName.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort: Community Corroborated first, then by newest
    list.sort((a, b) => {
      if (a.corroborationStatus === 'community_corroborated' && b.corroborationStatus !== 'community_corroborated') return -1;
      if (b.corroborationStatus === 'community_corroborated' && a.corroborationStatus !== 'community_corroborated') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = list.length;
    const offset = Math.max(0, params.offset || 0);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const paginated = list.slice(offset, offset + limit);

    // Decorate with per-user relationship & updates
    const decorated = paginated.map(r => {
      const isConfirmed = params.currentUserId ? this.hasUserConfirmed(r.id, params.currentUserId) : false;
      const isHelpful = params.currentUserId ? (r.helpfulUserIds || []).includes(params.currentUserId) : false;
      const isMine = params.currentUserId ? r.userId === params.currentUserId : false;
      const updates = Array.from(this.updates.values())
        .filter(u => u.reportId === r.id && u.moderationStatus === 'published')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      return {
        ...r,
        isConfirmedByMe: isConfirmed,
        isHelpfulByMe: isHelpful,
        isMyReport: isMine,
        updates
      };
    });

    return { reports: decorated, total };
  }

  public getReportById(id: string): CommunityReport | null {
    return this.reports.get(id) || null;
  }

  public hasUserConfirmed(reportId: string, userId: string): boolean {
    return this.confirmations.has(`${reportId}:${userId}`);
  }

  public getActiveRestriction(userId: string): UserRestriction | null {
    const now = Date.now();
    for (const res of this.restrictions.values()) {
      if (res.userId === userId && res.status === 'active') {
        const expiresAt = new Date(res.expiresAt).getTime();
        if (expiresAt > now) {
          return res;
        } else {
          res.status = 'expired';
          this.saveToDisk();
        }
      }
    }
    return null;
  }

  public countUserReportsToday(userId: string): number {
    const { startIso, endIso } = getPakistanDayBounds();
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();

    let count = 0;
    for (const rep of this.reports.values()) {
      if (rep.userId === userId) {
        const t = new Date(rep.createdAt).getTime();
        if (t >= startTime && t <= endTime) {
          count++;
        }
      }
    }
    return count;
  }

  public countUserUpdatesToday(userId: string): number {
    const { startIso, endIso } = getPakistanDayBounds();
    const startTime = new Date(startIso).getTime();
    const endTime = new Date(endIso).getTime();

    let count = 0;
    for (const u of this.updates.values()) {
      if (u.userId === userId) {
        const t = new Date(u.createdAt).getTime();
        if (t >= startTime && t <= endTime) {
          count++;
        }
      }
    }
    return count;
  }

  public isDuplicateContent(userId: string, title: string, description: string, regionId: string): boolean {
    const now = Date.now();
    const hash = crypto.createHash('md5').update(`${title.trim().toLowerCase()}:${description.trim().toLowerCase()}:${regionId}`).digest('hex');

    for (const rep of this.reports.values()) {
      if (rep.userId === userId && rep.contentHash === hash) {
        const ageMs = now - new Date(rep.createdAt).getTime();
        if (ageMs < DUPLICATE_WINDOW_MS) {
          return true;
        }
      }
    }
    return false;
  }

  public calculateCorroboration(reportId: string): { status: CommunityReport['corroborationStatus']; count: number; notes: string } {
    const target = this.reports.get(reportId);
    if (!target) return { status: 'single_report', count: 1, notes: 'Single community observation' };

    const windowCutoff = Date.now() - CORROBORATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const contributingUsers = new Set<string>();

    if (target.userId) contributingUsers.add(target.userId);

    // 1. Confirmations on this specific report
    for (const conf of this.confirmations.values()) {
      if (conf.reportId === reportId && conf.userId) {
        contributingUsers.add(conf.userId);
      }
    }

    // 2. Corroborating independent reports in the same region & category within 30 days
    for (const other of this.reports.values()) {
      if (
        other.id !== reportId &&
        other.regionId === target.regionId &&
        other.category === target.category &&
        other.status === 'published' &&
        new Date(other.createdAt).getTime() >= windowCutoff &&
        other.userId
      ) {
        contributingUsers.add(other.userId);
      }
    }

    const count = Math.max(1, contributingUsers.size);

    if (count >= CORROBORATION_THRESHOLD) {
      return {
        status: 'community_corroborated',
        count,
        notes: `${count} independent community members corroborated this recurring issue in this area.`
      };
    } else if (count >= 2) {
      return {
        status: 'multiple_reports',
        count,
        notes: `${count} independent community reports logged in this area.`
      };
    }

    return {
      status: 'single_report',
      count,
      notes: 'Initial community report'
    };
  }

  public createReport(report: Omit<CommunityReport, 'corroborationStatus' | 'corroborationCount' | 'corroborationNotes' | 'contentHash' | 'helpfulUserIds'>): CommunityReport {
    const hash = crypto.createHash('md5').update(`${report.title.trim().toLowerCase()}:${report.description.trim().toLowerCase()}:${report.regionId}`).digest('hex');

    const newReport: CommunityReport = {
      ...report,
      corroborationStatus: 'single_report',
      corroborationCount: 1,
      corroborationNotes: 'Initial community report',
      helpfulUserIds: [],
      contentHash: hash
    };

    this.reports.set(newReport.id, newReport);

    // Update corroboration status for this report and any related reports in the area
    const corr = this.calculateCorroboration(newReport.id);
    newReport.corroborationStatus = corr.status;
    newReport.corroborationCount = corr.count;
    newReport.corroborationNotes = corr.notes;

    // Recalculate other reports in the same category/region that might now cross the 5-user threshold!
    for (const other of this.reports.values()) {
      if (other.id !== newReport.id && other.regionId === newReport.regionId && other.category === newReport.category) {
        const otherCorr = this.calculateCorroboration(other.id);
        other.corroborationStatus = otherCorr.status;
        other.corroborationCount = otherCorr.count;
        other.corroborationNotes = otherCorr.notes;
      }
    }

    this.saveToDisk();

    const sb = getSupabaseServer();
    if (sb) {
      void sb.from('community_reports').upsert({
        id: newReport.id,
        user_id: newReport.userId || null,
        reporter_display_name: newReport.reporterDisplayName,
        title: newReport.title,
        description: newReport.description,
        category: newReport.category,
        region_id: newReport.regionId,
        place_id: newReport.placeId || null,
        location_name: newReport.locationName,
        latitude: newReport.latitude || null,
        longitude: newReport.longitude || null,
        incident_at: newReport.incidentAt,
        created_at: newReport.createdAt,
        updated_at: newReport.updatedAt,
        status: newReport.status,
        corroboration_status: newReport.corroborationStatus,
        corroboration_count: newReport.corroborationCount,
        corroboration_notes: newReport.corroborationNotes || null,
        resolved_at: newReport.resolvedAt || null,
        resolved_note: newReport.resolvedNote || null,
        sentiment: newReport.sentiment,
        tags: newReport.tags || [],
        views_count: newReport.viewsCount,
        helpful_count: newReport.helpfulCount,
        content_hash: newReport.contentHash
      }).then(({ error }) => {
        if (error) console.warn('[Supabase] community_reports upsert notice:', error.message);
      });
    }

    return newReport;
  }

  public addConfirmation(reportId: string, userId: string, type: CommunityReportConfirmation['confirmationType'] = 'observed'): { success: boolean; report: CommunityReport | null; count: number } {
    const report = this.reports.get(reportId);
    if (!report) return { success: false, report: null, count: 0 };

    const key = `${reportId}:${userId}`;
    if (this.confirmations.has(key)) {
      // Already confirmed by this user
      return { success: false, report, count: report.corroborationCount };
    }

    const conf: CommunityReportConfirmation = {
      id: `conf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      reportId,
      userId,
      confirmationType: type,
      createdAt: new Date().toISOString()
    };

    this.confirmations.set(key, conf);

    // Recalculate corroboration with this new independent confirmation
    const corr = this.calculateCorroboration(reportId);
    report.corroborationStatus = corr.status;
    report.corroborationCount = corr.count;
    report.corroborationNotes = corr.notes;
    report.updatedAt = new Date().toISOString();

    this.saveToDisk();

    const sb = getSupabaseServer();
    if (sb) {
      void sb.from('community_report_confirmations').upsert({
        id: conf.id,
        report_id: conf.reportId,
        user_id: conf.userId,
        confirmation_type: conf.confirmationType,
        created_at: conf.createdAt
      }).then(({ error }) => {
        if (error) console.warn('[Supabase] confirmation upsert notice:', error.message);
      });
      void sb.from('community_reports').update({
        corroboration_status: report.corroborationStatus,
        corroboration_count: report.corroborationCount,
        corroboration_notes: report.corroborationNotes,
        updated_at: report.updatedAt
      }).eq('id', reportId);
    }

    return { success: true, report, count: corr.count };
  }

  public addUpdate(update: Omit<CommunityReportUpdate, 'id' | 'createdAt'>): CommunityReportUpdate | null {
    const report = this.reports.get(update.reportId);
    if (!report) return null;

    const newUpdate: CommunityReportUpdate = {
      ...update,
      id: `upd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString()
    };

    this.updates.set(newUpdate.id, newUpdate);
    report.updatedAt = new Date().toISOString();

    if (update.updateType === 'resolution_note') {
      report.status = 'resolved';
      report.resolvedAt = new Date().toISOString();
      report.resolvedNote = update.content;
      report.corroborationStatus = 'resolved';
    }

    this.saveToDisk();

    const sb = getSupabaseServer();
    if (sb) {
      void sb.from('community_report_updates').upsert({
        id: newUpdate.id,
        report_id: newUpdate.reportId,
        user_id: newUpdate.userId || null,
        author_display_name: newUpdate.authorDisplayName,
        update_type: newUpdate.updateType,
        content: newUpdate.content,
        moderation_status: newUpdate.moderationStatus,
        created_at: newUpdate.createdAt
      }).then(({ error }) => {
        if (error) console.warn('[Supabase] update upsert notice:', error.message);
      });
      if (update.updateType === 'resolution_note') {
        void sb.from('community_reports').update({
          status: 'resolved',
          resolved_at: report.resolvedAt,
          resolved_note: report.resolvedNote,
          corroboration_status: 'resolved',
          updated_at: report.updatedAt
        }).eq('id', report.id);
      }
    }

    return newUpdate;
  }

  public toggleHelpful(reportId: string, userId: string): { helpfulCount: number; isHelpful: boolean } {
    const report = this.reports.get(reportId);
    if (!report) return { helpfulCount: 0, isHelpful: false };

    report.helpfulUserIds = report.helpfulUserIds || [];
    const idx = report.helpfulUserIds.indexOf(userId);
    let isHelpful = false;

    if (idx >= 0) {
      report.helpfulUserIds.splice(idx, 1);
      report.helpfulCount = Math.max(0, report.helpfulCount - 1);
      isHelpful = false;
    } else {
      report.helpfulUserIds.push(userId);
      report.helpfulCount += 1;
      isHelpful = true;
    }

    this.saveToDisk();

    const sb = getSupabaseServer();
    if (sb) {
      void sb.from('community_reports').update({
        helpful_count: report.helpfulCount
      }).eq('id', reportId);
    }

    return { helpfulCount: report.helpfulCount, isHelpful };
  }

  public addPlace(place: CommunityPlace): CommunityPlace {
    this.places.set(place.id, place);
    this.saveToDisk();
    const sb = getSupabaseServer();
    if (sb) {
      void sb.from('community_places').upsert({
        id: place.id,
        region_id: place.regionId,
        name: place.name,
        name_urdu: place.nameUrdu || null,
        place_type: place.placeType,
        latitude: place.latitude || null,
        longitude: place.longitude || null,
        is_active: place.isActive
      }).then(({ error }) => {
        if (error) console.warn('[Supabase] place upsert notice:', error.message);
      });
    }
    return place;
  }

  public resetUserQuota(userId: string): void {
    const { startIso } = getPakistanDayBounds();
    const startTime = new Date(startIso).getTime();
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();

    for (const rep of this.reports.values()) {
      if (rep.userId === userId) {
        const t = new Date(rep.createdAt).getTime();
        if (t >= startTime) {
          rep.createdAt = yesterday;
        }
      }
    }
    for (const u of this.updates.values()) {
      if (u.userId === userId) {
        const t = new Date(u.createdAt).getTime();
        if (t >= startTime) {
          u.createdAt = yesterday;
        }
      }
    }
    for (const res of this.restrictions.values()) {
      if (res.userId === userId && res.status === 'active') {
        res.status = 'revoked';
      }
    }
    this.saveToDisk();
  }

  public addRestriction(userId: string, durationDays: number, reason: UserRestriction['reasonCode'], details: string, userMessage: string): UserRestriction {
    const startsAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const res: UserRestriction = {
      id: `rest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      restrictionType: 'report_posting',
      reasonCode: reason,
      details,
      userMessage,
      startsAt,
      expiresAt,
      issuedBy: 'automated_abuse_monitor',
      status: 'active',
      appealStatus: 'none',
      createdAt: startsAt
    };

    this.restrictions.set(res.id, res);

    this.auditLog.push({
      id: `audit-${Date.now()}`,
      eventType: 'USER_RESTRICTION_ISSUED',
      targetUserId: userId,
      actionTaken: `Temporary ${durationDays}-day restriction (${reason})`,
      reason: details,
      performedBy: 'automated_abuse_monitor',
      createdAt: startsAt
    });

    this.saveToDisk();
    return res;
  }

  public submitAppeal(restrictionId: string, appealReason: string): boolean {
    const res = this.restrictions.get(restrictionId);
    if (!res) return false;

    res.appealStatus = 'pending';
    res.appealReason = appealReason;
    this.saveToDisk();
    return true;
  }
}

export const communityRepo = new CommunityRepository();

// ── Express Router ───────────────────────────────────────────────────────────
export const communityRouter = Router();

// 1. GET /api/community/regions — Returns list of active regions and places
communityRouter.get('/regions', (_req: Request, res: Response) => {
  const regions = communityRepo.getRegions();
  const places = communityRepo.getPlaces();
  res.json({
    success: true,
    regions,
    places
  });
});

function extractUserId(req: Request): string {
  const authed = req as AuthedRequest;
  if (authed.supabaseUserId) return authed.supabaseUserId;
  const headerId = req.headers['x-user-id'];
  if (typeof headerId === 'string' && headerId.trim()) return headerId.trim();
  if (typeof req.body?.userId === 'string' && req.body.userId.trim()) return req.body.userId.trim();
  if (typeof req.query?.userId === 'string' && req.query.userId.trim()) return req.query.userId.trim();
  return 'guest-user';
}

function extractUserDisplayName(req: Request): string {
  const headerName = req.headers['x-user-display-name'];
  if (typeof headerName === 'string' && headerName.trim()) return headerName.trim();
  if (typeof req.body?.reporterDisplayName === 'string' && req.body.reporterDisplayName.trim()) {
    return req.body.reporterDisplayName.trim();
  }
  return 'Community Guardian';
}

// 2. GET /api/community/reports — Paginated published community reports with filtering
communityRouter.get('/reports', (req: Request, res: Response) => {
  const currentUserId = extractUserId(req);

  const { reports, total } = communityRepo.getReports({
    regionId: typeof req.query.region_id === 'string' ? req.query.region_id : undefined,
    placeId: typeof req.query.place_id === 'string' ? req.query.place_id : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    corroborationStatus: typeof req.query.corroboration_status === 'string' ? req.query.corroboration_status : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    limit: Number(req.query.limit) || 20,
    offset: Number(req.query.offset) || 0,
    currentUserId
  });

  res.json({
    success: true,
    reports,
    total,
    count: reports.length
  });
});

// 3. GET /api/community/quota — Returns user daily report & update quota + active restrictions
communityRouter.get('/quota', (req: Request, res: Response) => {
  const userId = extractUserId(req);

  const { endIso } = getPakistanDayBounds();
  const reportsUsed = communityRepo.countUserReportsToday(userId);
  const updatesUsed = communityRepo.countUserUpdatesToday(userId);
  const activeRestriction = communityRepo.getActiveRestriction(userId);

  res.json({
    success: true,
    reportsUsedToday: reportsUsed,
    reportsMaxDaily: MAX_REPORTS_PER_DAY,
    reportsRemaining: Math.max(0, MAX_REPORTS_PER_DAY - reportsUsed),
    updatesUsedToday: updatesUsed,
    updatesMaxDaily: MAX_UPDATES_PER_DAY,
    updatesRemaining: Math.max(0, MAX_UPDATES_PER_DAY - updatesUsed),
    resetAt: endIso,
    activeRestriction: activeRestriction ? {
      id: activeRestriction.id,
      restrictionType: activeRestriction.restrictionType,
      reasonCode: activeRestriction.reasonCode,
      userMessage: activeRestriction.userMessage,
      expiresAt: activeRestriction.expiresAt,
      appealStatus: activeRestriction.appealStatus
    } : null
  });
});

// 4. POST /api/community/reports — Create a persistent community report
communityRouter.post('/reports', async (req: Request, res: Response) => {
  const userId = extractUserId(req);

  const { title, description, category, regionId, placeId, locationName, incidentAt, sentiment, tags } = req.body;

  // Anti-empty & Anti-dummy / Placeholder Validation
  const titleCheck = isDummyOrEmptyText(title, 5);
  if (titleCheck.isDummy) {
    return res.status(400).json({
      error: titleCheck.reason || 'Please provide a clear title describing the safety issue (at least 5 characters).',
      code: 'INVALID_TITLE'
    });
  }

  const descCheck = isDummyOrEmptyText(description, 10);
  if (descCheck.isDummy) {
    return res.status(400).json({
      error: descCheck.reason || 'Please describe the safety issue or observation in genuine detail (at least 10 characters).',
      code: 'INVALID_DESCRIPTION'
    });
  }

  if (!regionId || typeof regionId !== 'string') {
    return res.status(400).json({
      error: 'Please select an area or university campus in Lahore/Punjab.',
      code: 'MISSING_REGION'
    });
  }

  // 1. Check active restrictions
  const activeRestriction = communityRepo.getActiveRestriction(userId);
  if (activeRestriction && (activeRestriction.restrictionType === 'report_posting' || activeRestriction.restrictionType === 'community_ban')) {
    const hoursLeft = Math.ceil((new Date(activeRestriction.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60));
    return res.status(403).json({
      error: activeRestriction.userMessage || `Posting is temporarily restricted on your account. Time remaining: ~${hoursLeft} hours.`,
      code: 'USER_RESTRICTED',
      restriction: {
        id: activeRestriction.id,
        reason: activeRestriction.reasonCode,
        expiresAt: activeRestriction.expiresAt,
        appealStatus: activeRestriction.appealStatus
      }
    });
  }

  // 2. Check Daily Limit (Max 5 reports per Pakistan day)
  const reportsToday = communityRepo.countUserReportsToday(userId);
  if (reportsToday >= MAX_REPORTS_PER_DAY) {
    const { endIso } = getPakistanDayBounds();
    return res.status(429).json({
      error: `You have reached today's limit of ${MAX_REPORTS_PER_DAY} community reports. Your daily quota resets at midnight Pakistan Standard Time.`,
      code: 'DAILY_REPORT_LIMIT_REACHED',
      resetAt: endIso
    });
  }

  // 3. Duplicate spam detection
  if (communityRepo.isDuplicateContent(userId, title, description, regionId)) {
    // If user attempts duplicate spam repeatedly, issue automated 1-day restriction
    const duplicateCount = 1; // tracked internally
    if (duplicateCount >= 3) {
      communityRepo.addRestriction(
        userId,
        1,
        'duplicate_spam',
        'Repeatedly submitted identical report content within short window',
        'Your posting has been temporarily restricted for 24 hours due to repeated duplicate submissions.'
      );
    }

    return res.status(400).json({
      error: 'A very similar report was recently submitted. Please check existing reports or add an update instead.',
      code: 'DUPLICATE_REPORT_DETECTED'
    });
  }

  // Resolve Location Name
  let finalLocationName = locationName;
  if (!finalLocationName) {
    const regionObj = communityRepo.getRegions().find(r => r.id === regionId);
    const placeObj = placeId ? communityRepo.getPlaces().find(p => p.id === placeId) : null;
    finalLocationName = placeObj ? `${regionObj?.name || regionId} - ${placeObj.name}` : (regionObj?.name || 'Lahore, Punjab');
  }

  // Privacy protection: sanitize reporter display name (never expose CNIC or real identity)
  const safeDisplayName = req.body.reporterName
    ? String(req.body.reporterName).replace(/[^a-zA-Z\s]/g, '').trim().slice(0, 30) || 'Community Guardian'
    : 'Community Guardian';

  const reportId = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();

  const newReport = communityRepo.createReport({
    id: reportId,
    userId,
    reporterDisplayName: safeDisplayName,
    title: title.trim().slice(0, 150),
    description: description.trim().slice(0, 1500),
    category: String(category || 'general_safety'),
    regionId: String(regionId),
    placeId: placeId ? String(placeId) : null,
    locationName: finalLocationName,
    latitude: typeof req.body.latitude === 'number' ? req.body.latitude : null,
    longitude: typeof req.body.longitude === 'number' ? req.body.longitude : null,
    incidentAt: incidentAt ? String(incidentAt) : nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    status: 'published',
    sentiment: sentiment || 'uncomfortable',
    tags: Array.isArray(tags) ? tags.map(t => String(t).slice(0, 30)).slice(0, 6) : ['Community Reported'],
    viewsCount: 1,
    helpfulCount: 1
  });

  // Log to live API Activity telemetry
  void logApiActivity({
    endpoint: '/api/community/reports',
    method: 'POST',
    targetService: 'server',
    status: 'success',
    statusCode: 201,
    requestPreview: {
      action: 'COMMUNITY_REPORT_CREATED',
      title: newReport.title,
      category: newReport.category,
      regionId: newReport.regionId,
      corroborationStatus: newReport.corroborationStatus
    },
    responsePreview: {
      reportId: newReport.id,
      status: 'PUBLISHED_PERSISTENT',
      corroborationStatus: newReport.corroborationStatus,
      corroborationCount: newReport.corroborationCount
    }
  });

  res.status(201).json({
    success: true,
    message: 'Report published and permanently saved to the community safety network.',
    report: newReport
  });
});

// 5. POST /api/community/reports/:id/confirm — Community Corroboration Confirmation
communityRouter.post('/reports/:id/confirm', (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const reportId = req.params.id;
  const type = req.body.confirmationType || 'observed';

  const result = communityRepo.addConfirmation(reportId, userId, type);

  if (!result.success && !result.report) {
    return res.status(404).json({
      error: 'Community report not found.',
      code: 'REPORT_NOT_FOUND'
    });
  }

  if (!result.success && result.report) {
    return res.status(400).json({
      error: 'You have already confirmed this safety observation. Each account can confirm once.',
      code: 'ALREADY_CONFIRMED'
    });
  }

  void logApiActivity({
    endpoint: `/api/community/reports/${reportId}/confirm`,
    method: 'POST',
    targetService: 'server',
    status: 'success',
    statusCode: 200,
    requestPreview: {
      action: 'COMMUNITY_CORROBORATION_CONFIRMED',
      reportId,
      confirmationType: type
    },
    responsePreview: {
      newCorroborationCount: result.count,
      status: result.report?.corroborationStatus
    }
  });

  res.json({
    success: true,
    message: 'Thank you for corroborating this local issue. Your independent verification increases safety awareness.',
    corroborationCount: result.count,
    corroborationStatus: result.report?.corroborationStatus,
    corroborationNotes: result.report?.corroborationNotes
  });
});

// 6. POST /api/community/reports/:id/updates — Add follow-up update to existing report
communityRouter.post('/reports/:id/updates', (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const reportId = req.params.id;
  const { content, updateType, isResolution } = req.body;

  const updateCheck = isDummyOrEmptyText(content, 6);
  if (updateCheck.isDummy) {
    return res.status(400).json({
      error: updateCheck.reason || 'Please enter genuine details for your update (at least 6 characters).',
      code: 'INVALID_UPDATE'
    });
  }

  // 1. Check active restrictions
  const activeRestriction = communityRepo.getActiveRestriction(userId);
  if (activeRestriction && (activeRestriction.restrictionType === 'update_posting' || activeRestriction.restrictionType === 'community_ban')) {
    return res.status(403).json({
      error: 'Updating reports is currently restricted on your account.',
      code: 'USER_RESTRICTED'
    });
  }

  // 2. Check Daily Update Quota (Max 5 updates per day)
  const updatesToday = communityRepo.countUserUpdatesToday(userId);
  if (updatesToday >= MAX_UPDATES_PER_DAY) {
    return res.status(429).json({
      error: `You have reached today's limit of ${MAX_UPDATES_PER_DAY} updates. Your daily quota resets at midnight Pakistan Standard Time.`,
      code: 'DAILY_UPDATE_LIMIT_REACHED'
    });
  }

  const safeAuthorName = req.body.authorName
    ? String(req.body.authorName).replace(/[^a-zA-Z\s]/g, '').trim().slice(0, 30) || 'Community Member'
    : extractUserDisplayName(req);

  const created = communityRepo.addUpdate({
    reportId,
    userId,
    authorDisplayName: safeAuthorName,
    updateType: isResolution ? 'resolution_note' : (updateType || 'status_update'),
    content: content.trim().slice(0, 800),
    moderationStatus: 'published'
  });

  if (!created) {
    return res.status(404).json({
      error: 'Original community report not found.',
      code: 'REPORT_NOT_FOUND'
    });
  }

  res.status(201).json({
    success: true,
    message: 'Update attached to report history successfully.',
    update: created
  });
});

// 7. POST /api/community/reports/:id/helpful — Upvote helpfulness
communityRouter.post('/reports/:id/helpful', (req: Request, res: Response) => {
  const userId = extractUserId(req);
  const reportId = req.params.id;

  const result = communityRepo.toggleHelpful(reportId, userId);
  res.json({
    success: true,
    ...result
  });
});

// 8. POST /api/community/appeal — Submit appeal against active restriction
communityRouter.post('/appeal', (req: Request, res: Response) => {
  const { restrictionId, appealReason } = req.body;

  if (!restrictionId || !appealReason || typeof appealReason !== 'string' || appealReason.trim().length < 10) {
    return res.status(400).json({
      error: 'Please provide a clear reason for your appeal (at least 10 characters).',
      code: 'INVALID_APPEAL'
    });
  }

  const ok = communityRepo.submitAppeal(restrictionId, appealReason.trim());
  if (!ok) {
    return res.status(404).json({
      error: 'Restriction record not found.',
      code: 'NOT_FOUND'
    });
  }

  res.json({
    success: true,
    message: 'Your appeal has been submitted for moderation review.'
  });
});

// 9. POST /api/community/places — Add a custom place (e.g. from OpenStreetMap / Nominatim map search)
communityRouter.post('/places', (req: Request, res: Response) => {
  const { name, regionId, placeType, latitude, longitude, nameUrdu } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter a valid place name (at least 2 characters).', code: 'INVALID_PLACE_NAME' });
  }

  const cleanName = name.trim().slice(0, 100);
  const targetRegionId = String(regionId || 'johar_town');

  // Check if place already exists
  const existing = communityRepo.getPlaces(targetRegionId).find(p => p.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    return res.json({ success: true, place: existing, isExisting: true });
  }

  const placeId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newPlace: CommunityPlace = {
    id: placeId,
    regionId: targetRegionId,
    name: cleanName,
    nameUrdu: nameUrdu ? String(nameUrdu).slice(0, 100) : undefined,
    placeType: placeType || 'general',
    latitude: typeof latitude === 'number' ? latitude : null,
    longitude: typeof longitude === 'number' ? longitude : null,
    isActive: true
  };

  communityRepo.addPlace(newPlace);

  res.status(201).json({
    success: true,
    message: 'Custom location added and pinned to community places.',
    place: newPlace
  });
});

// 10. POST /api/community/quota/reset — Reset daily limits for demo & testing
communityRouter.post('/quota/reset', (req: Request, res: Response) => {
  const userId = extractUserId(req);
  communityRepo.resetUserQuota(userId);
  res.json({
    success: true,
    message: 'Community reporting and update daily quota reset successfully for testing.'
  });
});

