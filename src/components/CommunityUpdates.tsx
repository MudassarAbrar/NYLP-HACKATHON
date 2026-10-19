/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Users, 
  MapPin, 
  ThumbsUp, 
  Share2, 
  Plus, 
  ShieldCheck, 
  Star, 
  CheckCircle2, 
  MessageSquare, 
  X, 
  Sparkles, 
  Filter, 
  Check, 
  AlertTriangle, 
  Bell, 
  Search, 
  RefreshCw, 
  Clock, 
  Shield, 
  Send, 
  Building2, 
  AlertCircle, 
  HelpCircle, 
  ExternalLink, 
  ChevronDown,
  Navigation,
  Lock,
  FileText,
  Map,
  Globe,
  Compass
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppLanguage, UserProfile } from '../types';
import { SentimentPicker, SentimentType } from './ui/sentiment-picker';
import { StarRating } from './ui/star-rating';
import { getAuthHeaders } from '../utils/auth';
import { searchAddress } from '../services/osmService';

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

export interface CommunityReportUpdate {
  id: string;
  reportId: string;
  authorDisplayName: string;
  updateType: 'status_update' | 'additional_info' | 'safety_alert' | 'resolution_note';
  content: string;
  createdAt: string;
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
  sentiment: SentimentType;
  tags: string[];
  viewsCount: number;
  helpfulCount: number;
  isConfirmedByMe?: boolean;
  isHelpfulByMe?: boolean;
  isMyReport?: boolean;
  updates?: CommunityReportUpdate[];
}

export interface UserQuotaStatus {
  reportsUsedToday: number;
  reportsMaxDaily: number;
  reportsRemaining: number;
  updatesUsedToday: number;
  updatesMaxDaily: number;
  updatesRemaining: number;
  resetAt: string;
  activeRestriction?: {
    id: string;
    restrictionType: string;
    reasonCode: string;
    userMessage?: string;
    expiresAt: string;
    appealStatus: 'none' | 'pending' | 'accepted' | 'rejected';
  } | null;
}

interface CommunityUpdatesProps {
  language: AppLanguage;
  user: UserProfile | null;
  onOpenReportModal?: () => void;
}

// ── Anti-Empty & Anti-Dummy/Spam Text Validation ─────────────────────────────
const DUMMY_WORDS = new Set([
  'test', 'testing', 'tester', 'tested', 'asdf', 'asdfgh', 'asdfghjk', 'asdfghjkl',
  'qwerty', 'zxcv', 'zxcvbnm', 'dummy', 'fake', 'none', 'nothing', 'na', 'n/a',
  'null', 'undefined', '123', '1234', '12345', '123456', 'abc', 'abcd', 'abcde',
  'random', 'sample', 'foo', 'bar', 'baz', 'lorem', 'ipsum', 'bla', 'blah', 'blahblah',
  'hello', 'hi', 'hey', 'check', 'checking', 'aaaa', 'bbbb', 'cccc', 'dddd', 'xyz', 'demo'
]);

function validateTextContent(text: string, minLength: number): { valid: boolean; error?: string } {
  const clean = text.trim();
  if (!clean || clean.length < minLength) {
    return { valid: false, error: `Must be at least ${minLength} characters.` };
  }
  // Must contain meaningful alphabetic or Urdu characters (rejects purely numeric strings like '12345678')
  const letterCount = (clean.match(/[a-zA-Z\u0600-\u06FF]/g) || []).length;
  if (letterCount < 4) {
    return { valid: false, error: 'Please use genuine words (English or Urdu) rather than numbers or symbols.' };
  }
  // Reject common throwaway / test phrases
  const lowerText = clean.toLowerCase();
  if (/\b(just testing|test report|testing 123|please ignore|ignore this|dummy test|testing only|sample test|test complaint)\b/i.test(lowerText)) {
    return { valid: false, error: 'Test reports and placeholder entries are not allowed on the live community feed.' };
  }
  const uniqueChars = new Set(clean.toLowerCase().replace(/\s/g, '').split(''));
  if (uniqueChars.size < 4 && clean.length >= 8) {
    return { valid: false, error: 'Please enter meaningful text rather than repeated characters.' };
  }
  const normalized = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (DUMMY_WORDS.has(normalized)) {
    return { valid: false, error: 'Placeholder or test text is not permitted. Please describe a genuine safety issue.' };
  }
  const words = clean.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (words.length > 0 && words.every(w => DUMMY_WORDS.has(w))) {
    return { valid: false, error: 'Please enter a genuine safety description instead of placeholder words.' };
  }
  return { valid: true };
}

