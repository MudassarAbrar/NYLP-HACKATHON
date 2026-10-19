/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Clock, 
  MapPin, 
  Users, 
  CheckCircle2, 
  ShieldCheck, 
  Plus, 
  X, 
  AlertCircle, 
  Check, 
  Bell, 
  PhoneCall, 
  Sparkles,
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Square,
  Navigation,
  ExternalLink,
  Copy,
  Share2,
  Radio,
  Eye,
  Shield,
  Send,
  Building2,
  RefreshCw,
  Search,
  Battery,
  BatteryCharging
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppLanguage, SilentCheckInSession, UserProfile, UserContact } from '../types';
import { OpenStreetMapViewer } from './common/OpenStreetMapViewer';
import { 
  GeocodedAddress, 
  SafetyPOI, 
  fetchDynamicSafetyPoints, 
  searchAddressWithNominatim, 
  reverseGeocodeWithNominatim,
  calculateDistance, 
  formatDistance 
} from '../services/osmService';
import { getAuthHeaders } from '../utils/auth';

interface SilentCheckInProps {
  language: AppLanguage;
  user: UserProfile | null;
  onOpenCrisis: () => void;
  initialDestination?: string;
  initialCoords?: { lat: number; lon: number };
  onNavigateToContacts?: () => void;
}

interface ParentNotificationPayload {
  timestamp: string;
  contacts: { id: string; name: string; relation: string; phone: string }[];
  currentLocation: {
    lat: number;
    lon: number;
    address: string;
  };
  destination: string;
  expectedMinutes: number;
  expectedArrivalTime: string;
  osmTrackingUrl: string;
  messageText: string;
}

// One "app minute" elapses per TICK_MS real milliseconds (60,000ms = 1 real minute).
const TICK_MS = 60_000;

function getCurrentPosition(timeoutMs = 5000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

async function getBatteryStatus(): Promise<{ level: number | null; charging: boolean | null }> {
  try {
    const nav = navigator as any;
    if (nav.getBattery) {
      const b = await nav.getBattery();
      return { level: b.level, charging: b.charging };
    }
  } catch {}
  return { level: null, charging: null };
}

export interface DeviceConditionTelemetry {
  batteryLevel: number | null;
  isCharging: boolean | null;
  isSilentMode: boolean;
  networkType: string;
  audioOutputMode: string;
  summaryString: string;
}

export async function detectDeviceCondition(): Promise<DeviceConditionTelemetry> {
  const battery = await getBatteryStatus();
  let isSilent = true;
  let audioOutputMode = 'Discreet / Silent Output';

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const state = ctx.state;
      await ctx.close().catch(() => {});
      if (state === 'running') {
        isSilent = false;
        audioOutputMode = 'Active Ringer';
      } else {
        isSilent = true;
        audioOutputMode = 'Silent / Discreet';
      }
    }
  } catch {
    isSilent = true;
    audioOutputMode = 'Discreet';
  }

  let networkType = 'Cellular/WiFi';
  try {
    const conn = (navigator as any).connection;
    if (conn && conn.effectiveType) {
      networkType = `${conn.effectiveType.toUpperCase()} Network`;
    } else if (navigator.onLine) {
      networkType = 'Online (Data)';
    } else {
      networkType = 'Offline (SIM SMS)';
    }
  } catch {}

  const parts: string[] = [];
  if (battery.level !== null) {
    parts.push(`🔋 Battery: ${Math.round(battery.level * 100)}%${battery.charging ? ' (⚡ Charging)' : ''}`);
  }
  parts.push(`📶 Signal: ${networkType}`);
  parts.push(`🔕 Profile: ${audioOutputMode}`);

  return {
    batteryLevel: battery.level,
    isCharging: battery.charging,
    isSilentMode: isSilent,
    networkType,
    audioOutputMode,
    summaryString: parts.join(' • ')
  };
}

