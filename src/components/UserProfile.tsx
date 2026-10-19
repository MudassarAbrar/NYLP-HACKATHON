/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  User, 
  Mail, 
  MapPin, 
  Phone, 
  ShieldCheck, 
  Moon, 
  Sun, 
  Globe, 
  Key, 
  Bell, 
  LogOut, 
  Trash2, 
  Save, 
  Check, 
  AlertTriangle,
  Lock,
  Sparkles,
  Sliders,
  ChevronRight,
  Plus,
  Compass,
  ArrowLeft,
  Calendar
} from 'lucide-react';
import { motion } from 'motion/react';
import { UserProfile, PunjabDistrict, AppLanguage, UserContact } from '../types';
import { updateStoredProfile, purgeLocalDeviceData, deleteAccountPermanently } from '../utils/auth';
import { calculateAge, formatCnic } from './AuthModal';

interface UserProfileProps {
  user: UserProfile | null;
  language: AppLanguage;
  onLanguageChange: (lang: AppLanguage) => void;
  themeMode: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onUpdateProfile: (updated: UserProfile) => void;
  onLogout: () => void;
  onOpenAuthModal: () => void;
  onQuickExit: () => void;
  onOpenOnboarding?: () => void;
  onOpenSafetyGuide?: () => void;
  onBack?: () => void;
}

const PUNJAB_DISTRICTS: PunjabDistrict[] = [
  'Lahore',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Gujranwala',
  'Sialkot',
  'Bahawalpur',
  'Sargodha',
  'Sheikhupura',
  'Gujrat',
  'Kasur',
  'Sahiwal',
  'Other Punjab District'
];