export const CommunityUpdates: React.FC<CommunityUpdatesProps> = ({
  language,
  user
}) => {
  const isUrdu = language === 'ur';

  // ── Main State ─────────────────────────────────────────────────────────────
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [regions, setRegions] = useState<CommunityRegion[]>([]);
  const [places, setPlaces] = useState<CommunityPlace[]>([]);
  const [quota, setQuota] = useState<UserQuotaStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // ── Filter States ──────────────────────────────────────────────────────────
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [selectedPlace, setSelectedPlace] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCorroboration, setSelectedCorroboration] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ── Modal & Form States ────────────────────────────────────────────────────
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>('general_safety');
  const [formRegionId, setFormRegionId] = useState<string>('umt');
  const [formPlaceId, setFormPlaceId] = useState<string>('');
  const [formSentiment, setFormSentiment] = useState<SentimentType>('uncomfortable');
  const [formTags, setFormTags] = useState<string[]>(['Poor Lighting', 'Quiet Corridor']);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);

  // ── Follow-Up Update Modal States ──────────────────────────────────────────
  const [selectedReportForUpdate, setSelectedReportForUpdate] = useState<CommunityReport | null>(null);
  const [updateContent, setUpdateContent] = useState<string>('');
  const [updateType, setUpdateType] = useState<'status_update' | 'safety_alert' | 'resolution_note'>('status_update');
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState<boolean>(false);
  const [updateValidationError, setUpdateValidationError] = useState<string | null>(null);

  // ── Appeal Modal States ────────────────────────────────────────────────────
  const [isAppealModalOpen, setIsAppealModalOpen] = useState<boolean>(false);
  const [appealReason, setAppealReason] = useState<string>('');
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState<boolean>(false);
  const [appealNotice, setAppealNotice] = useState<string | null>(null);

  // ── Map Search & Custom Area Modal States ──────────────────────────────────
  const [isMapSearchModalOpen, setIsMapSearchModalOpen] = useState<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = useState<string>('');
  const [mapSearchResults, setMapSearchResults] = useState<any[]>([]);
  const [isSearchingMap, setIsSearchingMap] = useState<boolean>(false);
  const [selectedMapPlace, setSelectedMapPlace] = useState<any | null>(null);
  const [customPlaceName, setCustomPlaceName] = useState<string>('');
  const [customPlaceRegionId, setCustomPlaceRegionId] = useState<string>('johar_town');
  const [isAddingPlace, setIsAddingPlace] = useState<boolean>(false);

  // ── Action Feedback State ──────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmingReportId, setConfirmingReportId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // ── Search OpenStreetMap via Nominatim ─────────────────────────────────────
  const handleSearchMap = async (q: string) => {
    if (!q.trim() || q.trim().length < 2) return;
    setIsSearchingMap(true);
    try {
      const res = await searchAddress(q.trim());
      setMapSearchResults(res);
      if (res.length > 0) {
        setSelectedMapPlace(res[0]);
        const nameGuess = res[0].road || res[0].suburb || res[0].displayName.split(',')[0];
        setCustomPlaceName(nameGuess);
      }
    } catch (err) {
      console.warn('Map search error:', err);
    } finally {
      setIsSearchingMap(false);
    }
  };

  // ── Save Custom Place to Backend & State ───────────────────────────────────
  const handleSaveCustomPlace = async () => {
    if (!customPlaceName.trim()) {
      showToast(isUrdu ? 'براہ کرم مقام کا نام درج کریں' : 'Please enter a name for the place.');
      return;
    }
    setIsAddingPlace(true);
    try {
      const res = await fetch('/api/community/places', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: customPlaceName.trim(),
          regionId: customPlaceRegionId,
          latitude: selectedMapPlace?.lat || null,
          longitude: selectedMapPlace?.lon || null,
          placeType: 'general'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not add custom location.');
        return;
      }
      if (data.place) {
        setPlaces(prev => [...prev.filter(p => p.id !== data.place.id), data.place]);
        setSelectedRegion(customPlaceRegionId);
        setSelectedPlace(data.place.id);
        setFormRegionId(customPlaceRegionId);
        setFormPlaceId(data.place.id);
      }
      setIsMapSearchModalOpen(false);
      setMapSearchQuery('');
      setMapSearchResults([]);
      setSelectedMapPlace(null);
      setCustomPlaceName('');
      showToast(isUrdu ? 'مقام نقشے سے کامیابی سے شامل کر دیا گیا!' : 'Location added and pinned to community places!');
    } catch {
      showToast('Could not save custom location.');
    } finally {
      setIsAddingPlace(false);
    }
  };

  // ── Reset Daily Quota (Testing & Demo) ─────────────────────────────────────
  const handleResetQuota = async () => {
    try {
      const res = await fetch('/api/community/quota/reset', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await fetchQuota();
        showToast(isUrdu ? 'کوٹہ کامیابی سے ری سیٹ ہو گیا!' : 'Daily quota reset successfully for testing!');
      }
    } catch {
      showToast('Could not reset quota.');
    }
  };

  // ── Fetch Regions & Places ─────────────────────────────────────────────────
  const fetchRegions = useCallback(async () => {
    try {
      const res = await fetch('/api/community/regions');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.regions)) setRegions(data.regions);
        if (Array.isArray(data.places)) setPlaces(data.places);
      }
    } catch (err) {
      console.warn('Could not load regions:', err);
    }
  }, []);

  // ── Fetch User Quota & Restrictions ────────────────────────────────────────
  const fetchQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/community/quota', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setQuota(data);
      }
    } catch (err) {
      console.warn('Could not load quota:', err);
    }
  }, []);

  // ── Fetch Published Community Reports ──────────────────────────────────────
  const fetchReports = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    else setIsRefreshing(true);
    setErrorNotice(null);

    try {
      const params = new URLSearchParams();
      if (selectedRegion !== 'all') params.set('region_id', selectedRegion);
      if (selectedPlace !== 'all') params.set('place_id', selectedPlace);
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (selectedCorroboration !== 'all') params.set('corroboration_status', selectedCorroboration);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/community/reports?${params.toString()}`, {
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        throw new Error('Could not fetch community reports');
      }

      const data = await res.json();
      if (Array.isArray(data.reports)) {
        setReports(data.reports);
      }
    } catch (err: any) {
      console.error('Error fetching reports:', err?.message);
      setErrorNotice(isUrdu ? 'رپورٹس لوڈ نہیں ہو سکیں۔ دوبارہ کوشش کریں۔' : 'Could not fetch community reports.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedRegion, selectedPlace, selectedCategory, selectedCorroboration, searchQuery, isUrdu]);

  // Initial Data Load
  useEffect(() => {
    void fetchRegions();
    void fetchQuota();
    void fetchReports();
  }, [fetchRegions, fetchQuota, fetchReports]);

  // ── Filter by Nearby GPS ───────────────────────────────────────────────────
  const handleNearbyFilter = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          // If in Lahore/Johar Town/UMT corridor, set to nearest region or Johar Town
          setSelectedRegion('johar_town');
          showToast(isUrdu ? 'قریبی علاقہ فلٹر: جوہر ٹاؤن' : 'Filtered to nearby area: Johar Town');
        },
        () => {
          showToast(isUrdu ? 'جی پی ایس غیر فعال ہے۔ دستی علاقہ منتخب کریں۔' : 'Location permission denied. Please choose manually.');
        },
        { timeout: 6000 }
      );
    } else {
      setSelectedRegion('umt');
    }
  };

  // ── Submit New Community Report ────────────────────────────────────────────
  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationError(null);

    // 1. Client-Side Anti-Empty & Anti-Dummy Validation
    const titleCheck = validateTextContent(formTitle, 5);
    if (!titleCheck.valid) {
      setFormValidationError(isUrdu ? 'براہ کرم واضح عنوان درج کریں (کم از کم 5 حروف)۔ ڈمی الفاظ منع ہیں۔' : titleCheck.error || 'Please enter a genuine title.');
      return;
    }

    const descCheck = validateTextContent(formDescription, 10);
    if (!descCheck.valid) {
      setFormValidationError(isUrdu ? 'براہ کرم مسئلے کی تفصیلی اور حقیقی وضاحت کریں (کم از کم 10 حروف)۔' : descCheck.error || 'Please enter a genuine description.');
      return;
    }

    if (!formRegionId) {
      setFormValidationError(isUrdu ? 'براہ کرم علاقہ یا یونیورسٹی کیمپس منتخب کریں۔' : 'Please select an area or campus.');
      return;
    }

    // 2. Daily Quota Check
    if (quota && quota.reportsRemaining <= 0) {
      setFormValidationError(
        isUrdu 
          ? 'آج کی 5 رپورٹس کی حد مکمل ہو چکی ہے۔ یہ کوٹہ رات 12 بجے خودکار ری سیٹ ہوگا۔'
          : "You have reached today's limit of 5 community reports. Quota resets at midnight PKT."
      );
      return;
    }

    setIsSubmittingReport(true);
    try {
      const regionObj = regions.find(r => r.id === formRegionId);
      const placeObj = formPlaceId ? places.find(p => p.id === formPlaceId) : null;
      const resolvedLocationName = placeObj 
        ? `${regionObj?.name || formRegionId} - ${placeObj.name}`
        : (regionObj?.name || 'Lahore, Punjab');

      const res = await fetch('/api/community/reports', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim(),
          category: formCategory,
          regionId: formRegionId,
          placeId: formPlaceId || null,
          locationName: resolvedLocationName,
          sentiment: formSentiment,
          tags: formTags,
          reporterName: user?.safeNickname || 'Community Guardian'
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setFormValidationError(data.error || 'Could not submit report.');
        return;
      }

      // Success! Update local feed & quota
      if (data.report) {
        setReports(prev => [data.report, ...prev]);
      }
      setIsShareModalOpen(false);
      setFormTitle('');
      setFormDescription('');
      void fetchQuota();
      showToast(isUrdu ? 'رپورٹ کامیابی سے کمیونٹی سیفٹی نیٹ ورک میں محفوظ کر دی گئی!' : 'Safety report published and saved permanently to community network!');
    } catch (err: any) {
      setFormValidationError(err?.message || 'Server error occurred while submitting.');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // ── Confirm / Corroborate an Existing Report ───────────────────────────────
  const handleConfirmReport = async (reportId: string) => {
    setConfirmingReportId(reportId);
    try {
      const res = await fetch(`/api/community/reports/${reportId}/confirm`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          confirmationType: 'observed'
        })
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Could not confirm report.');
        return;
      }

      // Optimistically update the corroborated report in feed
      setReports(prev => prev.map(r => {
        if (r.id === reportId) {
          return {
            ...r,
            corroborationCount: data.corroborationCount || r.corroborationCount + 1,
            corroborationStatus: data.corroborationStatus || r.corroborationStatus,
            corroborationNotes: data.corroborationNotes || r.corroborationNotes,
            isConfirmedByMe: true
          };
        }
        return r;
      }));

      showToast(isUrdu ? 'تصدیق محفوظ ہو گئی! شکریہ برائے کمیونٹی تعاون۔' : 'Issue corroborated! Your independent confirmation increases safety awareness.');
    } catch (err) {
      showToast('Could not corroborate issue.');
    } finally {
      setConfirmingReportId(null);
    }
  };

  // ── Add Follow-Up Update / Progress ────────────────────────────────────────
  const handleAddUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReportForUpdate) return;
    setUpdateValidationError(null);

    const updateCheck = validateTextContent(updateContent, 6);
    if (!updateCheck.valid) {
      setUpdateValidationError(isUrdu ? 'براہ کرم اپ ڈیٹ کی واضح اور حقیقی تفصیل درج کریں (کم از کم 6 حروف)۔' : updateCheck.error || 'Please enter valid update text.');
      return;
    }

    if (quota && quota.updatesRemaining <= 0) {
      setUpdateValidationError(isUrdu ? 'آج کی 5 اپ ڈیٹس کی حد مکمل ہو چکی ہے۔' : "You have reached today's limit of 5 updates.");
      return;
    }

    setIsSubmittingUpdate(true);
    try {
      const isResolution = updateType === 'resolution_note';
      const res = await fetch(`/api/community/reports/${selectedReportForUpdate.id}/updates`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          content: updateContent.trim(),
          updateType,
          isResolution,
          authorName: user?.safeNickname || 'Community Member'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setUpdateValidationError(data.error || 'Could not post update.');
        return;
      }

      // Attach new update to the report in local feed
      if (data.update) {
        setReports(prev => prev.map(r => {
          if (r.id === selectedReportForUpdate.id) {
            const curUpdates = r.updates || [];
            return {
              ...r,
              updates: [...curUpdates, data.update],
              ...(isResolution ? { status: 'resolved', corroborationStatus: 'resolved', resolvedNote: updateContent.trim() } : {})
            };
          }
          return r;
        }));
      }

      setSelectedReportForUpdate(null);
      setUpdateContent('');
      void fetchQuota();
      showToast(isUrdu ? 'اپ ڈیٹ تاریخ میں شامل کر دی گئی!' : 'Update attached to report history successfully.');
    } catch (err: any) {
      setUpdateValidationError(err?.message || 'Failed to submit update.');
    } finally {
      setIsSubmittingUpdate(false);
    }
  };

  // ── Toggle Helpful Upvote ──────────────────────────────────────────────────
  const handleToggleHelpful = async (reportId: string) => {
    // Optimistic UI toggle
    setReports(prev => prev.map(r => {
      if (r.id === reportId) {
        const isHelpful = Boolean(r.isHelpfulByMe);
        return {
          ...r,
          isHelpfulByMe: !isHelpful,
          helpfulCount: isHelpful ? Math.max(0, r.helpfulCount - 1) : r.helpfulCount + 1
        };
      }
      return r;
    }));

    try {
      await fetch(`/api/community/reports/${reportId}/helpful`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch {
      // Best effort
    }
  };

  // ── Share Report Link / Summary ────────────────────────────────────────────
  const handleShareReport = async (report: CommunityReport) => {
    const text = `Mehfooz Safety Report: ${report.title} at ${report.locationName} (${report.corroborationStatus === 'community_corroborated' ? 'Community Corroborated' : 'Verified'}). Check real-time safety on Mehfooz AI.`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: report.title,
          text,
          url: window.location.href
        });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    showToast(isUrdu ? 'رپورٹ کا متن کلپ بورڈ پر کاپی ہو گیا!' : 'Report summary copied to clipboard!');
  };

  // ── Submit Appeal Against Active Restriction ───────────────────────────────
  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quota?.activeRestriction) return;

    if (!appealReason || appealReason.trim().length < 10) {
      setAppealNotice(isUrdu ? 'براہ کرم اپیل کی مناسب وجہ درج کریں (کم از کم 10 حروف)۔' : 'Please provide a clear reason for your appeal (at least 10 characters).');
      return;
    }

    setIsSubmittingAppeal(true);
    try {
      const res = await fetch('/api/community/appeal', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          restrictionId: quota.activeRestriction.id,
          appealReason: appealReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setAppealNotice(data.error || 'Could not submit appeal.');
        return;
      }

      setIsAppealModalOpen(false);
      setAppealReason('');
      void fetchQuota();
      showToast(isUrdu ? 'آپ کی اپیل موڈریشن جائزہ کے لیے جمع ہو گئی ہے۔' : 'Your appeal has been submitted for moderation review.');
    } catch {
      setAppealNotice('Could not submit appeal.');
    } finally {
      setIsSubmittingAppeal(false);
    }
  };

  // Available tags for the creation modal
  const availableTags = [
    'Poor Lighting',
    'Quiet Corridor',
    'Heavy Traffic',
    'Police Present',
    'Road Construction',
    'Harassment Spot',
    'Safe Zone',
    'Well-lit Area',
    'Crowded'
  ];

  const handleToggleTag = (tag: string) => {
    setFormTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  // Filter places for currently selected form region
  const formPlaces = useMemo(() => {
    return places.filter(p => p.regionId === formRegionId);
  }, [places, formRegionId]);

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-4 text-[#1C2C34]">
      {/* ── 1. Top Header Banner ─────────────────────────────────────────── */}
      <div className="rounded-[28px] bg-white border border-slate-200/80 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#ECF4F4] text-[#1C2C34] border border-[#BCD4D4] flex items-center justify-center shadow-xs shrink-0">
              <Users className="w-5 h-5 text-[#FC7454]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1C2C34] truncate">
                {isUrdu ? 'کمیونٹی سیفٹی و تصدیق نیٹ ورک' : 'Community Safety & Corroboration'}
              </h2>
              <p className="text-[11px] text-[#6B7280] font-medium leading-tight truncate mt-0.5">
                {isUrdu ? 'مقام پر مبنی مستقل رپورٹس، 5-صارف تصدیق، اور انسدادِ اسپیم نیٹ ورک' : 'Location-aware persistent reports, 5-user corroboration & abuse controls'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (quota?.activeRestriction) {
                showToast(quota.activeRestriction.userMessage || 'Account restricted from posting.');
                return;
              }
              if (quota && quota.reportsRemaining <= 0) {
                showToast(isUrdu ? 'آج کی رپورٹس کی حد مکمل ہے۔ ڈیمو ٹیسٹنگ کے لیے نیچے کوٹہ ری سیٹ کریں۔' : 'Daily report limit reached (5/5). Click Reset Quota below to continue testing.');
              }
              setIsShareModalOpen(true);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition flex items-center space-x-1.5 whitespace-nowrap cursor-pointer shrink-0 bg-[#1C2C34] hover:bg-[#1C2C34]/90 text-white"
          >
            <Plus className="w-3.5 h-3.5 text-[#FC7454]" />
            <span>{isUrdu ? 'مسئلہ رپورٹ کریں' : 'Report Problem'}</span>
          </button>
        </div>

        {/* ── Daily Limit & Quota Live Pill ──────────────────────────────── */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center space-x-3 text-[#5A6E78]">
            <span className="flex items-center space-x-1">
              <FileText className="w-3 h-3 text-[#FC7454]" />
              <span>
                {isUrdu ? 'رپورٹس باقی:' : 'Reports Remaining:'} <strong>{quota ? quota.reportsRemaining : 5}/5</strong>
              </span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1">
              <MessageSquare className="w-3 h-3 text-emerald-600" />
              <span>
                {isUrdu ? 'اپ ڈیٹس باقی:' : 'Updates:'} <strong>{quota ? quota.updatesRemaining : 5}/5</strong>
              </span>
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 text-[10px] text-slate-400 font-mono">
              <Clock className="w-3 h-3" />
              <span>Resets midnight PKT</span>
            </div>
            <button
              onClick={handleResetQuota}
              title="Reset testing limits"
              className="text-[10px] font-bold text-[#FC7454] hover:underline cursor-pointer bg-[#ECF4F4] px-2 py-0.5 rounded-md border border-[#BCD4D4]"
            >
              {isUrdu ? 'ری سیٹ کوٹہ' : 'Reset Quota'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Active User Restriction / Ban Notice Banner ──────────────────── */}
      {quota?.activeRestriction && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-bold text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{isUrdu ? 'پوسٹنگ عارضی طور پر معطل ہے' : 'Temporary Posting Restriction Active'}</span>
            </div>
            <span className="text-[10px] bg-rose-200/60 text-rose-800 px-2 py-0.5 rounded font-mono font-bold">
              {quota.activeRestriction.reasonCode}
            </span>
          </div>
          <p className="text-xs text-rose-800 leading-relaxed">
            {quota.activeRestriction.userMessage || 'Due to repeated or duplicate submissions, your posting privileges are temporarily restricted.'}
          </p>
          <div className="flex items-center justify-between pt-1 border-t border-rose-200/60 text-[11px]">
            <span>Expires: {new Date(quota.activeRestriction.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} PKT</span>
            <button
              onClick={() => setIsAppealModalOpen(true)}
              className="text-xs font-bold text-rose-700 underline hover:text-rose-900 cursor-pointer"
            >
              {quota.activeRestriction.appealStatus === 'pending'
                ? (isUrdu ? 'اپیل زیرِ غور ہے' : 'Appeal Pending Review')
                : (isUrdu ? 'اپیل جمع کروائیں' : 'Submit Appeal')}
            </button>
          </div>
        </motion.div>
      )}

      {/* ── 2. Location Filtering Engine (Prompt #5) ───────────────────────── */}
      <div className="p-4 rounded-[24px] bg-white border border-slate-200/80 shadow-xs space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isUrdu ? 'رپورٹس، کیمپس یا مسئلہ تلاش کریں...' : 'Search reports, locations, or safety issues...'}
            className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
          />
        </div>

        {/* Quick Location Pills: All, Campuses, Top Neighborhoods, Nearby */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs font-bold">
          <button
            onClick={() => { setSelectedRegion('all'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'all'
                ? 'bg-[#1C2C34] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            {isUrdu ? 'تمام علاقے' : 'All Areas'}
          </button>

          <button
            onClick={() => { setSelectedRegion('ucp'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'ucp'
                ? 'bg-[#FC7454] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            UCP
          </button>

          <button
            onClick={() => { setSelectedRegion('umt'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'umt'
                ? 'bg-[#FC7454] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            UMT
          </button>

          <button
            onClick={() => { setSelectedRegion('uol'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'uol'
                ? 'bg-[#FC7454] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            UOL
          </button>

          <button
            onClick={() => { setSelectedRegion('johar_town'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'johar_town'
                ? 'bg-[#1C2C34] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            Johar Town
          </button>

          <button
            onClick={() => { setSelectedRegion('model_town'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'model_town'
                ? 'bg-[#1C2C34] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            Model Town
          </button>

          <button
            onClick={() => { setSelectedRegion('gulberg'); setSelectedPlace('all'); }}
            className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition cursor-pointer ${
              selectedRegion === 'gulberg'
                ? 'bg-[#1C2C34] text-white shadow-xs'
                : 'bg-slate-100 text-[#5A6E78] hover:bg-[#ECF4F4]'
            }`}
          >
            Gulberg
          </button>

          <button
            onClick={handleNearbyFilter}
            className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 whitespace-nowrap transition cursor-pointer flex items-center space-x-1"
          >
            <Navigation className="w-3 h-3 text-emerald-600" />
            <span>{isUrdu ? 'قریبی' : 'Nearby'}</span>
          </button>

          <button
            onClick={() => setIsMapSearchModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-[#ECF4F4] text-[#1C2C34] hover:bg-[#BCD4D4]/40 border border-[#BCD4D4] whitespace-nowrap transition cursor-pointer flex items-center space-x-1"
          >
            <Map className="w-3 h-3 text-[#FC7454]" />
            <span>{isUrdu ? '+ نیا مقام شامل کریں' : '+ Add on Map'}</span>
          </button>
        </div>

        {/* Dropdown Filters: Region, Specific Place, Corroboration Status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-xs">
          {/* Region Select */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
              {isUrdu ? 'علاقہ منتخب کریں' : 'Region / Campus'}
            </label>
            <select
              value={selectedRegion}
              onChange={(e) => {
                if (e.target.value === '__add_custom_map__') {
                  setIsMapSearchModalOpen(true);
                  return;
                }
                setSelectedRegion(e.target.value);
                setSelectedPlace('all');
              }}
              className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
            >
              <option value="all">{isUrdu ? 'تمام علاقے (لاہور و پنجاب)' : 'All Areas (Lahore & Punjab)'}</option>
              {regions.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value="__add_custom_map__" className="text-[#FC7454] font-bold">
                + {isUrdu ? 'نقشے پر نیا علاقہ تلاش کریں...' : 'Search & Add Area on Map...'}
              </option>
            </select>
          </div>

          {/* Place Select (when a region is selected) */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
              {isUrdu ? 'مخصوص مقام' : 'Specific Place'}
            </label>
            <select
              value={selectedPlace}
              disabled={selectedRegion === 'all'}
              onChange={(e) => {
                if (e.target.value === '__add_custom_map__') {
                  setCustomPlaceRegionId(selectedRegion !== 'all' ? selectedRegion : 'johar_town');
                  setIsMapSearchModalOpen(true);
                  return;
                }
                setSelectedPlace(e.target.value);
              }}
              className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454] disabled:opacity-50"
            >
              <option value="all">{isUrdu ? 'پورے علاقے میں' : 'Entire Area / All Places'}</option>
              {places
                .filter(p => p.regionId === selectedRegion)
                .map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              <option value="__add_custom_map__" className="text-[#FC7454] font-bold">
                + {isUrdu ? 'نقشے پر مخصوص مقام تلاش کریں...' : 'Search & Add Specific Place on Map...'}
              </option>
            </select>
          </div>

          {/* Verification Status Filter */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
              {isUrdu ? 'تصدیقی حیثیت' : 'Corroboration'}
            </label>
            <select
              value={selectedCorroboration}
              onChange={(e) => setSelectedCorroboration(e.target.value)}
              className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
            >
              <option value="all">{isUrdu ? 'تمام اسٹیٹس' : 'All Corroboration'}</option>
              <option value="community_corroborated">{isUrdu ? '5+ تصدیق شدہ (Corroborated)' : 'Community Corroborated (5+)'}</option>
              <option value="multiple_reports">{isUrdu ? 'متعدد رپورٹس (2-4)' : 'Multiple Reports (2-4)'}</option>
              <option value="single_report">{isUrdu ? 'ابتدائی رپورٹ' : 'Single Report'}</option>
              <option value="resolved">{isUrdu ? 'حل شدہ' : 'Resolved'}</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── 3. Reports Feed List ─────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Loading Spinner */}
        {isLoading && (
          <div className="py-12 text-center space-y-2 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#FC7454]" />
            <p className="text-xs">{isUrdu ? 'رپورٹس لوڈ ہو رہی ہیں...' : 'Loading verified community reports...'}</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && reports.length === 0 && (
          <div className="p-8 rounded-[28px] bg-white border border-slate-200/80 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-[#ECF4F4] text-[#FC7454] flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#1C2C34]">
                {isUrdu ? 'کوئی فعال مسئلہ رپورٹ نہیں ہوا' : 'No Safety Issues Reported in this Area'}
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                {isUrdu 
                  ? 'اس علاقے میں فی الحال کوئی مسئلہ یا الرٹ درج نہیں۔ آپ اپنا مشاہدہ شیئر کر سکتے ہیں۔'
                  : 'This area currently has no corroborated reports. You can submit an observation to alert the network.'}
              </p>
            </div>
            <button
              onClick={() => setIsShareModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-[#1C2C34] text-white text-xs font-bold shadow-xs hover:bg-[#1C2C34]/90 cursor-pointer"
            >
              {isUrdu ? 'پہلی رپورٹ درج کریں' : 'Submit First Report'}
            </button>
          </div>
        )}

        {/* Reports Cards */}
        {!isLoading && reports.map((report) => {
          const isCorroborated = report.corroborationStatus === 'community_corroborated';
          const isMultiple = report.corroborationStatus === 'multiple_reports';
          const isResolved = report.status === 'resolved' || report.corroborationStatus === 'resolved';

          return (
            <div
              key={report.id}
              className={`rounded-3xl bg-white border transition-all p-4.5 space-y-3 shadow-xs ${
                isCorroborated
                  ? 'border-emerald-300 ring-1 ring-emerald-200/50'
                  : isMultiple
                    ? 'border-amber-200'
                    : 'border-slate-200/80'
              }`}
            >
              {/* Card Header: Corroboration Badge & Location */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    {/* Status Badge */}
                    {isCorroborated && (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black tracking-wide border border-emerald-300 uppercase">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Community Corroborated • {report.corroborationCount} Independent Reports</span>
                      </span>
                    )}
                    {isMultiple && (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black tracking-wide border border-amber-300 uppercase">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>Multiple Reports ({report.corroborationCount})</span>
                      </span>
                    )}
                    {isResolved && (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-black tracking-wide border border-blue-300 uppercase">
                        <Check className="w-3 h-3 text-blue-600" />
                        <span>Resolved Issue</span>
                      </span>
                    )}
                    {!isCorroborated && !isMultiple && !isResolved && (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200 uppercase">
                        <span>Single Observation</span>
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-[#1C2C34] leading-snug">
                    {report.title}
                  </h3>
                </div>

                {/* Location indicator */}
                <div className="flex items-center space-x-1 text-xs text-[#5A6E78] shrink-0 font-medium bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-100">
                  <MapPin className="w-3.5 h-3.5 text-[#FC7454]" />
                  <span className="max-w-[130px] truncate">{report.locationName}</span>
                </div>
              </div>

              {/* Description Body */}
              <p className="text-xs text-[#374151] leading-relaxed whitespace-pre-line">
                {report.description}
              </p>

              {/* Corroboration Subtitle Note */}
              {isCorroborated && (
                <div className="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/70 text-[11px] text-emerald-900 flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{report.corroborationNotes || '5 distinct independent community reports confirm recurring safety concerns in this sector. Not legal proof.'}</span>
                </div>
              )}

              {/* Resolution Note if resolved */}
              {isResolved && report.resolvedNote && (
                <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] text-blue-900 space-y-0.5">
                  <span className="font-bold block text-blue-800">Resolution Update:</span>
                  <p>{report.resolvedNote}</p>
                </div>
              )}

              {/* Tags */}
              {Array.isArray(report.tags) && report.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {report.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-[#ECF4F4] text-[#1C2C34] text-[10px] font-semibold border border-[#BCD4D4]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Updates History attached to this report */}
              {Array.isArray(report.updates) && report.updates.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                    {isUrdu ? 'پیش رفت اور اپ ڈیٹس' : 'Follow-Up Updates & Progress:'}
                  </span>
                  <div className="space-y-1.5 pl-2 border-l-2 border-[#BCD4D4]">
                    {report.updates.map(u => (
                      <div key={u.id} className="text-[11px] space-y-0.5">
                        <div className="flex items-center space-x-1.5 text-slate-400 text-[10px]">
                          <span className="font-bold text-[#1C2C34]">{u.authorDisplayName}</span>
                          <span>•</span>
                          <span>{new Date(u.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-[#4B5563]">{u.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions Footer: Confirm, Add Update, Helpful, Share */}
              <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-2">
                  {/* Corroborate / Confirm Button */}
                  <button
                    onClick={() => handleConfirmReport(report.id)}
                    disabled={report.isConfirmedByMe || confirmingReportId === report.id}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center space-x-1.5 cursor-pointer ${
                      report.isConfirmedByMe
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                        : 'bg-[#1C2C34] text-white hover:bg-[#1C2C34]/90 shadow-xs'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{report.isConfirmedByMe ? (isUrdu ? 'آپ کی تصدیق شامل ہے' : 'Confirmed by you') : (isUrdu ? 'میں نے بھی دیکھا (تصدیق)' : 'Confirm Similar Issue')}</span>
                  </button>

                  {/* Add Update Button */}
                  <button
                    onClick={() => setSelectedReportForUpdate(report)}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#ECF4F4] text-[#1C2C34] font-bold text-xs border border-slate-200 transition cursor-pointer flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3 text-[#FC7454]" />
                    <span>{isUrdu ? 'اپ ڈیٹ شامل کریں' : 'Add Update'}</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  {/* Helpful Button */}
                  <button
                    onClick={() => handleToggleHelpful(report.id)}
                    className={`px-2.5 py-1.5 rounded-xl transition cursor-pointer flex items-center space-x-1 ${
                      report.isHelpfulByMe
                        ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200'
                        : 'hover:bg-slate-100 text-slate-500'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Helpful ({report.helpfulCount})</span>
                  </button>

                  {/* Share Report */}
                  <button
                    onClick={() => handleShareReport(report)}
                    title="Share report"
                    className="p-1.5 rounded-xl text-slate-400 hover:text-[#1C2C34] hover:bg-slate-100 transition cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 4. CREATE REPORT MODAL ───────────────────────────────────────── */}
      <AnimatePresence>
        {isShareModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-[#1C2C34]"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-[#1C2C34]">
                    {isUrdu ? 'کمیونٹی سیفٹی مسئلہ رپورٹ کریں' : 'Report Community Safety Issue'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {isUrdu ? 'حقیقی مشاہدہ شیئر کریں۔ 5 آزاد رپورٹس پر خودکار تصدیق ہوتی ہے۔' : 'Share a verified safety concern. Corroborated when 5 independent users report.'}
                  </p>
                </div>
                <button
                  onClick={() => setIsShareModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#1C2C34] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Validation Error Banner */}
              {formValidationError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formValidationError}</span>
                </div>
              )}

              <form onSubmit={handleCreateReport} className="space-y-3.5">
                {/* Title */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#1C2C34]">
                    {isUrdu ? 'عنوان (کم از کم 5 حروف) *' : 'Title (At least 5 characters) *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder={isUrdu ? 'مثال: یو ایم ٹی مین گیٹ کے قریب اسٹریٹ لائٹس بند ہیں' : 'e.g. Broken streetlights near UMT North Gate corridor'}
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-3 py-2 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  />
                </div>

                {/* Category & Region */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#1C2C34]">
                      {isUrdu ? 'مسئلے کی قسم *' : 'Category *'}
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                    >
                      <option value="poor_lighting">Poor Lighting / Dark Corridor</option>
                      <option value="harassment">Harassment / Loitering</option>
                      <option value="unsafe_area">Unsafe Public Area</option>
                      <option value="suspicious_activity">Suspicious Activity</option>
                      <option value="infrastructure">Infrastructure Hazard</option>
                      <option value="transport_hazard">Transport Stop Hazard</option>
                      <option value="fraud_scam">Fraud / Scam Zone</option>
                      <option value="general_safety">General Safety Warning</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[#1C2C34]">
                      {isUrdu ? 'علاقہ / یونیورسٹی *' : 'Region / University *'}
                    </label>
                    <select
                      value={formRegionId}
                      onChange={(e) => {
                        setFormRegionId(e.target.value);
                        setFormPlaceId('');
                      }}
                      className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                    >
                      {regions.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Specific Place (Optional) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#1C2C34]">
                      {isUrdu ? 'مخصوص گیٹ یا اسٹاپ (اختیاری)' : 'Specific Gate / Campus Stop (Optional)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomPlaceRegionId(formRegionId);
                        setIsMapSearchModalOpen(true);
                      }}
                      className="text-[11px] font-bold text-[#FC7454] hover:underline flex items-center space-x-1 cursor-pointer"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>{isUrdu ? '+ نقشے پر پن کریں' : '+ Pin on Map'}</span>
                    </button>
                  </div>
                  <select
                    value={formPlaceId}
                    onChange={(e) => {
                      if (e.target.value === '__add_custom_map__') {
                        setCustomPlaceRegionId(formRegionId);
                        setIsMapSearchModalOpen(true);
                        return;
                      }
                      setFormPlaceId(e.target.value);
                    }}
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  >
                    <option value="">-- General area (No specific sublocation) --</option>
                    {formPlaces.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    <option value="__add_custom_map__" className="text-[#FC7454] font-bold">
                      + {isUrdu ? 'نقشے پر نیا مقام تلاش کریں...' : 'Search & Pin Custom Place on Map...'}
                    </option>
                  </select>
                </div>

                {/* Description Narrative */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#1C2C34]">
                      {isUrdu ? 'تفصیلی مشاہدہ (کم از کم 10 حروف) *' : 'Description of Issue (At least 10 characters) *'}
                    </label>
                    <span className="text-[10px] text-slate-400">Genuine details only</span>
                  </div>
                  <textarea
                    rows={3}
                    required
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Explain what is unsafe (e.g. flickering lights near pedestrian walkway, group loitering after 8 PM, road digging without barriers)..."
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl p-3 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  />
                </div>

                {/* Sentiment Level */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#1C2C34]">
                    {isUrdu ? 'سیفٹی احساس کی درجہ بندی *' : 'Safety Severity / Feeling *'}
                  </label>
                  <SentimentPicker
                    value={formSentiment}
                    onChange={(val) => setFormSentiment(val)}
                    isUrdu={isUrdu}
                  />
                </div>

                {/* Quick Tags */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[#1C2C34]">
                    {isUrdu ? 'ٹیگز (منتخب کریں)' : 'Quick Safety Tags'}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.map((tag) => {
                      const isSelected = formTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => handleToggleTag(tag)}
                          className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#1C2C34] text-white border-[#1C2C34] shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-[#5A6E78] hover:bg-[#ECF4F4]'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingReport ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-[#FC7454]" />
                      <span>{isUrdu ? 'رپورٹ محفوظ ہو رہی ہے...' : 'Saving to community network...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 text-[#FC7454]" />
                      <span>{isUrdu ? 'رپورٹ شائع کریں (مستقل محفوظ)' : 'Publish Persistent Report'}</span>
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 5. ADD UPDATE / FOLLOW-UP MODAL ──────────────────────────────── */}
      <AnimatePresence>
        {selectedReportForUpdate && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-[#1C2C34]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-[#1C2C34]">
                    {isUrdu ? 'اپ ڈیٹ یا پیش رفت شامل کریں' : 'Add Follow-Up Update'}
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate max-w-xs">
                    {selectedReportForUpdate.title}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedReportForUpdate(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#1C2C34] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {updateValidationError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {updateValidationError}
                </div>
              )}

              <form onSubmit={handleAddUpdate} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#1C2C34]">
                    {isUrdu ? 'اپ ڈیٹ کی نوعیت' : 'Update Type'}
                  </label>
                  <select
                    value={updateType}
                    onChange={(e: any) => setUpdateType(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-[#1C2C34]"
                  >
                    <option value="status_update">Status Update / Observation</option>
                    <option value="safety_alert">Urgent Safety Warning</option>
                    <option value="resolution_note">Problem Has Been Resolved</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#1C2C34]">
                    {isUrdu ? 'تفصیل (کم از کم 6 حروف) *' : 'Update Details (At least 6 characters) *'}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={updateContent}
                    onChange={(e) => setUpdateContent(e.target.value)}
                    placeholder="e.g. Police van arrived, streetlights repaired by municipal team, or caution still advised..."
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl p-3 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingUpdate}
                  className="w-full py-3 rounded-xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  {isSubmittingUpdate ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-[#FC7454]" />
                  ) : (
                    <span>{isUrdu ? 'اپ ڈیٹ منسلک کریں' : 'Attach Update to Report'}</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 6. SUBMIT APPEAL MODAL ───────────────────────────────────────── */}
      <AnimatePresence>
        {isAppealModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-[#1C2C34]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-[#1C2C34]">
                  {isUrdu ? 'پوسٹنگ پابندی کے خلاف اپیل' : 'Appeal Posting Restriction'}
                </h3>
                <button
                  onClick={() => setIsAppealModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#1C2C34] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {appealNotice && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {appealNotice}
                </div>
              )}

              <form onSubmit={handleSubmitAppeal} className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  {isUrdu 
                    ? 'اگر آپ سمجھتے ہیں کہ یہ پابندی غلطی سے عائد ہوئی ہے تو تفصیل درج کریں۔ ایڈمن موڈریٹر جائزہ لے کر فیصلہ کرے گا۔'
                    : 'If you believe this temporary restriction was applied in error or have clarification, provide your reason for human moderation review.'}
                </p>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#1C2C34]">
                    {isUrdu ? 'اپیل کی وجہ (کم از کم 10 حروف) *' : 'Reason for Appeal (At least 10 characters) *'}
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)}
                    placeholder="Provide context explaining why your report was genuine..."
                    className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl p-3 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingAppeal}
                  className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  {isSubmittingAppeal ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>{isUrdu ? 'اپیل جمع کروائیں' : 'Submit Appeal for Review'}</span>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 5. MAP SEARCH & PIN CUSTOM LOCATION MODAL ─────────────────────── */}
      <AnimatePresence>
        {isMapSearchModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-[#1C2C34]"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#ECF4F4] border border-[#BCD4D4] flex items-center justify-center">
                    <Map className="w-4 h-4 text-[#FC7454]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#1C2C34]">
                      {isUrdu ? 'نقشے پر مقام تلاش کر کے شامل کریں' : 'Search & Pin Custom Area on Map'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {isUrdu ? 'اوپن اسٹریٹ میپ پر کیمپس یا محلہ تلاش کریں' : 'OpenStreetMap live search for campuses, stops & neighborhoods'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsMapSearchModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#1C2C34] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Bar */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#1C2C34]">
                  {isUrdu ? 'علاقہ، گیٹ، یا اسٹاپ تلاش کریں' : 'Search Area, Gate, or Landmark'}
                </label>
                <div className="flex items-center space-x-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={mapSearchQuery}
                      onChange={(e) => setMapSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSearchMap(mapSearchQuery);
                        }
                      }}
                      placeholder="e.g. UCP Gate 1, Barkat Market, Wapda Town..."
                      className="w-full bg-[#F8F9FA] border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSearchMap(mapSearchQuery)}
                    disabled={isSearchingMap || !mapSearchQuery.trim()}
                    className="px-3.5 py-2 rounded-xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                  >
                    {isSearchingMap ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    <span>{isUrdu ? 'تلاش' : 'Search'}</span>
                  </button>
                </div>

                {/* Quick Suggestion Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['UCP Khayaban-e-Jinnah', 'UMT C-Block', 'UOL Defence Road', 'Emporium Mall', 'Liberty Market', 'Barkat Market', 'DHA Phase 5', 'Model Town Central Park'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setMapSearchQuery(s);
                        handleSearchMap(s);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-[#ECF4F4] text-slate-600 hover:text-[#1C2C34] text-[10px] font-medium border border-slate-200 transition cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Results List */}
              {mapSearchResults.length > 0 && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {isUrdu ? 'نقشے کے نتائج (منتخب کریں):' : 'Map Search Results (Select to Pin):'}
                  </span>
                  {mapSearchResults.map((item, idx) => {
                    const isSelected = selectedMapPlace?.displayName === item.displayName;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedMapPlace(item);
                          const guess = item.road || item.suburb || item.displayName.split(',')[0];
                          setCustomPlaceName(guess);
                        }}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer transition flex items-start space-x-2.5 ${
                          isSelected
                            ? 'bg-[#ECF4F4] border-[#BCD4D4] ring-1 ring-[#BCD4D4]'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <MapPin className="w-4 h-4 text-[#FC7454] shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[#1C2C34] truncate">
                            {item.road || item.suburb || item.displayName.split(',')[0]}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {item.displayName}
                          </p>
                          <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono mt-1">
                            <span>Lat: {item.lat.toFixed(4)}</span>
                            <span>•</span>
                            <span>Lon: {item.lon.toFixed(4)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pin Details & Assignment Form */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#1C2C34]">
                    {isUrdu ? 'مقام کا نام (مخصوص گیٹ / روڈ / موڑ)' : 'Location / Landmark Display Name *'}
                  </label>
                  <input
                    type="text"
                    value={customPlaceName}
                    onChange={(e) => setCustomPlaceName(e.target.value)}
                    placeholder="e.g. Back Gate Hostel Lane / Metro Feeder Shelter"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#1C2C34]">
                    {isUrdu ? 'متعلقہ علاقہ یا کیمپس منتخب کریں *' : 'Associate with Campus / Region *'}
                  </label>
                  <select
                    value={customPlaceRegionId}
                    onChange={(e) => setCustomPlaceRegionId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                  >
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedMapPlace && (
                  <div className="flex items-center justify-between text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-xl border border-emerald-200">
                    <span className="flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>GPS Pinned ({selectedMapPlace.lat.toFixed(4)}, {selectedMapPlace.lon.toFixed(4)})</span>
                    </span>
                    <span className="font-mono text-[10px] text-emerald-600">OpenStreetMap Verified</span>
                  </div>
                )}
              </div>

              {/* Save Button */}
              <button
                type="button"
                onClick={handleSaveCustomPlace}
                disabled={isAddingPlace || !customPlaceName.trim()}
                className="w-full py-3 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {isAddingPlace ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-[#FC7454]" />
                    <span>{isUrdu ? 'مقام شامل ہو رہا ہے...' : 'Pinning Location...'}</span>
                  </>
                ) : (
                  <>
                    <MapPin className="w-4 h-4 text-[#FC7454]" />
                    <span>{isUrdu ? 'یہ مقام شامل کریں اور منتخب کریں' : 'Confirm & Add Custom Place'}</span>
                  </>
                )}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Toast Notification ──────────────────────────────────────────── */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#1C2C34] text-white text-xs font-semibold rounded-full shadow-lg border border-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}
    </div>
  );
};
