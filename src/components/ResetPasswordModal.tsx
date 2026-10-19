/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Key, Eye, EyeOff, Check, AlertCircle, CheckCircle2, Shield, ArrowRight, X, Loader2 } from 'lucide-react';
import { AppLanguage, UserProfile } from '../types';
import { setNewPassword } from '../utils/auth';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: AppLanguage;
  userEmail?: string;
  onSuccess: () => void;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  language,
  userEmail,
  onSuccess
}) => {
  const isUrdu = language === 'ur';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  // Password validation & strength
  const isLengthValid = password.length >= 6;
  const hasNumber = /\d/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);
  const isMatch = password === confirmPassword && confirmPassword.length > 0;

  const strength = !password ? 0 : [isLengthValid, hasNumber, hasLetter, password.length >= 8].filter(Boolean).length;
  const strengthColor = strength <= 1 ? 'bg-rose-500' : strength <= 3 ? 'bg-amber-500' : 'bg-emerald-500';
  const strengthLabel = strength <= 1 ? (isUrdu ? 'کمزور' : 'Weak') : strength <= 3 ? (isUrdu ? 'مناسب' : 'Fair') : (isUrdu ? 'مضبوط' : 'Strong');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isLengthValid) {
      setErrorMessage(isUrdu ? 'پاس ورڈ کم از کم 6 حروف پر مشتمل ہونا چاہیے۔' : 'Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(isUrdu ? 'دونوں پاس ورڈ مماثل نہیں ہیں۔' : 'Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await setNewPassword(password);
      if (result.success) {
        setIsSuccess(true);
      } else {
        setErrorMessage(result.error || (isUrdu ? 'پاس ورڈ تبدیل کرنے میں ناکامی ہوئی۔ براہ کرم نیا لنک طلب کریں۔' : 'Failed to update password. Please request a new reset link.'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || (isUrdu ? 'ایک غیر متوقع مسئلہ پیش آیا۔' : 'An unexpected error occurred.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = () => {
    // Clear URL recovery fragments
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('mehfooz_is_password_recovery');
        window.history.replaceState(null, '', window.location.pathname);
      } catch {}
    }
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-md bg-white dark:bg-[#181B24] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        >
          {/* Top Decorative Bar */}
          <div className="h-2 bg-gradient-to-r from-[#FC7454] to-amber-500" />

          {/* Close Button */}
          {!isSuccess && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="p-6 sm:p-7 space-y-5">
            {!isSuccess ? (
              <>
                {/* Header */}
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-[#ECF4F4] text-[#FC7454] border border-[#BCD4D4] flex items-center justify-center mx-auto shadow-xs">
                    <Key className="w-6 h-6 stroke-[2.2]" />
                  </div>
                  <h2 className="text-lg font-bold text-[#1C2C34] dark:text-white">
                    {isUrdu ? 'نیا پاس ورڈ سیٹ کریں' : 'Set New Password'}
                  </h2>
                  <p className="text-xs text-[#5A6E78] dark:text-slate-400 max-w-xs mx-auto">
                    {isUrdu
                      ? 'اپنے محفوظ اکاؤنٹ اور ہنگامی ترتیبات کے لیے نیا پاس ورڈ درج کریں۔'
                      : 'Choose a strong, secure new password for your Mehfooz account.'}
                  </p>
                  {userEmail && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-[#1C2C34] dark:text-slate-300">
                      <span>{userEmail}</span>
                    </div>
                  )}
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{errorMessage}</span>
                  </motion.div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* New Password Input */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#1C2C34] dark:text-slate-200">
                      {isUrdu ? 'نیا پاس ورڈ:' : 'New Password:'}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-[#1C2C34] dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#FC7454] transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Strength Indicator */}
                    {password.length > 0 && (
                      <div className="pt-1.5 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-[#5A6E78]">
                          <span>{isUrdu ? 'پاس ورڈ کی طاقت:' : 'Password strength:'}</span>
                          <span className="font-bold">{strengthLabel}</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex gap-1">
                          {[1, 2, 3, 4].map((step) => (
                            <div
                              key={step}
                              className={`h-full flex-1 rounded-full transition-all ${
                                strength >= step ? strengthColor : 'bg-slate-200 dark:bg-slate-700'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#1C2C34] dark:text-slate-200">
                      {isUrdu ? 'پاس ورڈ کی تصدیق کریں:' : 'Confirm New Password:'}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-[#12141C] border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-[#1C2C34] dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#FC7454] transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Match Helper */}
                    {confirmPassword.length > 0 && (
                      <div className="pt-1 flex items-center gap-1.5 text-[10px]">
                        {isMatch ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700 font-medium">
                              {isUrdu ? 'پاس ورڈ مماثل ہیں' : 'Passwords match'}
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3 h-3 text-rose-500" />
                            <span className="text-rose-600 font-medium">
                              {isUrdu ? 'پاس ورڈ مماثل نہیں ہیں' : 'Passwords do not match'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Requirements List */}
                  <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 text-[11px] text-[#5A6E78] dark:text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${isLengthValid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400'}`}>
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span>{isUrdu ? 'کم از کم 6 حروف' : 'At least 6 characters'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${hasNumber ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-400'}`}>
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      <span>{isUrdu ? 'کم از کم ایک ہندسہ (0-9)' : 'At least one number (0-9)'}</span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoading || !isLengthValid || !isMatch}
                    className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] disabled:opacity-50 text-white font-bold text-xs tracking-wider uppercase transition shadow-md active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#FC7454]" />
                        <span>{isUrdu ? 'اپ ڈیٹ ہو رہا ہے...' : 'Updating Password...'}</span>
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4 text-[#FC7454]" />
                        <span>{isUrdu ? 'پاس ورڈ تبدیل کریں' : 'Update Password & Sign In'}</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* Success Confirmation View */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-4 text-center space-y-4"
              >
                <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-center mx-auto shadow-sm">
                  <CheckCircle2 className="w-8 h-8 stroke-[2.2]" />
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-[#1C2C34] dark:text-white">
                    {isUrdu ? 'پاس ورڈ کامیابی سے تبدیل ہو گیا!' : 'Password Reset Successful!'}
                  </h3>
                  <p className="text-xs text-[#5A6E78] dark:text-slate-400 max-w-xs mx-auto">
                    {isUrdu
                      ? 'آپ کا اکاؤنٹ اب نئے پاس ورڈ کے ساتھ محفوظ ہو چکا ہے۔ آپ محفوظ کے تمام فیچرز استعمال کر سکتے ہیں۔'
                      : 'Your password has been securely updated. You can now access your account, legal documents, and emergency features.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleContinue}
                  className="w-full py-3.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold text-xs tracking-wider uppercase transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{isUrdu ? 'ایپ پر جاری رکھیں' : 'Continue to Mehfooz'}</span>
                  <ArrowRight className="w-4 h-4 text-[#FC7454]" />
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