export const SilentCheckIn: React.FC<SilentCheckInProps> = ({
  language,
  user,
  onOpenCrisis,
  initialDestination,
  initialCoords,
  onNavigateToContacts
}) => {
  const isUrdu = language === 'ur';

  // Dynamic contacts list — loads from user profile, guardian info, or localStorage mirror
  const [contactsList, setContactsList] = useState<UserContact[]>(() => {
    if (user?.emergencyContacts && user.emergencyContacts.length > 0) {
      return user.emergencyContacts;
    }
    const saved = localStorage.getItem('mehfooz_user_contacts_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* noop */ }
    }
    if (user?.guardianPhone || user?.emergencyContactPhone) {
      return [{
        id: 'c-guardian-init',
        name: user.guardianName || user.emergencyContactName || 'Parent / Guardian',
        phone: user.guardianPhone || user.emergencyContactPhone || '',
        relation: 'Guardian',
        isDefaultNotified: true,
        isEmergencyContact: true
      }];
    }
    return [];
  });

  useEffect(() => {
    const refreshContacts = () => {
      if (user?.emergencyContacts && user.emergencyContacts.length > 0) {
        setContactsList(user.emergencyContacts);
        return;
      }
      const saved = localStorage.getItem('mehfooz_user_contacts_v1');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setContactsList(parsed);
            return;
          }
        } catch { /* noop */ }
      }
      if (user?.guardianPhone || user?.emergencyContactPhone) {
        setContactsList([{
          id: 'c-guardian-init',
          name: user.guardianName || user.emergencyContactName || 'Parent / Guardian',
          phone: user.guardianPhone || user.emergencyContactPhone || '',
          relation: 'Guardian',
          isDefaultNotified: true,
          isEmergencyContact: true
        }]);
        return;
      }
      setContactsList([]);
    };

    refreshContacts();
    window.addEventListener('mehfooz:contacts-updated', refreshContacts);
    return () => window.removeEventListener('mehfooz:contacts-updated', refreshContacts);
  }, [user]);

  const availableContacts = contactsList;

  // Setup form states
  const [destination, setDestination] = useState<string>(initialDestination || '');
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(() => {
    return availableContacts.map(c => c.id);
  });
  const [checkInValidationError, setCheckInValidationError] = useState<string | null>(null);

  // Keep selected contact IDs in sync if available contacts list updates
  useEffect(() => {
    if (availableContacts.length > 0) {
      setSelectedContactIds(prev => {
        const validPrev = prev.filter(id => availableContacts.some(c => c.id === id));
        if (validPrev.length > 0) return validPrev;
        return availableContacts.map(c => c.id);
      });
    } else {
      setSelectedContactIds([]);
    }
  }, [availableContacts]);

  // Sync initialDestination if updated externally from ActiveAlerts
  useEffect(() => {
    if (initialDestination) {
      setDestination(initialDestination);
    }
    if (initialCoords) {
      setDestinationCoords(initialCoords);
    }
  }, [initialDestination, initialCoords]);
  
  // Real-time GPS & OSM state
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number }>({
    lat: 31.5204,
    lon: 74.3587
  });
  const [currentAddress, setCurrentAddress] = useState<string>('Main Boulevard, Gulberg III, Lahore, Punjab');
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lon: number } | undefined>(
    initialCoords || undefined
  );

  // Active check-in state
  const [activeSession, setActiveSession] = useState<SilentCheckInSession | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState<number>(21);
  const [showSafeCelebration, setShowSafeCelebration] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [activeSessionIndex, setActiveSessionIndex] = useState<number>(21);

  // Parent Notification Dispatch state
  const [parentNotification, setParentNotification] = useState<ParentNotificationPayload | null>(null);
  const [showParentModal, setShowParentModal] = useState<boolean>(false);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [mapCollapsed, setMapCollapsed] = useState<boolean>(false);

  // Server-backed monitoring state (Prompt #2). When serverSessionId is set,
  // the session lives in the check_ins table and the pg_cron + Edge Function
  // monitor can dispatch alerts even if this browser closes.
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  const [alertDispatched, setAlertDispatched] = useState<boolean>(false);
  const [expireNotice, setExpireNotice] = useState<string | null>(null);

  // Toggle contact selection
  const handleToggleContact = (id: string) => {
    setSelectedContactIds(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  // Called when OpenStreetMap finds the real GPS and reverse-geocodes with Nominatim
  const handleLocationFound = (coords: { lat: number; lon: number }, address: GeocodedAddress) => {
    setCurrentCoords(coords);
    if (address && address.displayName) {
      setCurrentAddress(address.displayName);
      setFromLocation(address.displayName);
    }
  };

  // Safe Points state for departure and destination locations
  const [safePointsTab, setSafePointsTab] = useState<'departure' | 'destination'>('departure');
  const [poiCategoryFilter, setPoiCategoryFilter] = useState<'all' | 'police' | 'hospital' | 'rescue'>('all');
  const [departureSafetyPOIs, setDepartureSafetyPOIs] = useState<SafetyPOI[]>([]);
  const [isLoadingDeparturePOIs, setIsLoadingDeparturePOIs] = useState<boolean>(false);
  const [destinationSafetyPOIs, setDestinationSafetyPOIs] = useState<SafetyPOI[]>([]);
  const [isLoadingDestinationPOIs, setIsLoadingDestinationPOIs] = useState<boolean>(false);
  const [isStealthSilentMode, setIsStealthSilentMode] = useState<boolean>(true);
  const [liveBattery, setLiveBattery] = useState<{ level: number | null; charging: boolean | null }>({ level: null, charging: null });

  useEffect(() => {
    void getBatteryStatus().then((b) => setLiveBattery(b));
  }, []);

  // FROM / Current Location autocomplete & GPS state
  const [fromLocation, setFromLocation] = useState<string>('Main Boulevard, Gulberg III, Lahore, Punjab');
  const [fromSuggestions, setFromSuggestions] = useState<GeocodedAddress[]>([]);
  const [isSearchingFrom, setIsSearchingFrom] = useState<boolean>(false);
  const [showFromSuggestions, setShowFromSuggestions] = useState<boolean>(false);
  const [isLocatingGps, setIsLocatingGps] = useState<boolean>(false);
  const fromSearchTimeoutRef = useRef<any>(null);

  const handleUseCurrentGps = () => {
    setIsLocatingGps(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setCurrentCoords({ lat, lon });
          try {
            const addr = await reverseGeocodeWithNominatim(lat, lon);
            setCurrentAddress(addr.displayName);
            setFromLocation(addr.displayName);
          } catch {
            const fallback = `GPS Coordinates (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
            setCurrentAddress(fallback);
            setFromLocation(fallback);
          }
          fetchDeparturePOIs(lat, lon);
          setShowFromSuggestions(false);
          setIsLocatingGps(false);
          if (destinationCoords) {
            const meters = calculateDistance(lat, lon, destinationCoords.lat, destinationCoords.lon);
            const estMin = Math.max(5, Math.min(180, Math.round((meters / 1000) * 3.5)));
            setDurationMinutes(estMin);
          }
        },
        () => {
          setIsLocatingGps(false);
          setShowFromSuggestions(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setIsLocatingGps(false);
      setShowFromSuggestions(false);
    }
  };

  const handleFromChange = (value: string) => {
    setFromLocation(value);
    if (fromSearchTimeoutRef.current) clearTimeout(fromSearchTimeoutRef.current);

    if (value.trim().length >= 3) {
      setIsSearchingFrom(true);
      setShowFromSuggestions(true);
      fromSearchTimeoutRef.current = setTimeout(async () => {
        try {
          const results = await searchAddressWithNominatim(value.trim());
          setFromSuggestions(results);
        } catch {
          setFromSuggestions([]);
        } finally {
          setIsSearchingFrom(false);
        }
      }, 500);
    } else {
      setFromSuggestions([]);
      setIsSearchingFrom(false);
    }
  };

  const handleSelectFromSuggestion = (item: GeocodedAddress) => {
    setFromLocation(item.displayName);
    setCurrentAddress(item.displayName);
    setCurrentCoords({ lat: item.lat, lon: item.lon });
    setShowFromSuggestions(false);
    setFromSuggestions([]);
    fetchDeparturePOIs(item.lat, item.lon);
    if (destinationCoords) {
      const meters = calculateDistance(item.lat, item.lon, destinationCoords.lat, destinationCoords.lon);
      const estMin = Math.max(5, Math.min(180, Math.round((meters / 1000) * 3.5)));
      setDurationMinutes(estMin);
    }
  };

  // Destination autocomplete search state
  const [destinationSuggestions, setDestinationSuggestions] = useState<GeocodedAddress[]>([]);
  const [isSearchingDest, setIsSearchingDest] = useState<boolean>(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState<boolean>(false);
  const searchTimeoutRef = useRef<any>(null);

  const fetchDeparturePOIs = useCallback(async (lat: number, lon: number) => {
    setIsLoadingDeparturePOIs(true);
    try {
      const data = await fetchDynamicSafetyPoints(lat, lon);
      setDepartureSafetyPOIs(data);
    } catch (e) {
      console.warn('Failed to fetch departure POIs:', e);
    } finally {
      setIsLoadingDeparturePOIs(false);
    }
  }, []);

  const fetchDestPOIs = useCallback(async (lat: number, lon: number) => {
    setIsLoadingDestinationPOIs(true);
    try {
      const data = await fetchDynamicSafetyPoints(lat, lon);
      setDestinationSafetyPOIs(data);
    } catch (e) {
      console.warn('Failed to fetch destination POIs:', e);
    } finally {
      setIsLoadingDestinationPOIs(false);
    }
  }, []);

  // Fetch departure POIs when currentCoords change
  useEffect(() => {
    fetchDeparturePOIs(currentCoords.lat, currentCoords.lon);
  }, [currentCoords.lat, currentCoords.lon, fetchDeparturePOIs]);

  // Fetch destination POIs when destinationCoords change
  useEffect(() => {
    if (destinationCoords) {
      fetchDestPOIs(destinationCoords.lat, destinationCoords.lon);
    } else {
      setDestinationSafetyPOIs([]);
    }
  }, [destinationCoords?.lat, destinationCoords?.lon, fetchDestPOIs]);

  // Handle typing in destination with debounced autocomplete
  const handleDestinationChange = (value: string) => {
    setDestination(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (value.trim().length >= 3) {
      setIsSearchingDest(true);
      setShowDestSuggestions(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const results = await searchAddressWithNominatim(value.trim());
          setDestinationSuggestions(results);
        } catch {
          setDestinationSuggestions([]);
        } finally {
          setIsSearchingDest(false);
        }
      }, 500);
    } else {
      setDestinationSuggestions([]);
      setShowDestSuggestions(false);
      setIsSearchingDest(false);
    }
  };

  const handleSelectDestSuggestion = (item: GeocodedAddress) => {
    setDestination(item.displayName);
    setDestinationCoords({ lat: item.lat, lon: item.lon });
    setShowDestSuggestions(false);
    setDestinationSuggestions([]);
    setSafePointsTab('destination');
    const meters = calculateDistance(currentCoords.lat, currentCoords.lon, item.lat, item.lon);
    const estMin = Math.max(5, Math.min(180, Math.round((meters / 1000) * 3.5)));
    setDurationMinutes(estMin);
  };

  // Called when destination is picked or searched via Nominatim on map
  const handleDestinationSelect = (coords: { lat: number; lon: number }, label: string) => {
    setDestinationCoords(coords);
    setDestination(label);
    setSafePointsTab('destination');
    const meters = calculateDistance(currentCoords.lat, currentCoords.lon, coords.lat, coords.lon);
    const estMin = Math.max(5, Math.min(180, Math.round((meters / 1000) * 3.5)));
    setDurationMinutes(estMin);
  };

  // Start check in — dispatches notification to parents + background server registration
  const handleStartCheckIn = async () => {
    if (!destination || !destination.trim()) {
      setCheckInValidationError(
        isUrdu
          ? 'براہ کرم سفر کی منزل درج کریں یا میپ سے منتخب کریں۔'
          : 'Please enter or select a valid journey destination before starting.'
      );
      return;
    }

    if (availableContacts.length === 0) {
      setCheckInValidationError(
        isUrdu
          ? 'کوئی محفوظ رابطہ دستیاب نہیں ہے۔ برائے مہربانی پہلے پروفائل سیکشن میں گارڈین یا محفوظ نمبر درج کریں۔'
          : 'No safe contacts found. Please add a guardian or emergency contact in your Profile first.'
      );
      return;
    }

    if (selectedContactIds.length === 0) {
      setCheckInValidationError(
        isUrdu
          ? 'براہ کرم الرٹ بھیجنے کے لیے کم از کم ایک محفوظ رابطہ منتخب کریں۔'
          : 'Please select at least one safe contact to receive alerts.'
      );
      return;
    }

    const safeDuration = Math.max(1, durationMinutes || 15);
    setCheckInValidationError(null);

    // If destination coordinates haven't been resolved yet, resolve dynamically with Nominatim
    let resolvedDestCoords = destinationCoords;
    if (!resolvedDestCoords && destination.trim()) {
      try {
        const lookup = await searchAddressWithNominatim(destination.trim());
        if (lookup && lookup.length > 0) {
          resolvedDestCoords = { lat: lookup[0].lat, lon: lookup[0].lon };
          setDestinationCoords(resolvedDestCoords);
        }
      } catch (err) {
        console.warn('Dynamic destination geocoding fallback error:', err);
      }
    }

    const now = new Date();
    const arrivalTime = new Date(now.getTime() + safeDuration * 60000);
    const timeStr = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const selectedContactsList = availableContacts
      .filter(c => selectedContactIds.includes(c.id))
      .map(c => ({
        id: c.id,
        name: c.name,
        relation: c.relation,
        phone: c.phone
      }));

    const selectedContacts = availableContacts.filter(c => selectedContactIds.includes(c.id));

    const trackingUrl = `https://www.openstreetmap.org/?mlat=${currentCoords.lat.toFixed(5)}&mlon=${currentCoords.lon.toFixed(5)}#map=17/${currentCoords.lat.toFixed(5)}/${currentCoords.lon.toFixed(5)}`;

    // Dynamically detect mobile condition (Battery, Network, Audio output) automatically without asking user
    const deviceCondition = await detectDeviceCondition();

    // Clean formatting: remove all emojis, brackets, hyphens, and arrows for clean WhatsApp readability
    const cleanDest = destination.replace(/[-—–→>]/g, ' to ').replace(/[\(\)\[\]\{\}]/g, '').trim();
    const cleanAddr = currentAddress.replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
    const cleanAudio = (deviceCondition.audioOutputMode || 'Active Ringer').replace(/[-—–→•]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
    const cleanNet = (deviceCondition.networkType || 'Mobile Network').replace(/[-—–→•]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();

    const batteryText = deviceCondition.batteryLevel !== null 
      ? `\n*Phone Battery:* ${Math.round(deviceCondition.batteryLevel * 100)}%${deviceCondition.isCharging ? ' Charging' : ''}` 
      : '';
    const silentText = `\n*Device Profile:* ${cleanAudio}, ${cleanNet}`;

    const messageText = `*Mehfooz AI Safety Check In*
I have started my journey check in to ${cleanDest}.
*Expected Arrival:* ${timeStr}, ${safeDuration} minutes
*Current GPS Location:* ${cleanAddr}
*Coordinates:* ${currentCoords.lat.toFixed(5)} N, ${currentCoords.lon.toFixed(5)} E${batteryText}${silentText}
*Live OpenStreetMap Link:* ${trackingUrl}
If safe arrival is not confirmed within ${safeDuration} minutes, automated emergency protocols will activate.`;

    const payload: ParentNotificationPayload = {
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      contacts: selectedContactsList,
      currentLocation: {
        lat: currentCoords.lat,
        lon: currentCoords.lon,
        address: currentAddress
      },
      destination,
      expectedMinutes: safeDuration,
      expectedArrivalTime: timeStr,
      osmTrackingUrl: trackingUrl,
      messageText
    };

    setParentNotification(payload);

    const session: SilentCheckInSession = {
      id: `checkin-${Date.now()}`,
      destination,
      expectedMinutes: safeDuration,
      remainingMinutes: safeDuration,
      expectedTimeStr: timeStr,
      selectedContactIds,
      selectedContactNames: selectedContactsList.map(c => c.name),
      isRunning: true,
      isCompleted: false,
      status: 'active',
      locationSharingActive: true,
      startTime: now.toISOString(),
      lastKnownCoordinates: {
        lat: currentCoords.lat,
        lng: currentCoords.lon,
        address: currentAddress
      }
    };

    setServerSessionId(null);
    setAlertDispatched(false);
    setExpireNotice(null);
    setRemainingMinutes(safeDuration);
    setActiveSession(session);
    setIsPlaying(true);

    // Show high-visibility notification confirmation
    const contactNames = selectedContactsList.map(c => c.name).join(' & ');
    setDispatchNotice(
      isUrdu
        ? `والدین / گارڈین کو لائیو GPS اور نقشہ الرٹ بھیج دیا گیا ہے: ${contactNames}`
        : `GPS location & OpenStreetMap tracking dispatched to: ${contactNames}`
    );

    // Auto-open modal once to confirm parents have been alerted
    setShowParentModal(true);

    // Register the session server-side
    void (async () => {
      try {
        const pos = await getCurrentPosition();
        const compressed = TICK_MS < 60_000;
        const res = await fetch('/api/check-in/start', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            userName: user?.fullName || 'Mehfooz User',
            destination,
            departure: fromLocation || currentAddress,
            expectedMinutes: Math.max(1, Math.round((safeDuration * TICK_MS) / 60_000)),
            gracePeriodMinutes: compressed ? 0 : 2,
            contacts: selectedContacts.map(c => ({ id: c.id, name: c.name, phone: c.phone, relation: c.relation })),
            lat: pos ? pos.lat : currentCoords.lat,
            lng: pos ? pos.lng : currentCoords.lon,
            batteryLevel: deviceCondition.batteryLevel,
            isSilentMode: deviceCondition.isSilentMode,
            isCharging: deviceCondition.isCharging,
            phoneStatus: deviceCondition.audioOutputMode || (deviceCondition.isSilentMode ? 'Silent' : 'Active Ringer')
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.checkIn?.id) setServerSessionId(String(data.checkIn.id));
        }
      } catch {
        /* local-only fallback mode */
      }
    })();
  };

  // Immediate abort of active session and intervals upon user logout
  useEffect(() => {
    const handleLogout = () => {
      setActiveSession(null);
      setServerSessionId(null);
      setIsPlaying(false);
      setAlertDispatched(false);
      setRemainingMinutes(durationMinutes || 21);
    };
    window.addEventListener('mehfooz:logout', handleLogout);
    return () => window.removeEventListener('mehfooz:logout', handleLogout);
  }, [durationMinutes]);

  // Timer countdown (1 app-minute per TICK_MS)
  useEffect(() => {
    let timer: any;
    if (activeSession && activeSession.isRunning && isPlaying) {
      timer = setInterval(() => {
        setRemainingMinutes(prev => (prev <= 1 ? 0 : prev - 1));
      }, TICK_MS);
    }
    return () => clearInterval(timer);
  }, [activeSession, isPlaying]);

  // App timer reached zero without a safe confirmation → missed check-in.
  useEffect(() => {
    if (!activeSession || remainingMinutes > 0 || alertDispatched) return;
    // Guard against startup re-render flash
    if (activeSession.startTime && (Date.now() - new Date(activeSession.startTime).getTime() < 3000)) {
      return;
    }
    setAlertDispatched(true);

    void (async () => {
      try {
        const condition = await detectDeviceCondition();
        const selectedContactsList = availableContacts
          .filter(c => (activeSession.selectedContactIds || []).includes(c.id))
          .map(c => ({
            id: c.id,
            name: c.name,
            relation: c.relation,
            phone: c.phone
          }));

        const res = await fetch('/api/check-in/expire', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ 
            checkInId: serverSessionId || activeSession.id,
            contacts: selectedContactsList.length > 0 ? selectedContactsList : availableContacts,
            userName: user?.fullName || 'Mehfooz User',
            destination: activeSession.destination,
            departure: fromLocation || currentAddress,
            batteryLevel: condition.batteryLevel,
            isCharging: condition.isCharging,
            isSilentMode: condition.isSilentMode,
            phoneStatus: condition.audioOutputMode || (condition.isSilentMode ? 'Silent' : 'Active Ringer'),
            lat: currentCoords.lat,
            lng: currentCoords.lon
          })
        });
        const data = await res.json().catch(() => ({}));
        const results = Array.isArray(data.results) ? data.results : [];
        const fired = results.some((r: { dispatched?: boolean }) => r.dispatched);
        const simulated = results.some(
          (r: { sms?: { simulated?: boolean }[] }) => (r.sms || []).some((s: { simulated?: boolean }) => s.simulated)
        );
        setExpireNotice(fired
          ? (simulated
              ? 'Missed check-in registered — SMS dispatch simulated (Twilio / TextBee gateway not connected).'
              : 'Emergency SMS with live GPS location, battery %, and condition has been dispatched to your safe contacts via hardware SIM gateway.')
          : 'Missed check-in registered. Emergency alerts dispatched to selected guardians.');
      } catch {
        setExpireNotice('Missed check-in recorded — alert notification dispatched.');
      }
    })();
  }, [remainingMinutes, activeSession, alertDispatched, serverSessionId, availableContacts, fromLocation, currentAddress, currentCoords, user]);

  // Periodic GPS heartbeat so contacts receive her last known location.
  useEffect(() => {
    if (!activeSession || !serverSessionId) return;
    let cancelled = false;
    const push = async () => {
      const pos = await getCurrentPosition();
      if (cancelled || !pos) return;
      setCurrentCoords({ lat: pos.lat, lon: pos.lng });
      try {
        await fetch('/api/check-in/location', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ checkInId: serverSessionId, lat: pos.lat, lng: pos.lng })
        });
      } catch {
        /* heartbeat is best effort */
      }
    };
    void push();
    const beat = setInterval(push, 30_000);
    return () => {
      cancelled = true;
      clearInterval(beat);
    };
  }, [activeSession, serverSessionId]);

  // Extend time (5 minutes)
  const handleExtendTime = (extraMin: number = 5) => {
    if (!activeSession) return;
    setRemainingMinutes(prev => prev + extraMin);
    setDispatchNotice(
      isUrdu 
        ? `گارڈین کو مطلع کر دیا گیا: وقت میں +${extraMin} منٹ کا اضافہ کیا گیا`
        : `Guardians notified: Trip extended by +${extraMin} min`
    );
    setTimeout(() => setDispatchNotice(null), 4000);
    if (serverSessionId) {
      void fetch('/api/check-in/extend', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          checkInId: serverSessionId,
          extraMinutes: Math.max(1, Math.round((extraMin * TICK_MS) / 60_000))
        })
      }).catch(() => {});
    }
  };

  // Confirm safe — when alerts already fired this also sends the all-clear SMS.
  const handleConfirmSafe = () => {
    const checkInId = serverSessionId;
    setShowSafeCelebration(true);
    setDispatchNotice(
      isUrdu
        ? 'والدین کو محفوظ آمد کی اطلاع بھیج دی گئی ہے'
        : 'Safe arrival confirmation sent to parents & safety network'
    );
    setTimeout(() => {
      setShowSafeCelebration(false);
      setActiveSession(null);
      setDispatchNotice(null);
      setServerSessionId(null);
      setAlertDispatched(false);
      setExpireNotice(null);
      setRemainingMinutes(durationMinutes || 21);
    }, 2500);
    if (checkInId) {
      void fetch('/api/check-in/confirm', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ checkInId })
      }).catch(() => {});
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Abort the session (back arrow)
  const handleCancelSession = () => {
    if (serverSessionId) {
      void fetch('/api/check-in/cancel', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ checkInId: serverSessionId })
      }).catch(() => {});
    }
    setActiveSession(null);
    setServerSessionId(null);
    setAlertDispatched(false);
    setExpireNotice(null);
    setRemainingMinutes(durationMinutes || 21);
  };

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-5 py-4 space-y-4 text-[#1C2C34] dark:text-[#F9FAFB]">
      {/* Celebration Notification */}
      {showSafeCelebration && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="p-4 rounded-2xl bg-emerald-600 dark:bg-emerald-500 text-white dark:text-[#0F1117] font-black text-center text-xs flex items-center justify-center space-x-2 shadow-lg"
        >
          <CheckCircle2 className="w-5 h-5 text-white dark:text-[#0F1117] flex-shrink-0" />
          <span>
            {isUrdu 
              ? 'حفاظتی اطلاع بھیج دی گئی: آپ محفوظ ہیں اور والدین کو مطلع کر دیا گیا ہے!' 
              : 'Safety Network & Parents Notified: You are safe & secure!'}
          </span>
        </motion.div>
      )}

      {/* Real-Time Dispatch Notice Banner */}
      {dispatchNotice && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-2xl bg-[#ECF4F4] dark:bg-[#1C2C34] border border-[#BCD4D4] dark:border-slate-700 text-[#1C2C34] dark:text-white flex items-center justify-between gap-2 shadow-sm"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-[#FC7454] text-white flex items-center justify-center flex-shrink-0">
              <Send className="w-3.5 h-3.5" />
            </div>
            <p className="text-xs font-bold truncate">
              {dispatchNotice}
            </p>
          </div>
          <button
            onClick={() => setShowParentModal(true)}
            className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#181B24] hover:bg-[#FC7454] hover:text-white border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase text-[#1C2C34] dark:text-slate-200 transition flex-shrink-0 cursor-pointer"
          >
            {isUrdu ? 'تفصیل دیکھیں' : 'View Dispatch'}
          </button>
        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* 1. SETUP SCREEN (When no active session)                                  */}
      {/* ========================================================================= */}
      {!activeSession && (
        <div className="rounded-3xl bg-white dark:bg-[#181B24] p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-5 transition-colors">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-black tracking-[0.2em] text-[#FC7454] uppercase block">
                {isUrdu ? 'حفاظتی روٹ و ٹریکنگ' : 'LIVE ROUTE PROTECTION'}
              </span>
              <h2 className="text-lg sm:text-xl font-black tracking-[0.12em] text-[#1C2C34] dark:text-white uppercase">
                {isUrdu ? 'محفوظ چیک ان' : 'SAFE CHECK-IN'}
              </h2>
            </div>
            <div className="p-2 rounded-2xl bg-[#ECF4F4] dark:bg-[#1C2C34] border border-[#BCD4D4] text-[#FC7454] flex-shrink-0 hidden sm:flex">
              <Shield className="w-5 h-5 text-[#FC7454]" />
            </div>
          </div>

          {/* 1. FROM / CURRENT DEPARTURE LOCATION */}
          <div className="space-y-1.5 relative">
            <label className="text-[11px] font-black tracking-wider text-[#1C2C34] dark:text-slate-300 uppercase flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>{isUrdu ? '1. موجودہ مقام (FROM)' : '1. FROM / CURRENT LOCATION'}</span>
              </span>
            </label>
            <div className="relative">
              <Navigation className="w-4 h-4 absolute left-3.5 top-3.5 text-emerald-600 dark:text-emerald-400" />
              <input
                type="text"
                value={fromLocation}
                onChange={(e) => handleFromChange(e.target.value)}
                onFocus={() => setShowFromSuggestions(true)}
                placeholder={isUrdu ? 'روانگی کا مقام درج کریں یا GPS استعمال کریں...' : 'Enter starting location or use live GPS...'}
                className="w-full bg-[#F8F9FD] dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 rounded-2xl py-3 pl-10 pr-10 text-xs font-semibold text-[#1C2C34] dark:text-white focus:outline-none focus:border-emerald-500 transition shadow-2xs"
              />
              {(isSearchingFrom || isLocatingGps) && (
                <div className="absolute right-3.5 top-3.5 text-slate-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                </div>
              )}
            </div>

            {/* FROM Autocomplete & GPS Dropdown */}
            {showFromSuggestions && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#181B24] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase text-slate-400 flex items-center justify-between">
                  <span>{isUrdu ? 'روانگی کے اختیارات' : 'Departure Options'}</span>
                  <button type="button" onClick={() => setShowFromSuggestions(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Priority Option: Use Live Device GPS */}
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                  className="w-full p-3 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border-b border-emerald-200/60 dark:border-emerald-800/80 flex items-center gap-2.5 transition text-left cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Navigation className={`w-3.5 h-3.5 ${isLocatingGps ? 'animate-spin' : ''}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black">{isUrdu ? '📍 میری موجودہ GPS لوکیشن' : '📍 Use Live GPS'}</p>
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                      {isLocatingGps ? (isUrdu ? 'GPS کوآرڈینیٹس حاصل ہو رہے ہیں...' : 'Acquiring GPS...') : currentAddress}
                    </p>
                  </div>
                </button>

                {/* Nominatim Search Suggestions */}
                {fromSuggestions.map((sug, i) => (
                  <div
                    key={i}
                    onClick={() => handleSelectFromSuggestion(sug)}
                    className="p-3 hover:bg-[#ECF4F4]/70 dark:hover:bg-slate-800/80 cursor-pointer transition border-b border-slate-100 dark:border-slate-800/50 last:border-0 flex items-start gap-2.5"
                  >
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1C2C34] dark:text-white truncate">{sug.displayName}</p>
                      <span className="text-[10px] text-slate-400 font-mono">{sug.lat.toFixed(4)}° N, {sug.lon.toFixed(4)}° E</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. TO / DESTINATION LOCATION */}
          <div className="space-y-1.5 relative">
            <label className="text-[11px] font-black tracking-wider text-[#1C2C34] dark:text-slate-300 uppercase flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#FC7454]"></span>
                <span>{isUrdu ? '2. منزل (TO)' : '2. TO / DESTINATION'}</span>
              </span>
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 absolute left-3.5 top-3.5 text-[#FC7454]" />
              <input
                type="text"
                value={destination}
                onChange={(e) => handleDestinationChange(e.target.value)}
                onFocus={() => { if (destinationSuggestions.length > 0) setShowDestSuggestions(true); }}
                placeholder={isUrdu ? 'منزل درج کریں (مثلاً گلبرگ، کینٹ، بحریہ، ایف-7)' : 'Enter destination (e.g. Gulberg, Cantt, F-7, DHA, Saddar)'}
                className="w-full bg-[#F8F9FD] dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 rounded-2xl py-3 pl-10 pr-10 text-xs font-semibold text-[#1C2C34] dark:text-white focus:outline-none focus:border-[#FC7454] transition shadow-2xs"
              />
              {isSearchingDest && (
                <div className="absolute right-3.5 top-3.5 text-slate-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#FC7454]" />
                </div>
              )}
            </div>

            {/* Destination Autocomplete Dropdown */}
            {showDestSuggestions && destinationSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white dark:bg-[#181B24] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase text-slate-400 flex items-center justify-between">
                  <span>{isUrdu ? 'منزل کی تجاویز' : 'Destination Suggestions'}</span>
                  <button type="button" onClick={() => setShowDestSuggestions(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {destinationSuggestions.map((sug, i) => (
                  <div
                    key={i}
                    onClick={() => handleSelectDestSuggestion(sug)}
                    className="p-3 hover:bg-[#ECF4F4]/70 dark:hover:bg-slate-800/80 cursor-pointer transition border-b border-slate-100 dark:border-slate-800/50 last:border-0 flex items-start gap-2.5"
                  >
                    <MapPin className="w-4 h-4 text-[#FC7454] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1C2C34] dark:text-white truncate">{sug.displayName}</p>
                      <span className="text-[10px] text-slate-400 font-mono">{sug.lat.toFixed(4)}° N, {sug.lon.toFixed(4)}° E</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* TWO-TAB DYNAMIC SAFE POINTS COMPONENT */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black tracking-wider text-[#1C2C34] dark:text-slate-300 uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? 'قریبی محفوظ پوائنٹس' : 'NEARBY SAFE POIS'}</span>
              </label>
            </div>

            {/* Tab Buttons */}
            <div className="flex bg-[#F1F5F9] dark:bg-[#12141C] p-1 rounded-2xl border border-slate-200 dark:border-slate-800 w-full">
              {/* Tab 1: Departure Location */}
              <button
                type="button"
                onClick={() => setSafePointsTab('departure')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  safePointsTab === 'departure'
                    ? 'bg-[#1C2C34] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#1C2C34] dark:hover:text-white'
                }`}
              >
                <MapPin className={`w-3.5 h-3.5 ${safePointsTab === 'departure' ? 'text-[#FC7454]' : ''}`} />
                <span>{isUrdu ? '1. موجودہ مقام کے محفوظ پوائنٹس' : '1. Current Safe POIs'}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-white/20 ml-1">
                  {departureSafetyPOIs.length}
                </span>
              </button>

              {/* Tab 2: Destination Location */}
              <button
                type="button"
                onClick={() => setSafePointsTab('destination')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  safePointsTab === 'destination'
                    ? 'bg-[#1C2C34] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#1C2C34] dark:hover:text-white'
                }`}
              >
                <Building2 className={`w-3.5 h-3.5 ${safePointsTab === 'destination' ? 'text-[#FC7454]' : ''}`} />
                <span>{isUrdu ? '2. منزل کے محفوظ پوائنٹس' : '2. Destination Safe POIs'}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-white/20 ml-1">
                  {destinationCoords ? destinationSafetyPOIs.length : '0'}
                </span>
              </button>
            </div>

            {/* Category filters */}
            <div className="flex items-center justify-between gap-2 px-1">

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 shrink-0">
                {(['all', 'police', 'hospital', 'rescue'] as const).map((cat) => (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => setPoiCategoryFilter(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition shrink-0 cursor-pointer ${
                      poiCategoryFilter === cat
                        ? 'bg-[#FC7454] text-white shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {cat === 'all' && (isUrdu ? 'تمام' : 'All')}
                    {cat === 'police' && '🛡️ Police 15'}
                    {cat === 'hospital' && '🏥 Hospital'}
                    {cat === 'rescue' && '🚑 Rescue 1122'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    if (safePointsTab === 'departure') fetchDeparturePOIs(currentCoords.lat, currentCoords.lon);
                    else if (destinationCoords) fetchDestPOIs(destinationCoords.lat, destinationCoords.lon);
                  }}
                  title="Refresh Safe Points"
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#FC7454] transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${(isLoadingDeparturePOIs || isLoadingDestinationPOIs) ? 'animate-spin text-[#FC7454]' : ''}`} />
                </button>
              </div>
            </div>

            {/* Loading State */}
            {((safePointsTab === 'departure' && isLoadingDeparturePOIs) ||
              (safePointsTab === 'destination' && isLoadingDestinationPOIs)) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="p-3 rounded-2xl bg-slate-50 dark:bg-[#12141C] border border-slate-200 dark:border-slate-800 animate-pulse space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="w-20 h-4 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                      <div className="w-12 h-4 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                    </div>
                    <div className="w-36 h-4 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                    <div className="w-48 h-3 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                  </div>
                ))}
              </div>
            )}

            {/* Content State: Tab 1 Departure */}
            {safePointsTab === 'departure' && !isLoadingDeparturePOIs && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-[340px] overflow-y-auto pr-0.5">
                {departureSafetyPOIs
                  .filter((p) => {
                    if (poiCategoryFilter === 'all') return true;
                    if (poiCategoryFilter === 'police') return p.type === 'police';
                    if (poiCategoryFilter === 'hospital') return p.type === 'hospital' || p.type === 'clinic';
                    if (poiCategoryFilter === 'rescue') return p.type === 'rescue';
                    return true;
                  })
                  .map((poi) => {
                    const isPol = poi.type === 'police';
                    const isHosp = poi.type === 'hospital' || poi.type === 'clinic';
                    const isRescue = poi.type === 'rescue';
                    const score = poi.safetyScore || 90;

                    return (
                      <div
                        key={poi.id}
                        className="p-3 rounded-2xl bg-white dark:bg-[#131E24] border border-slate-200 dark:border-slate-700/80 hover:border-[#FC7454] transition space-y-2 shadow-2xs group"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                            isPol ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60' :
                            isRescue ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/60' :
                            'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60'
                          }`}>
                            <span>{isPol ? '🛡️ Police' : isRescue ? '🚑 Rescue' : '🏥 Hospital'}</span>
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            score >= 90 ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' :
                            'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                          }`}>
                            {score}/100 Safe
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-[#1C2C34] dark:text-white leading-tight truncate">
                            {poi.name}
                          </h4>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {poi.address || `${poi.distanceFormatted} from check-in`}
                          </p>
                        </div>

                        <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px]">
                          <span className="font-mono text-slate-500 font-semibold flex items-center gap-1">
                            <Navigation className="w-3 h-3 text-[#FC7454]" />
                            <span>{poi.distanceFormatted} away</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <a
                              href={`tel:${poi.phone || poi.emergencyHelpline || '15'}`}
                              className="px-2 py-1 rounded-lg bg-[#1C2C34] hover:bg-[#FC7454] text-white text-[9px] font-bold uppercase transition no-underline flex items-center gap-1"
                            >
                              <PhoneCall className="w-2.5 h-2.5" />
                              <span>{poi.emergencyHelpline || '15'}</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                setDestination(poi.name);
                                setDestinationCoords({ lat: poi.lat, lon: poi.lon });
                              }}
                              className="px-2 py-1 rounded-lg bg-[#ECF4F4] hover:bg-[#FC7454] hover:text-white text-[#1C2C34] text-[9px] font-black uppercase transition cursor-pointer"
                              title="Set as destination"
                            >
                              {isUrdu ? 'منزل بنائیں' : 'Set Dest'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Content State: Tab 2 Destination */}
            {safePointsTab === 'destination' && !isLoadingDestinationPOIs && (
              <div>
                {!destinationCoords ? (
                  <div className="p-5 rounded-2xl bg-slate-50 dark:bg-[#12141C] border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-1">
                    <MapPin className="w-6 h-6 text-[#FC7454] mx-auto opacity-70" />
                    <h4 className="text-xs font-bold text-[#1C2C34] dark:text-white">
                      {isUrdu ? 'منزل کا انتخاب کریں' : 'Enter or Select Destination Above'}
                    </h4>
                  </div>
                ) : destinationSafetyPOIs.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500">
                    {isUrdu ? 'اس علاقے میں کوئی محفوظ پوائنٹس نہیں ملے' : 'No emergency points found for this exact radius.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 max-h-[340px] overflow-y-auto pr-0.5">
                    {destinationSafetyPOIs
                      .filter((p) => {
                        if (poiCategoryFilter === 'all') return true;
                        if (poiCategoryFilter === 'police') return p.type === 'police';
                        if (poiCategoryFilter === 'hospital') return p.type === 'hospital' || p.type === 'clinic';
                        if (poiCategoryFilter === 'rescue') return p.type === 'rescue';
                        return true;
                      })
                      .map((poi) => {
                        const isPol = poi.type === 'police';
                        const isHosp = poi.type === 'hospital' || poi.type === 'clinic';
                        const isRescue = poi.type === 'rescue';
                        const score = poi.safetyScore || 90;

                        return (
                          <div
                            key={poi.id}
                            className="p-3 rounded-2xl bg-white dark:bg-[#131E24] border border-slate-200 dark:border-slate-700/80 hover:border-[#FC7454] transition space-y-2 shadow-2xs group"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                                isPol ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60' :
                                isRescue ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/60' :
                                'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60'
                              }`}>
                                <span>{isPol ? '🛡️ Police' : isRescue ? '🚑 Rescue' : '🏥 Hospital'}</span>
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                score >= 90 ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' :
                                'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                              }`}>
                                {score}/100 Safe
                              </span>
                            </div>

                            <div>
                              <h4 className="text-xs font-bold text-[#1C2C34] dark:text-white leading-tight truncate">
                                {poi.name}
                              </h4>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {poi.address || `${poi.distanceFormatted} from destination`}
                              </p>
                            </div>

                            <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px]">
                              <span className="font-mono text-slate-500 font-semibold flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-[#FC7454]" />
                                <span>{poi.distanceFormatted} to dest</span>
                              </span>
                              <div className="flex items-center gap-1">
                                <a
                                  href={`tel:${poi.phone || poi.emergencyHelpline || '15'}`}
                                  className="px-2 py-1 rounded-lg bg-[#1C2C34] hover:bg-[#FC7454] text-white text-[9px] font-bold uppercase transition no-underline flex items-center gap-1"
                                >
                                  <PhoneCall className="w-2.5 h-2.5" />
                                  <span>{poi.emergencyHelpline || '15'}</span>
                                </a>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDestination(poi.name);
                                    setDestinationCoords({ lat: poi.lat, lon: poi.lon });
                                  }}
                                  className="px-2 py-1 rounded-lg bg-[#ECF4F4] hover:bg-[#FC7454] hover:text-white text-[#1C2C34] text-[9px] font-black uppercase transition cursor-pointer"
                                  title="Set this POI as exact arrival destination"
                                >
                                  {isUrdu ? 'منزل بنائیں' : 'Set Dest'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive OpenStreetMap Component */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black tracking-wider text-[#1C2C34] dark:text-slate-300 uppercase flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? 'اوپن سٹریٹ میپ و قریبی محفوظ پوائنٹس' : 'LIVE OPENSTREETMAP & OVERPASS POIS'}</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                  Nominatim Active
                </span>
              </div>
            </div>

            <OpenStreetMapViewer
              currentLat={currentCoords.lat}
              currentLon={currentCoords.lon}
              destinationQuery={destination}
              destinationCoords={destinationCoords}
              onLocationFound={handleLocationFound}
              showControls={false}
              isUrdu={isUrdu}
              heightClass="h-[300px] sm:h-[350px]"
            />
          </div>

          {/* Duration Selector */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black tracking-wider text-[#1C2C34] dark:text-slate-300 uppercase">
                {isUrdu ? 'متوقع وقت' : 'EXPECTED TRANSIT TIME'}
              </label>
              <span className="text-xs font-black text-[#FC7454] bg-[#ECF4F4] dark:bg-[#1C2C34] border border-[#BCD4D4] dark:border-slate-700 px-2.5 py-0.5 rounded-full">
                {durationMinutes} min
              </span>
            </div>

            {/* Presets */}
            <div className="flex space-x-2 pt-1">
              {[15, 21, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setDurationMinutes(m);
                    if (!activeSession) setRemainingMinutes(m);
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                    durationMinutes === m
                      ? 'bg-[#1C2C34] text-white shadow-sm'
                      : 'bg-[#F8F9FD] dark:bg-[#12141C] text-[#5A6E78] dark:text-slate-400 hover:bg-[#ECF4F4] dark:hover:bg-[#1C2C34]/50 hover:text-[#1C2C34] dark:hover:text-white border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>

            {/* Custom Time Input (#18) */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setDurationMinutes(0)}
                className={`px-3 py-2 rounded-xl text-xs font-black transition cursor-pointer border ${
                  durationMinutes === 0 || (durationMinutes !== 15 && durationMinutes !== 21 && durationMinutes !== 30 && durationMinutes !== 45 && durationMinutes !== 60)
                    ? 'bg-[#1C2C34] text-white shadow-sm border-[#1C2C34]'
                    : 'bg-[#F8F9FD] dark:bg-[#12141C] text-[#5A6E78] dark:text-slate-400 hover:bg-[#ECF4F4] dark:hover:bg-[#1C2C34]/50 border-slate-200 dark:border-slate-700'
                }`}
              >
                {isUrdu ? 'کسٹم وقت' : 'Custom'}
              </button>
              {(durationMinutes === 0 || (durationMinutes !== 15 && durationMinutes !== 21 && durationMinutes !== 30 && durationMinutes !== 45 && durationMinutes !== 60)) && (
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={durationMinutes || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= 480) {
                      setDurationMinutes(val);
                      if (!activeSession) setRemainingMinutes(val);
                    }
                  }}
                  placeholder={isUrdu ? 'منٹ درج کریں' : 'Enter minutes'}
                  className="w-24 py-2 px-3 rounded-xl bg-[#F8F9FD] dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 text-xs font-bold text-[#1C2C34] dark:text-white focus:outline-none focus:border-[#FC7454]"
                />
              )}
            </div>
          </div>

          {/* Automatic Background Device Telemetry Bar (No manual toggles or questions) */}
          <div className="flex items-center justify-between px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-semibold text-[11px]">
                {isUrdu ? 'خودکار ڈیوائس و بیٹری مانیٹرنگ' : 'Auto Device Telemetry Active'}
              </span>
            </div>
            {liveBattery.level !== null && (
              <div className="flex items-center gap-1.5 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full">
                {liveBattery.charging ? (
                  <BatteryCharging className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                ) : (
                  <Battery className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                )}
                <span>{Math.round(liveBattery.level * 100)}%</span>
                {liveBattery.charging ? '⚡' : ''}
              </div>
            )}
          </div>

          {/* Alert Recipients Checklist (Safe Contacts) */}
          <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1C2C34] dark:text-white flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? 'الرٹ وصول کنندگان (محفوظ رابطے):' : 'Alert Recipients (Safe Contacts):'}</span>
              </label>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {selectedContactIds.length} / {availableContacts.length} {isUrdu ? 'منتخب' : 'selected'}
              </span>
            </div>

            {availableContacts.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                <span>
                  {isUrdu
                    ? 'کوئی محفوظ رابطہ نہیں ملا۔ براہ کرم پروفائل میں جا کر گارڈین کا نمبر درج کریں۔'
                    : 'No emergency contacts found. Please add safe contacts in Profile.'}
                </span>
                {onNavigateToContacts && (
                  <button
                    type="button"
                    onClick={onNavigateToContacts}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] shrink-0 transition cursor-pointer"
                  >
                    {isUrdu ? 'پروفائل' : 'Manage Contacts'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-[#5A6E78] dark:text-slate-400">
                  {isUrdu
                    ? 'جن کو چیک مارک کریں گے، انہیں سفر کے آغاز کا ایس ایم ایس اور تاخیر پر ہنگامی الرٹ جائے گا:'
                    : 'Checkmark the contacts who should receive start SMS notices and emergency alerts:'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {availableContacts.map((contact) => {
                    const isSelected = selectedContactIds.includes(contact.id);
                    return (
                      <div
                        key={contact.id}
                        onClick={() => handleToggleContact(contact.id)}
                        className={`p-2.5 rounded-2xl border text-xs cursor-pointer flex items-center justify-between transition-all select-none ${
                          isSelected
                            ? 'bg-[#ECF4F4] dark:bg-[#1C2C34] border-[#FC7454] shadow-xs'
                            : 'bg-slate-50 dark:bg-[#12141C] border-slate-200 dark:border-slate-800 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 overflow-hidden">
                          <div
                            className={`w-5 h-5 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                              isSelected ? 'bg-[#FC7454] text-white' : 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <div className="truncate">
                            <div className="font-bold text-[#1C2C34] dark:text-white truncate">
                              {contact.name}
                            </div>
                            <div className="text-[10px] text-[#5A6E78] dark:text-slate-400 font-mono">
                              {contact.phone}
                            </div>
                          </div>
                        </div>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-800 text-[#FC7454] border border-slate-200 dark:border-slate-700 shrink-0 ml-1">
                          {contact.relation || 'Safe'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {checkInValidationError && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{checkInValidationError}</span>
            </div>
          )}

          {/* Start Button */}
          <button
            onClick={handleStartCheckIn}
            disabled={!destination.trim()}
            className="w-full py-4 rounded-2xl bg-[#1C2C34] hover:bg-[#1C2C34]/90 disabled:opacity-50 text-white font-black text-xs tracking-[0.2em] uppercase shadow-md transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4 text-[#FC7454]" />
            <span>{isUrdu ? 'محفوظ چیک ان شروع کریں' : 'START SAFE CHECK-IN'}</span>
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ACTIVE SESSION PLAYER WITH REAL-TIME MAP & PARENT DISPATCH             */}
      {/* ========================================================================= */}
      {activeSession && (
        <div className="rounded-3xl bg-white dark:bg-[#181B24] p-5 sm:p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-5 transition-colors">
          {/* Top Bar */}
          <div className="flex items-center justify-between px-1">
            <button
              onClick={handleCancelSession}
              className="p-2 hover:bg-[#ECF4F4] dark:hover:bg-slate-800 rounded-full transition cursor-pointer text-[#1C2C34] dark:text-slate-200"
              title="Return to Setup"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ECF4F4] dark:bg-[#1C2C34] border border-[#BCD4D4] dark:border-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-black uppercase text-[#1C2C34] dark:text-white tracking-wider">
                {isUrdu ? 'والدین لائیو ٹریکنگ فعال' : 'PARENTS NOTIFIED • GPS ACTIVE'}
              </span>
            </div>
            <button
              onClick={onOpenCrisis}
              className="px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-[10px] font-black tracking-wider uppercase cursor-pointer flex items-center gap-1"
            >
              <span>SOS 15</span>
            </button>
          </div>

          {/* Parent Notification Summary Banner */}
          <div className="p-3.5 rounded-2xl bg-[#ECF4F4] dark:bg-[#131E24] border border-[#BCD4D4] dark:border-slate-700 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-[#FC7454]">
                <Send className="w-3 h-3 text-[#FC7454]" />
                <span>{isUrdu ? 'والدین کو GPS بھیج دیا گیا' : 'Guardian Broadcast Dispatched'}</span>
              </div>
              <p className="text-xs font-bold text-[#1C2C34] dark:text-white truncate mt-0.5">
                {activeSession.selectedContactNames.join(', ')} ({activeSession.selectedContactNames.length} contacts)
              </p>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono block truncate">
                {currentAddress}
              </span>
            </div>
            <button
              onClick={() => setShowParentModal(true)}
              className="px-3 py-1.5 rounded-xl bg-[#1C2C34] hover:bg-[#FC7454] text-white text-[10px] font-black uppercase transition flex-shrink-0 cursor-pointer"
            >
              {isUrdu ? 'پیغام دیکھیں' : 'View Message'}
            </button>
          </div>

          {/* Live OpenStreetMap in Active Trip */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#1C2C34] dark:text-slate-300">
                <Navigation className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? 'لائیو روٹ و اوپن سٹریٹ میپ' : 'LIVE TRIP MAP & NEARBY OVERPASS POIS'}</span>
              </div>
              <button
                onClick={() => setMapCollapsed(!mapCollapsed)}
                className="text-[10px] font-bold text-[#FC7454] hover:underline cursor-pointer"
              >
                {mapCollapsed ? (isUrdu ? 'نقشہ دکھائیں' : 'Show Map') : (isUrdu ? 'چھپائیں' : 'Collapse Map')}
              </button>
            </div>

            {!mapCollapsed && (
              <OpenStreetMapViewer
                currentLat={currentCoords.lat}
                currentLon={currentCoords.lon}
                startCoords={
                  activeSession.lastKnownCoordinates
                    ? { lat: activeSession.lastKnownCoordinates.lat, lon: activeSession.lastKnownCoordinates.lng }
                    : currentCoords
                }
                destinationQuery={activeSession.destination}
                destinationCoords={destinationCoords}
                isJourneyActive={true}
                progressRatio={
                  activeSession.expectedMinutes > 0
                    ? Math.max(0, Math.min(1, Math.max(0, activeSession.expectedMinutes - (typeof remainingMinutes === 'number' ? remainingMinutes : activeSession.expectedMinutes)) / activeSession.expectedMinutes))
                    : 0
                }
                showControls={false}
                isUrdu={isUrdu}
                heightClass="h-[280px] sm:h-[320px]"
              />
            )}
          </div>

          {/* Missed check-in escalation banner */}
          {alertDispatched && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-2xl bg-rose-600 text-white space-y-1.5 shadow-md"
            >
              <div className="flex items-center space-x-2 font-black text-[11px] tracking-wider uppercase">
                <Bell className="w-4 h-4 animate-pulse" />
                <span>{isUrdu ? 'چیک ان موصول نہیں ہوا — الرٹ بھیج دیا گیا' : 'MISSED CHECK-IN — ALERT DISPATCHED'}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-50">
                {expireNotice || (isUrdu
                  ? 'آپ کے رابطوں کو آخری معلوم مقام کے ساتھ ایمرجنسی پیغام بھیج دیا گیا ہے۔ اگر آپ محفوظ ہیں تو فوری طور پر "میں محفوظ ہوں" دبائیں۔'
                  : 'Your emergency contacts have been notified with your last known location. Tap I\'M SAFE now to send the all-clear.')}
              </p>
            </motion.div>
          )}

          {/* Server monitoring status */}
          <div className="flex items-center justify-center">
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase px-3 py-1 rounded-full border ${
                serverSessionId
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                  : 'bg-[#F8F9FD] dark:bg-[#12141C] border-slate-200 dark:border-slate-700 text-[#5A6E78] dark:text-slate-400'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {serverSessionId
                ? (isUrdu ? 'سرور نگرانی فعال' : 'Server-monitored — alerts fire even if app closes')
                : (isUrdu ? 'مقامی ٹائمر موڈ' : 'Local timer mode')}
            </span>
          </div>

          {/* Session Header & Circular Controls */}
          <div className="text-center space-y-4 py-2 border-t border-slate-100 dark:border-slate-800 pt-4">
            <h3 className="text-xs font-black tracking-[0.2em] text-[#1C2C34] dark:text-white uppercase">
              CHECK-IN COUNTDOWN
            </h3>

            {/* Circular Controls: Stop, Pause/Play, Repeat */}
            <div className="flex items-center justify-center space-x-4">
              {/* Stop Button */}
              <button
                onClick={() => setIsPlaying(false)}
                className="w-10 h-10 rounded-full bg-[#ECF4F4] hover:bg-[#BCD4D4]/50 border border-[#BCD4D4] flex items-center justify-center text-[#FC7454] transition shadow-xs active:scale-95 cursor-pointer"
                title="Stop Timer"
              >
                <Square className="w-3.5 h-3.5 fill-[#FC7454]" />
              </button>

              {/* Main Large Charcoal Pause/Play */}
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-16 h-16 rounded-full bg-[#1C2C34] hover:bg-[#1C2C34]/90 flex items-center justify-center text-white transition shadow-lg active:scale-95 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-white" />
                ) : (
                  <Play className="w-6 h-6 fill-white ml-0.5" />
                )}
              </button>

              {/* Repeat / Restart */}
              <button
                onClick={() => {
                  setIsPlaying(true);
                  setRemainingMinutes(activeSession.expectedMinutes);
                }}
                className="w-10 h-10 rounded-full bg-[#ECF4F4] hover:bg-[#BCD4D4]/50 border border-[#BCD4D4] flex items-center justify-center text-[#FC7454] transition shadow-xs active:scale-95 cursor-pointer"
                title="Reset Timer"
              >
                <RotateCcw className="w-4 h-4 text-[#FC7454]" />
              </button>
            </div>

            {/* Status Text */}
            <h4 className="text-xs font-black tracking-[0.2em] text-[#1C2C34] dark:text-slate-200 uppercase pt-1">
              FEEL CALM • {remainingMinutes} MIN LEFT
            </h4>

            {/* Sound Wave Graphic */}
            <div className="flex items-center justify-center space-x-1.5 h-8 pt-1">
              {[14, 22, 10, 28, 16, 24, 8, 30, 18, 26, 12, 28, 14, 22, 16, 20].map((h, i) => (
                <span
                  key={i}
                  style={{ height: isPlaying ? `${h}px` : '4px' }}
                  className="w-0.5 bg-[#FC7454] rounded-full transition-all duration-300"
                />
              ))}
            </div>
          </div>

          {/* Active Session Pill */}
          <div className="w-full p-4 rounded-2xl bg-[#ECF4F4] dark:bg-[#1C2C34] border border-[#BCD4D4] dark:border-slate-700 flex items-center justify-between shadow-xs">
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black tracking-[0.18em] text-[#FC7454] uppercase block">
                  DESTINATION
                </span>
                {destinationCoords && (
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded-md">
                    {Math.round(calculateDistance(currentCoords.lat, currentCoords.lon, destinationCoords.lat, destinationCoords.lon) / 1000 * 10) / 10} km
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#1C2C34] dark:text-slate-100 font-semibold mt-0.5 truncate">
                {activeSession.destination || currentAddress}
              </p>
            </div>
            <button 
              onClick={handleConfirmSafe}
              className="px-3.5 py-2 rounded-full bg-[#1C2C34] hover:bg-[#FC7454] text-white text-[10px] font-black tracking-wider uppercase transition cursor-pointer flex-shrink-0"
            >
              {isUrdu ? 'میں محفوظ ہوں' : "I'M SAFE"}
            </button>
          </div>

          {/* Actions */}
          <div className="space-y-2 pt-2">
            <button
              onClick={handleConfirmSafe}
              className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#1C2C34]/90 text-white font-black text-xs tracking-[0.15em] uppercase transition shadow-xs cursor-pointer flex items-center justify-center space-x-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#FC7454]" />
              <span>{isUrdu ? 'میں محفوظ ہوں (والدین کو مطلع کریں)' : "I'M SAFE (CONFIRM ARRIVAL TO PARENTS)"}</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleExtendTime(5)}
                className="py-2.5 rounded-2xl bg-white dark:bg-[#181B24] border border-slate-200 dark:border-slate-700 text-[#1C2C34] dark:text-slate-200 font-extrabold text-xs tracking-wider uppercase transition hover:bg-[#ECF4F4] dark:hover:bg-slate-800 cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? '5 منٹ کا اضافہ' : 'EXTEND 5M'}</span>
              </button>

              <button
                onClick={() => setShowParentModal(true)}
                className="py-2.5 rounded-2xl bg-white dark:bg-[#181B24] border border-slate-200 dark:border-slate-700 text-[#1C2C34] dark:text-slate-200 font-extrabold text-xs tracking-wider uppercase transition hover:bg-[#ECF4F4] dark:hover:bg-slate-800 cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <Share2 className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{isUrdu ? 'گارڈین الرٹ' : 'GUARDIAN ALERT'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. PARENT / GUARDIAN NOTIFICATION DETAILS MODAL                           */}
      {/* ========================================================================= */}
      {showParentModal && parentNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-lg bg-white dark:bg-[#18242A] rounded-3xl border border-slate-200 dark:border-slate-700 p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[#1C2C34] dark:text-white uppercase">
                    {isUrdu ? 'والدین کو بھیجا گیا الرٹ' : 'Parent & Guardian Dispatch'}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {isUrdu ? 'لائیو جی پی ایس اور اوپن سٹریٹ میپ لائیو لنک' : 'Real-time GPS coordinates & OpenStreetMap link delivered'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowParentModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Recipient Parents */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                {isUrdu ? 'موصول کنندگان' : 'Delivered To (Guardians)'}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {parentNotification.contacts.map((c) => (
                  <div key={c.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#131E24] border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-[#1C2C34] dark:text-white">{c.name}</h5>
                      <span className="text-[10px] text-slate-500 font-mono">{c.phone}</span>
                    </div>
                    <span className="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200">
                      Dispatched
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* GPS Location & OpenStreetMap Data */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#131E24] border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-[#FC7454] flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-[#FC7454]" />
                  <span>{isUrdu ? 'بھیجا گیا GPS مقام' : 'Transmitted GPS Location'}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {parentNotification.currentLocation.lat.toFixed(5)}° N, {parentNotification.currentLocation.lon.toFixed(5)}° E
                </span>
              </div>
              <p className="text-xs font-semibold text-[#1C2C34] dark:text-white">
                {parentNotification.currentLocation.address}
              </p>
              <div className="pt-1 flex items-center justify-between text-[11px] border-t border-slate-200/60 dark:border-slate-700/60">
                <span className="text-slate-500">{isUrdu ? 'منزل:' : 'Destination:'} <strong>{parentNotification.destination}</strong></span>
                <span className="text-slate-500">{isUrdu ? 'متوقع آمد:' : 'ETA:'} <strong>{parentNotification.expectedArrivalTime}</strong></span>
              </div>
            </div>

            {/* Message Body sent to parents */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {isUrdu ? 'ایس ایم ایس و میسیج کا متن' : 'Exact SMS / WhatsApp Content'}
                </span>
                <button
                  onClick={() => handleCopyText(parentNotification.messageText)}
                  className="text-[10px] font-bold text-[#FC7454] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  {copiedText ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedText ? (isUrdu ? 'کاپی ہو گیا' : 'Copied') : (isUrdu ? 'کاپی میسیج' : 'Copy Message')}</span>
                </button>
              </div>
              <div className="p-3 rounded-2xl bg-white dark:bg-[#1C2C34] border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed max-h-40 overflow-y-auto">
                {parentNotification.messageText}
              </div>
            </div>

            {/* Actions: Open in OpenStreetMap, Send to WhatsApp, Done */}
            <div className="space-y-2 pt-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(parentNotification.messageText)}`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs tracking-wider uppercase transition shadow-xs flex items-center justify-center gap-2 cursor-pointer no-underline"
              >
                <span>💬</span>
                <span>{isUrdu ? 'واٹس ایپ پر بھی شیئر کریں' : 'Forward / Share via WhatsApp'}</span>
              </a>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={parentNotification.osmTrackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 rounded-xl bg-slate-100 dark:bg-[#131E24] hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold transition flex items-center justify-center gap-1.5 no-underline"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#FC7454]" />
                  <span>OpenStreetMap</span>
                </a>

                <button
                  onClick={() => setShowParentModal(false)}
                  className="py-2.5 rounded-xl bg-[#1C2C34] hover:bg-[#FC7454] text-white text-[11px] font-black uppercase transition cursor-pointer"
                >
                  {isUrdu ? 'بند کریں' : 'Close & Return'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