export const UserProfileView: React.FC<UserProfileProps> = ({
  user,
  language,
  onLanguageChange,
  themeMode,
  onThemeChange,
  onUpdateProfile,
  onLogout,
  onOpenAuthModal,
  onQuickExit,
  onOpenOnboarding,
  onOpenSafetyGuide,
  onBack
}) => {
  const isUrdu = language === 'ur';

  // Profile Edit State
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [safeNickname, setSafeNickname] = useState(user?.safeNickname || '');
  const [dob, setDob] = useState(user?.dob || '');
  const [age, setAge] = useState<number | string>(user?.age ?? (user?.dob ? calculateAge(user.dob) : ''));
  const [cnic, setCnic] = useState(user?.cnic || '');
  const [address, setAddress] = useState(user?.address || `${user?.district || 'Lahore'}, Punjab`);
  const [district, setDistrict] = useState<PunjabDistrict>(user?.district || 'Lahore');
  const [phone, setPhone] = useState(user?.phone || '');
  const [guardianName, setGuardianName] = useState(user?.guardianName || user?.emergencyContactName || '');
  const [guardianPhone, setGuardianPhone] = useState(user?.guardianPhone || user?.emergencyContactPhone || '');
  const [safeLocations, setSafeLocations] = useState(user?.safeLocations || "Sister's home in Gulberg, Model Town Police Station");
  const [commonlyVisitedLocations, setCommonlyVisitedLocations] = useState(user?.commonlyVisitedLocations || "Punjab University Campus, Packages Mall, Anarkali Market");
  const [stealthPin, setStealthPin] = useState(user?.stealthPin || '1520');
  const [discreetNotifications, setDiscreetNotifications] = useState(user?.discreetNotifications ?? true);

  // Emergency contacts list
  const [contacts, setContacts] = useState<UserContact[]>(() => {
    if (user?.emergencyContacts && user.emergencyContacts.length > 0) {
      return user.emergencyContacts;
    }
    const saved = localStorage.getItem('mehfooz_user_contacts_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
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

  // Re-sync all fields whenever the user prop updates (e.g. login, signup, auth refresh)
  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName || '');
    setSafeNickname(user.safeNickname || '');
    setDob(user.dob || '');
    setAge(user.age ?? (user.dob ? calculateAge(user.dob) : ''));
    setCnic(user.cnic || '');
    setAddress(user.address || `${user.district || 'Lahore'}, Punjab`);
    setDistrict(user.district || 'Lahore');
    setPhone(user.phone || '');
    setGuardianName(user.guardianName || user.emergencyContactName || '');
    setGuardianPhone(user.guardianPhone || user.emergencyContactPhone || '');
    setSafeLocations(user.safeLocations || "Sister's home in Gulberg, Model Town Police Station");
    setCommonlyVisitedLocations(user.commonlyVisitedLocations || "Punjab University Campus, Packages Mall, Anarkali Market");
    setStealthPin(user.stealthPin || '1520');
    setDiscreetNotifications(user.discreetNotifications ?? true);

    if (user.emergencyContacts && user.emergencyContacts.length > 0) {
      setContacts(user.emergencyContacts);
    } else {
      const saved = localStorage.getItem('mehfooz_user_contacts_v1');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setContacts(parsed);
            return;
          }
        } catch {}
      }
      if (user.guardianPhone || user.emergencyContactPhone) {
        setContacts([{
          id: 'c-guardian',
          name: user.guardianName || user.emergencyContactName || 'Parent / Guardian',
          phone: user.guardianPhone || user.emergencyContactPhone || '',
          relation: 'Guardian',
          isDefaultNotified: true,
          isEmergencyContact: true
        }]);
      }
    }
  }, [user]);

  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactRelation, setNewContactRelation] = useState('Friend');

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [confirmLocalPurge, setConfirmLocalPurge] = useState(false);
  const [confirmAccountDelete, setConfirmAccountDelete] = useState(false);
  const [contactPhoneError, setContactPhoneError] = useState<string | null>(null);

  const handleAddContact = () => {
    setContactPhoneError(null);
    if (!newContactName.trim()) return;
    const cleanPhone = newContactPhone.trim().replace(/[\s\-\(\)]/g, '');
    const isPakPhone = /^((\+92|92|0)?3\d{9})$/.test(cleanPhone);
    if (!isPakPhone) {
      setContactPhoneError(
        isUrdu
          ? 'براہ کرم درست پاکستانی نمبر درج کریں (مثال: 03001234567 یا 923001234567+)'
          : 'Please enter a valid Pakistani mobile number (e.g. 03001234567 or +923001234567)'
      );
      return;
    }
    const normalizedPhone = cleanPhone.startsWith('0')
      ? `+92${cleanPhone.slice(1)}`
      : cleanPhone.startsWith('92')
      ? `+${cleanPhone}`
      : cleanPhone.startsWith('+92')
      ? cleanPhone
      : `+92${cleanPhone}`;

    const newC: UserContact = {
      id: `c-${Date.now()}`,
      name: newContactName.trim(),
      phone: normalizedPhone,
      relation: newContactRelation,
      isDefaultNotified: true
    };
    const updated = [...contacts, newC];
    setContacts(updated);
    setNewContactName('');
    setNewContactPhone('');
    try {
      localStorage.setItem('mehfooz_user_contacts_v1', JSON.stringify(updated));
      window.dispatchEvent(new Event('mehfooz:contacts-updated'));
    } catch {}
  };

  const handleRemoveContact = (id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    try {
      localStorage.setItem('mehfooz_user_contacts_v1', JSON.stringify(updated));
      window.dispatchEvent(new Event('mehfooz:contacts-updated'));
    } catch {}
  };

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDob(val);
    if (val) {
      const computed = calculateAge(val);
      setAge(computed);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuthModal();
      return;
    }

    const finalContacts = contacts.length > 0 ? contacts : (
      guardianPhone ? [{
        id: 'c-guardian',
        name: guardianName || 'Parent / Guardian',
        phone: guardianPhone,
        relation: 'Guardian',
        isDefaultNotified: true,
        isEmergencyContact: true
      }] : []
    );

    const updated: UserProfile = {
      ...user,
      fullName: fullName.trim(),
      safeNickname: safeNickname.trim(),
      dob: dob || user?.dob,
      age: age ? parseInt(String(age), 10) : user?.age,
      cnic: cnic.trim(),
      district,
      address: address.trim() || `${district}, Punjab`,
      phone: phone.trim(),
      guardianName: guardianName.trim(),
      guardianPhone: guardianPhone.trim(),
      safeLocations: safeLocations.trim(),
      commonlyVisitedLocations: commonlyVisitedLocations.trim(),
      emergencyContacts: finalContacts,
      emergencyContactName: guardianName.trim() || finalContacts[0]?.name || '',
      emergencyContactPhone: guardianPhone.trim() || finalContacts[0]?.phone || '',
      stealthPin: stealthPin.trim() || '1520',
      discreetNotifications,
      preferredLanguage: language,
      themeMode,
    };

    updateStoredProfile(updated);
    onUpdateProfile(updated);
    try {
      localStorage.setItem('mehfooz_user_contacts_v1', JSON.stringify(finalContacts));
      window.dispatchEvent(new Event('mehfooz:contacts-updated'));
    } catch {}

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleExecuteLocalPurge = () => {
    purgeLocalDeviceData();
    onLogout();
    onQuickExit();
  };

  const handleExecuteAccountDeletion = async () => {
    await deleteAccountPermanently();
    onLogout();
    onQuickExit();
  };

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4 text-[#1C2C34]">
        <div className="rounded-[28px] bg-white border border-slate-200 p-8 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-[#ECF4F4] text-[#FC7454] border border-[#BCD4D4] mx-auto flex items-center justify-center">
            <User className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#1C2C34]">
              {isUrdu ? 'آپ گیسٹ موڈ میں ہیں' : 'Guest Mode Active'}
            </h2>
            <p className="text-xs text-[#5A6E78] max-w-sm mx-auto font-medium">
              {isUrdu
                ? 'اپنے محفوظ مقامات، ہنگامی رابطوں اور سیٹنگز کو محفوظ رکھنے کے لیے لاگ ان کریں۔'
                : 'Sign in to sync your saved places, trusted emergency contacts, and personalized safe routes.'}
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={onOpenAuthModal}
              className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              {isUrdu ? 'لاگ ان یا سائن اپ کریں' : 'Sign In / Register Profile'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-4 space-y-4 text-[#1C2C34]">
      {/* Profile Header Card */}
      <div className="rounded-[28px] bg-white border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-[#ECF4F4] text-[#FC7454] border border-[#BCD4D4] flex items-center justify-center font-black text-base shadow-xs">
              {fullName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-[#1C2C34]">
                  {fullName}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                  Verified
                </span>
              </div>
              <p className="text-xs text-[#5A6E78] flex items-center space-x-1.5 mt-0.5">
                <Mail className="w-3.5 h-3.5" />
                <span>{user.email}</span>
                <span>•</span>
                <MapPin className="w-3.5 h-3.5 text-[#FC7454]" />
                <span>{district}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onBack || (() => window.history.back())}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#1C2C34] font-semibold text-xs flex items-center space-x-1 transition cursor-pointer"
              title="Back to Previous Page"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{isUrdu ? 'واپس' : 'Back'}</span>
            </button>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#1C2C34] font-semibold text-xs flex items-center space-x-1 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-[#FC7454]" />
              <span>{isUrdu ? 'لاگ آؤٹ' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      </div>



      {/* Save Success Alert */}
      {savedSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center space-x-2 font-bold"
        >
          <Check className="w-4 h-4 flex-shrink-0 text-emerald-600" />
          <span>
            {isUrdu ? 'ترتیبات کامیابی سے محفوظ ہو گئیں!' : 'Profile & safety settings updated!'}
          </span>
        </motion.div>
      )}

      {/* Profile Form */}
      <form onSubmit={handleSaveProfile} className="space-y-4">
        {/* Section 1: Personal Details */}
        <div className="rounded-3xl bg-white border border-slate-200 p-5 space-y-3.5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#5A6E78] flex items-center space-x-1.5">
            <User className="w-3.5 h-3.5 text-[#FC7454]" />
            <span>Personal Information</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[#1C2C34] font-semibold mb-1">
                Full Name:
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  Safe Nickname:
                </label>
                <input
                  type="text"
                  value={safeNickname}
                  onChange={(e) => setSafeNickname(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                />
              </div>

              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  Primary District:
                </label>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value as PunjabDistrict)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454]"
                >
                  {PUNJAB_DISTRICTS.map((d) => (
                     <option key={d} value={d}>
                       {d}
                     </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#FC7454]" />
                    <span>{isUrdu ? 'تاریخ پیدائش (Date of Birth):' : 'Date of Birth (DOB):'}</span>
                  </span>
                </label>
                <input
                  type="date"
                  value={dob}
                  onChange={handleDobChange}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1 flex items-center justify-between">
                  <span>{isUrdu ? 'عمر (Calculated Age):' : 'Age (Calculated):'}</span>
                  {typeof age === 'number' && age >= 18 && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      {isUrdu ? '18+ تصدیق شدہ' : '18+ Verified'}
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="12"
                    max="100"
                    value={age}
                    onChange={(e) => setAge(parseInt(e.target.value, 10) || e.target.value)}
                    placeholder={isUrdu ? 'خودکار حساب' : 'Auto-calculated'}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] font-bold focus:outline-none focus:border-[#FC7454] text-xs"
                  />
                  <span className="text-xs text-[#5A6E78] font-semibold shrink-0">
                    {isUrdu ? 'سال' : 'yrs'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  {isUrdu ? 'شناختی کارڈ (CNIC / National ID):' : 'CNIC (National ID):'}
                </label>
                <input
                  type="text"
                  value={cnic}
                  maxLength={15}
                  onChange={(e) => setCnic(formatCnic(e.target.value))}
                  placeholder="35201-XXXXXXX-X"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] font-mono tracking-wider focus:outline-none focus:border-[#FC7454] text-xs"
                />
              </div>

              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  {isUrdu ? 'ذاتی موبائل نمبر (Phone):' : 'Personal Phone:'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="03001234567"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  {isUrdu ? 'سرپرست کا نام (Guardian Name):' : 'Primary Guardian Name:'}
                </label>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="e.g. Zainab Rehman (Mother)"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs"
                />
              </div>

              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1">
                  {isUrdu ? 'سرپرست کا فون نمبر (Guardian Phone):' : 'Guardian Mobile Phone:'}
                </label>
                <input
                  type="tel"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                  placeholder="03001234567 or +923001234567"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[#1C2C34] font-semibold mb-1">
                {isUrdu ? 'رہائش کا پتہ (Address / Residence):' : 'Residence / Address:'}
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Gulberg III, Lahore"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs"
              />
            </div>

            {/* Safe Havens & Routine Locations */}
            <div className="pt-2.5 border-t border-slate-100 space-y-3">
              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#FC7454]" />
                    <span>{isUrdu ? 'محفوظ مقامات (Safe Havens / Locations):' : 'Safe Havens / Trusted Locations:'}</span>
                  </span>
                  <span className="text-[10px] text-[#5A6E78] font-normal">{isUrdu ? 'اے آئی کے لیے' : 'Used by AI Agent'}</span>
                </label>
                <textarea
                  rows={2}
                  value={safeLocations}
                  onChange={(e) => setSafeLocations(e.target.value)}
                  placeholder={isUrdu ? 'مثال: گلبرگ میں بہن کا گھر، ماڈل ٹاؤن تھانہ، قریبی میٹرو اسٹیشن' : "e.g. Sister's home in Gulberg, Model Town Police Station, Community Centre"}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] resize-none text-xs"
                />
                <p className="text-[10px] text-[#5A6E78] mt-0.5">
                  {isUrdu 
                    ? 'وہ جگہیں جہاں آپ خود کو محفوظ محسوس کرتی ہیں۔ ہنگامی صورت میں اے آئی ایجنٹ ان کی طرف رہنمائی کرے گا۔'
                    : 'Locations where you feel secure. The AI assistant uses these to plan safe emergency havens.'}
                </p>
              </div>

              <div>
                <label className="block text-[#1C2C34] font-semibold mb-1 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#FC7454]" />
                    <span>{isUrdu ? 'معمول کے مقامات (Commonly Visited Hubs):' : 'Commonly Visited / Daily Locations:'}</span>
                  </span>
                  <span className="text-[10px] text-[#5A6E78] font-normal">{isUrdu ? 'روزمرہ روٹس' : 'Daily Routine'}</span>
                </label>
                <textarea
                  rows={2}
                  value={commonlyVisitedLocations}
                  onChange={(e) => setCommonlyVisitedLocations(e.target.value)}
                  placeholder={isUrdu ? 'مثال: پنجاب یونیورسٹی نیا کیمپس، پیکجز مال، دفتر ڈی ایچ اے' : "e.g. Punjab University Campus, Packages Mall, Workplace in DHA, Anarkali Market"}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] resize-none text-xs"
                />
                <p className="text-[10px] text-[#5A6E78] mt-0.5">
                  {isUrdu
                    ? 'آپ کے عام سفر اور معمول کی جگہیں، تاکہ ایجنٹ روٹ پروٹیکشن اور مشورے میں مدد کر سکے۔'
                    : 'Your regular transit hubs so the AI agent can provide contextual safe route and corridor protection.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Safe & Emergency Contacts Manager */}
        <div className="rounded-3xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5A6E78] flex items-center space-x-1.5">
              <Phone className="w-3.5 h-3.5 text-[#FC7454]" />
              <span>{isUrdu ? 'محفوظ و ہنگامی رابطے (Safe Contacts)' : 'Safe & Emergency Contacts'}</span>
            </h3>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
              {contacts.length} {isUrdu ? 'رابطے محفوظ' : 'Saved'}
            </span>
          </div>

          <p className="text-[11px] text-[#5A6E78]">
            {isUrdu
              ? 'یہ وہ قابل اعتماد رابطے ہیں جن کو سیف چیک ان سفر کے دوران ایس ایم ایس الرٹ اور ہنگامی نوٹیفکیشن بھیجے جا سکتے ہیں۔'
              : 'These trusted contacts can receive SMS alerts, live GPS tracking, and emergency missed check-in notifications during journeys.'}
          </p>

          {/* Contacts List */}
          {contacts.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
              {isUrdu ? 'ابھی تک کوئی اضافی رابطہ شامل نہیں کیا گیا۔ نیچے سے نیا رابطہ شامل کریں۔' : 'No emergency contacts added yet. Add trusted contacts below.'}
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between hover:bg-slate-100/60 transition"
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <div className="w-8 h-8 rounded-xl bg-[#ECF4F4] text-[#FC7454] border border-[#BCD4D4] flex items-center justify-center font-bold text-xs shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-[#1C2C34] truncate">{c.name}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white text-[#FC7454] border border-slate-200 shrink-0">
                          {c.relation || 'Contact'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#5A6E78] font-mono mt-0.5">
                        {c.phone}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveContact(c.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer shrink-0"
                    title={isUrdu ? 'رابطہ ختم کریں' : 'Remove Contact'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Contact Sub-form */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="text-xs font-bold text-[#1C2C34] flex items-center space-x-1.5">
              <Plus className="w-3.5 h-3.5 text-[#FC7454]" />
              <span>{isUrdu ? 'نیا محفوظ رابطہ شامل کریں' : 'Add New Safe Contact'}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <input
                  type="text"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder={isUrdu ? 'رابطہ کا نام' : 'Name (e.g. Sister)'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs"
                />
              </div>

              <div>
                <select
                  value={newContactRelation}
                  onChange={(e) => setNewContactRelation(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs"
                >
                  <option value="Guardian">Guardian / سرپرست</option>
                  <option value="Mother">Mother / والدہ</option>
                  <option value="Father">Father / والد</option>
                  <option value="Sister">Sister / بہن</option>
                  <option value="Brother">Brother / بھائی</option>
                  <option value="Friend">Friend / دوست</option>
                  <option value="Colleague">Colleague / ساتھی</option>
                  <option value="Other">Other / دیگر</option>
                </select>
              </div>

              <div>
                <input
                  type="tel"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  placeholder="03001234567"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[#1C2C34] focus:outline-none focus:border-[#FC7454] text-xs font-mono"
                />
              </div>
            </div>

            {contactPhoneError && (
              <p className="text-xs text-rose-600 font-semibold">{contactPhoneError}</p>
            )}

            <button
              type="button"
              onClick={handleAddContact}
              className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-[#ECF4F4] text-[#1C2C34] font-bold text-xs border border-slate-200 hover:border-[#BCD4D4] transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#FC7454]" />
              <span>{isUrdu ? 'رابطہ شامل کریں' : 'Add to Safe Contacts'}</span>
            </button>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="space-y-3 pt-1">
          <button
            type="submit"
            className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer"
          >
            <Save className="w-4 h-4 text-[#FC7454]" />
            <span>Save Profile & Preferences</span>
          </button>





          {/* Data Privacy & Purge Triggers (ISSUE 23 & 24) */}
          <div className="pt-3 border-t border-slate-100 space-y-3 text-center">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#5A6E78]">
              {isUrdu ? 'ڈیٹا کنٹرول اور سیکیورٹی وائپ' : 'Data Privacy & Device Sanitization'}
            </div>

            {/* 1. Local Device Purge */}
            {!confirmLocalPurge ? (
              <div>
                <button
                  type="button"
                  onClick={() => setConfirmLocalPurge(true)}
                  className="text-xs text-amber-700 hover:underline font-semibold flex items-center justify-center space-x-1 mx-auto cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isUrdu ? 'اس ڈیوائس سے لوکل ڈیٹا صاف کریں' : 'Clear Data From This Device'}</span>
                </button>
                <p className="text-[10px] text-[#5A6E78] mt-0.5">
                  {isUrdu
                    ? 'صرف اس موبائل سے کیشڈ والٹ اور چابیاں مٹاتا ہے۔ آن لائن اکاؤنٹ محفوظ رہے گا۔'
                    : 'Wipes cached keys and local vault from this device. Remote account remains safe.'}
                </p>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 space-y-2">
                <p className="text-xs text-amber-900 font-medium">
                  {isUrdu
                    ? 'کیا آپ واقعی اس ڈیوائس سے تمام لوکل ڈیٹا اور فعال سیشن ختم کرنا چاہتے ہیں؟'
                    : 'Clear cached vault and encryption keys from this browser/device only?'}
                </p>
                <div className="flex items-center justify-center space-x-2">
                  <button
                    type="button"
                    onClick={handleExecuteLocalPurge}
                    className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer"
                  >
                    {isUrdu ? 'ہاں، لوکل ڈیٹا مٹائیں' : 'Confirm Local Device Wipe'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmLocalPurge(false)}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 text-[#1C2C34] text-xs font-semibold cursor-pointer"
                  >
                    {isUrdu ? 'منسوخ' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {/* 2. Permanent Account Deletion */}
            {user && (
              <div className="pt-1">
                {!confirmAccountDelete ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setConfirmAccountDelete(true)}
                      className="text-xs text-rose-600 hover:underline font-semibold flex items-center justify-center space-x-1 mx-auto cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isUrdu ? 'اکاؤنٹ اور تمام کلاؤڈ ریکارڈز مستقل ڈیلیٹ کریں' : 'Permanently Delete Account & Cloud Records'}</span>
                    </button>
                    <p className="text-[10px] text-rose-500/80 mt-0.5">
                      {isUrdu
                        ? 'کلاؤڈ سے تمام شکایات، شواہد اور پروفائل کو ناقابل واپسی طور پر تباہ کر دیتا ہے۔'
                        : 'Irreversibly destroys all cloud incidents, complaints, check-ins, and profile data.'}
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200 space-y-2">
                    <p className="text-xs text-rose-900 font-bold">
                      {isUrdu
                        ? 'انتباہ: یہ عمل ناقابل واپسی ہے۔ آپ کا تمام ڈیٹا مستقل ختم ہو جائے گا۔'
                        : 'Warning: This action is permanent and cannot be undone. All cloud data will be wiped.'}
                    </p>
                    <div className="flex items-center justify-center space-x-2">
                      <button
                        type="button"
                        onClick={handleExecuteAccountDeletion}
                        className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer"
                      >
                        {isUrdu ? 'مستقل ڈیلیٹ کریں' : 'Confirm Permanent Deletion'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmAccountDelete(false)}
                        className="px-3 py-1.5 rounded-xl bg-slate-200 text-[#1C2C34] text-xs font-semibold cursor-pointer"
                      >
                        {isUrdu ? 'منسوخ' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
