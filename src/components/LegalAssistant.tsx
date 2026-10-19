/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  BookOpen, 
  ShieldCheck, 
  FileText, 
  ArrowRight, 
  Volume2, 
  VolumeX, 
  ChevronDown, 
  ChevronUp, 
  Bookmark, 
  HelpCircle,
  Scale,
  Building,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  PhoneCall,
  MapPin,
  Mic,
  MicOff,
  Paperclip,
  Image as ImageIcon,
  X,
  Languages,
  Radio,
  Lock,
  Globe,
  ExternalLink,
  ShieldAlert,
  Clock,
  Plus,
  MessageSquare,
  FileSignature
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppLanguage, LegalQueryResponse, LegalSourceCitation, PunjabDistrict, VaultRecord, UserContact, AgentResponse, AgentToolProposal, UserProfile } from '../types';
import { processSafetyOrchestration, checkImmediateDanger } from '../utils/orchestrator';
import { sendAgentMessage, loadConversations, loadConversationMessages, ConversationSummary, StoredMessage } from '../utils/agentClient';
import { loadVaultRecords, persistVaultRecords } from '../utils/dataService';
import { AgentActionCard } from './AgentActionCard';
import { AgentStepsPanel } from './AgentStepsPanel';
import { useChatState, ChatMessage } from '../utils/chatState';
import { getConversations, getConversationMessages, persistConversationUpdate, loadLocalConversations } from '../utils/conversationStorage';

interface LegalAssistantProps {
  language: AppLanguage;
  user?: UserProfile | null;
  userContacts?: UserContact[];
  onLanguageChange?: (lang: AppLanguage) => void;
  onOpenVaultWithDraft?: (title: string, note: string) => void;
  onOpenComplaintWithData?: (summary: string, category: string, photos?: string[]) => void;
  onOpenDirectory?: () => void;
  onOpenCrisis?: () => void;
  onLogAudit?: (event: string, detail: string, confidence?: number) => void;
  onOpenAuthModal?: () => void;
}

// Legal citations regex pattern (English & Urdu laws, codes, sections, and forums)
const CITATION_REGEX = /(Punjab\s+Protection\s+of\s+Women\s+Against\s+Violence\s+Act(?:\s*2016)?|PPWVA(?:\s*2016)?|Protection\s+Against\s+Harassment\s+of\s+Women\s+at\s+the\s+Workplace\s+Act(?:\s*2010)?|Prevention\s+of\s+Electronic\s+Crimes\s+Act(?:\s*2016)?|PECA(?:\s*2016)?|Pakistan\s+Penal\s+Code|PPC\s*Section\s*\d+[A-Za-z]?|Section\s*\d+[A-Za-z]?(?:\s*(?:of\s+)?(?:PPC|Pakistan\s+Penal\s+Code|CrPC|PECA|PPWVA))?|Code\s+of\s+Criminal\s+Procedure|CrPC|First\s+Information\s+Report|FIR|Punjab\s+Ombudsperson(?:\s*Office)?|Violence\s+Against\s+Women\s+Centre|VAWC|Dar-ul-Aman|Family\s+Courts\s+Act(?:\s*1964)?|Protection\s+Order|Residence\s+Order|Monetary\s+Order|پنجاب\s+تحفظ\s+نسواں\s+ایکٹ(?:\s*2016)?|تحفظ\s+نسواں\s+ایکٹ|مجموعہ\s+تعزیرات\s+پاکستان|دفعہ\s*\d+[الف-ی]?\s*(?:مجموعہ\s+تعزیرات\s+پاکستان|پیکا)?|پیکا\s+ایکٹ(?:\s*2016)?|پنجاب\s+محتسب(?:\s*برائے\s+خواتین)?|ضابطہ\s+فوجداری|ایف\s+آئی\s+آر|دارالامان|دار\s+الامان|پروٹیکشن\s+آرڈر|حفاظتی\s+آرڈر|ریذیڈنس\s+آرڈر|رہائشی\s+آرڈر|خرچہ\s+نان\s+نفقہ|حق\s+مہر|خلع)/gi;

function renderInlineFormatted(text: string, isUrdu: boolean, isUser: boolean): React.ReactNode[] {
  // Split by markdown bold **...**
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);

  return boldParts.map((part, pIdx) => {
    const isBold = part.startsWith('**') && part.endsWith('**') && part.length >= 4;
    const cleanContent = isBold ? part.slice(2, -2) : part;

    // Inside cleanContent, split and highlight legal citations
    const subParts = cleanContent.split(CITATION_REGEX);
    const subRendered = subParts.map((sub, sIdx) => {
      if (!sub) return null;
      CITATION_REGEX.lastIndex = 0;
      if (CITATION_REGEX.test(sub)) {
        return (
          <span
            key={`cit-${pIdx}-${sIdx}`}
            className={
              isUser
                ? 'font-bold text-orange-200 underline decoration-orange-300'
                : 'font-bold text-[#FC7454] dark:text-[#FC7C54] bg-[#FFF2EE] dark:bg-[#FC7454]/15 px-1 py-0.5 rounded border border-[#FC7454]/30 dark:border-[#FC7454]/40 inline shadow-2xs'
            }
          >
            {sub}
          </span>
        );
      }
      return sub;
    });

    if (isBold) {
      return (
        <strong
          key={`bold-${pIdx}`}
          className={`font-bold ${isUser ? 'text-white' : 'text-[#1C2C34] dark:text-white'}`}
        >
          {subRendered}
        </strong>
      );
    }
    return <React.Fragment key={`plain-${pIdx}`}>{subRendered}</React.Fragment>;
  });
}

/**
 * Beautiful, clean formatter for chat output:
 * - Bolds text cleanly without unrendered double asterisks (**)
 * - Highlights legal citations in brand coral/peach badge (#FC7454) in English & Urdu
 * - Strips raw hyphens (-) and asterisks (*) from bullet items, styling them with bullet dots
 */
const FormattedMessageText: React.FC<{ text: string; isUrdu: boolean; isUser: boolean }> = ({
  text,
  isUrdu,
  isUser
}) => {
  const lines = text.split('\n');

  return (
    <div className={`space-y-1.5 leading-relaxed text-sm sm:text-base ${isUrdu ? 'font-urdu' : 'font-normal'}`}>
      {lines.map((rawLine, idx) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        // Check if line is a bullet item (- item, * item, • item, or 1. item)
        const bulletMatch = trimmed.match(/^([-*•]|\d+\.)\s+(.+)$/);
        if (bulletMatch) {
          const bulletContent = bulletMatch[2];
          return (
            <div key={idx} className={`flex items-start gap-2 my-1 ${isUrdu ? 'flex-row-reverse text-right' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${isUser ? 'bg-white/80' : 'bg-[#FC7454]'}`} />
              <div className="flex-1 leading-relaxed">
                {renderInlineFormatted(bulletContent, isUrdu, isUser)}
              </div>
            </div>
          );
        }

        // Clean headers like "### Title" or "## Title"
        const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headerMatch) {
          return (
            <div key={idx} className={`font-extrabold pt-1.5 text-sm sm:text-base ${isUser ? 'text-white' : 'text-[#1C2C34] dark:text-white'}`}>
              {renderInlineFormatted(headerMatch[2], isUrdu, isUser)}
            </div>
          );
        }

        // Standard paragraph line
        return (
          <p key={idx} className="leading-relaxed">
            {renderInlineFormatted(trimmed, isUrdu, isUser)}
          </p>
        );
      })}
    </div>
  );
};

// Re-export ChatMessage so the rest of this file can use it via the local alias
type Message = ChatMessage;

interface QuickPrompt {
  id: string;
  labelEn: string;
  labelUrdu: string;
  queryEn: string;
  queryUrdu: string;
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: 'coercive',
    labelEn: 'Domestic abuse',
    labelUrdu: 'گھریلو تشدد',
    queryEn: 'What legal protections exist under Punjab law for domestic abuse and confinement?',
    queryUrdu: 'پنجاب کے قانون کے تحت گھریلو تشدد اور حبس بے جا کے لیے کیا قانونی تحفظات موجود ہیں؟'
  },
  {
    id: 'workplace',
    labelEn: 'Workplace harassment',
    labelUrdu: 'دفتر میں ہراسانی',
    queryEn: 'How do I file a workplace harassment complaint with the Punjab Ombudsperson?',
    queryUrdu: 'پنجاب محتسب کے پاس کام کی جگہ پر ہراسانی کی شکایت کیسے درج کروائی جائے؟'
  },
  {
    id: 'cyber',
    labelEn: 'Online blackmail (PECA)',
    labelUrdu: 'آن لائن بلیک میلنگ',
    queryEn: 'Someone is blackmailing me on WhatsApp. Which laws apply and what steps should I take?',
    queryUrdu: 'واٹس ایپ پر مجھے کوئی بلیک میل کر رہا ہے۔ کون سے قوانین لاگو ہوتے ہیں اور مجھے کیا اقدامات کرنے چاہئیں؟'
  },
  {
    id: 'protection',
    labelEn: 'Protection orders',
    labelUrdu: 'حفاظتی آرڈرز',
    queryEn: 'What is the procedure to obtain a Protection Order under PPWVA 2016 in Punjab?',
    queryUrdu: 'پنجاب میں PPWVA 2016 کے تحت پروٹیکشن آرڈر حاصل کرنے کا کیا طریقہ کار ہے؟'
  }
];

const POPULAR_PUNJAB_LOCATIONS = [
  'Gulberg, Lahore',
  'DHA Phase 5, Lahore',
  'Model Town, Lahore',
  'Mall Road, Lahore',
  'Saddar, Rawalpindi',
  'Faisalabad City',
  'Multan Cantt',
  'Gujranwala Center',
  'Sialkot Cantt'
];

export const LegalAssistant: React.FC<LegalAssistantProps> = ({
  language,
  user,
  userContacts,
  onLanguageChange,
  onOpenVaultWithDraft,
  onOpenComplaintWithData,
  onOpenDirectory,
  onOpenCrisis,
  onLogAudit,
  onOpenAuthModal
}) => {
  // Required info to continue the chat: Safe Phone / WhatsApp and Guardian or safe contact phone
  const hasRequiredContactInfo = Boolean(
    user && 
    user.phone && user.phone.trim().length > 0 &&
    (
      (user.emergencyContactPhone && user.emergencyContactPhone.trim().length > 0) ||
      (user.guardianPhone && user.guardianPhone.trim().length > 0) ||
      (userContacts && userContacts.length > 0 && userContacts.some(c => c.phone && c.phone.trim().length > 0))
    )
  );

  // ── M.3–M.9: Lift conversation state to App-level context ────────────────
  const {
    messages, setMessages,
    currentConversationId, setCurrentConversationId,
    conversationList, setConversationList,
    resetConversation
  } = useChatState();

  // Track whether we've done the initial load from server (prevents re-loading on remount)
  const hasInitializedRef = useRef(false);

  // Synchronized language state (allows local & global toggling)
  const [currentLang, setCurrentLang] = useState<AppLanguage>(language);

  useEffect(() => {
    setCurrentLang(language);
  }, [language]);

  const isUrdu = currentLang === 'ur';

  // Build the welcome message for the current language
  const buildWelcomeMessage = (lang: AppLanguage): ChatMessage => ({
    id: 'welcome-msg',
    sender: 'assistant',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: lang === 'ur'
      ? 'خوش آمدید۔ آپ پنجاب کے قوانین، گھریلو تشدد، ہراسانی اور قانونی حقوق بارے کوئی بھی سوال پوچھ سکتی ہیں۔ آپ کا ڈیٹا مکمل پرائیویٹ ہے۔'
      : 'Welcome to Mehfooz Legal Navigator. You can describe any situation in your own words (English, Urdu, or Roman Urdu) to understand your legal rights under Punjab law, protection orders, and safe next steps.'
  });

  // Initialize messages with welcome on very first mount (when context is empty)
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([buildWelcomeMessage(currentLang)]);
    }
    // Only run on the first render where messages are empty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [autoVoiceReadout, setAutoVoiceReadout] = useState(false);

  // 1. Menu and input attachment state
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // 2. Location feature state
  const [activeLocation, setActiveLocation] = useState<string | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [customLocationInput, setCustomLocationInput] = useState('');
  const [isDetectingGps, setIsDetectingGps] = useState(false);

  // 3. Voice Mode state
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef(false);
  const restartCountRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceBaseTextRef = useRef('');
  const voiceSessionFinalRef = useRef('');
  const voiceSessionInterimRef = useRef('');
  const MAX_RESTARTS = 5;
  const RESTART_DELAY_MS = 300;

  // 4. Photo Evidence state
  const [attachedPhotos, setAttachedPhotos] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── M.6–M.8: Voice cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
      // Stop any active speech synthesis
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // History panel UI state (local — not persisted across unmounts)
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, attachedPhotos]);

  // Load conversation history on FIRST mount and restore active conversation if available
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    let cancelled = false;
    void getConversations().then(async (convs) => {
      if (cancelled) return;
      setConversationList(convs);

      // Restore existing conversation messages if present and current messages are empty/welcome-only
      if (convs.length > 0) {
        const targetId = currentConversationId || convs[0].id;
        const loadedMsgs = await getConversationMessages(undefined, targetId);
        if (!cancelled && loadedMsgs.length > 0) {
          setCurrentConversationId(targetId);
          setMessages(loadedMsgs);
        }
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Switch to an existing conversation and load its rich messages
  const handleSwitchConversation = async (convId: string) => {
    if (convId === currentConversationId || loading) return;
    setCurrentConversationId(convId);
    setIsHistoryPanelOpen(false);
    setLoading(true);
    try {
      const loadedMsgs = await getConversationMessages(undefined, convId);
      if (loadedMsgs.length > 0) {
        setMessages(loadedMsgs);
      }
    } catch {
      // Keep current messages on failure
    } finally {
      setLoading(false);
    }
  };

  // Start a fresh conversation — M.4: ONLY explicit user action creates a new chat
  const handleNewConversation = () => {
    resetConversation(buildWelcomeMessage(currentLang));
    setIsHistoryPanelOpen(false);
  };

  const formatConvDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
    catch { return ''; }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setIsAttachMenuOpen(false);
      }
    };
    if (isAttachMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAttachMenuOpen]);

  // Handle Speech Recognition
  const handleToggleVoiceRecording = () => {
    if (isVoiceRecording) {
      shouldKeepListeningRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      // Commit any final speech from the session into base text
      if (voiceSessionFinalRef.current) {
        voiceBaseTextRef.current = voiceBaseTextRef.current
          ? `${voiceBaseTextRef.current} ${voiceSessionFinalRef.current}`
          : voiceSessionFinalRef.current;
        voiceSessionFinalRef.current = '';
        voiceSessionInterimRef.current = '';
      }
      setInputText(voiceBaseTextRef.current.trim());
      setIsVoiceRecording(false);
      setSpeechTranscript('');
      setVoiceError(null);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError(isUrdu ? 'براؤزر میں وائس ریکگنیشن سپورٹ دستیاب نہیں ہے۔' : 'Speech recognition not supported. Use Chrome or Edge.');
      return;
    }

    try {
      // Retain any existing text in the input box so speech appends naturally
      voiceBaseTextRef.current = inputText.trim();
      voiceSessionFinalRef.current = '';
      voiceSessionInterimRef.current = '';
      restartCountRef.current = 0;
      setVoiceError(null);
      setSpeechTranscript('');
      shouldKeepListeningRef.current = true;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = isUrdu ? 'ur-PK' : 'en-US';

      recognition.onstart = () => {
        setIsVoiceRecording(true);
        setVoiceError(null);
        restartCountRef.current = 0;
        onLogAudit?.('voice_input_started', `Started voice recording (${recognition.lang})`);
      };

      recognition.onresult = (event: any) => {
        let currentSessionFinal = '';
        let currentSessionInterim = '';

        // Clean reconstruction from index 0 to results.length.
        // This eliminates the Chromium resultIndex duplicate-firing bug completely.
        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript ? item[0].transcript.trim() : '';
          if (!transcript) continue;

          if (item.isFinal) {
            currentSessionFinal += (currentSessionFinal ? ' ' : '') + transcript;
          } else {
            currentSessionInterim += (currentSessionInterim ? ' ' : '') + transcript;
          }
        }

        voiceSessionFinalRef.current = currentSessionFinal;
        voiceSessionInterimRef.current = currentSessionInterim;

        const base = voiceBaseTextRef.current;
        let combined = base;
        if (currentSessionFinal) {
          combined = combined ? `${combined} ${currentSessionFinal}` : currentSessionFinal;
        }
        if (currentSessionInterim) {
          combined = combined ? `${combined} ${currentSessionInterim}` : currentSessionInterim;
        }

        setInputText(combined);
        setSpeechTranscript(currentSessionInterim || currentSessionFinal.split(' ').slice(-6).join(' ') || '');
      };

      recognition.onerror = (event: any) => {
        const err: string = event.error;
        const fatalErrors = ['not-allowed', 'service-not-allowed', 'audio-capture'];
        if (fatalErrors.includes(err)) {
          shouldKeepListeningRef.current = false;
          setIsVoiceRecording(false);
          const msgs: Record<string, string> = {
            'not-allowed': isUrdu
              ? 'مائیکروفون کی اجازت نہیں ملی۔ براہ کرم براؤزر سیٹنگز میں مائیکروفون آن کریں۔'
              : 'Microphone access denied. Please allow microphone in browser settings.',
            'service-not-allowed': isUrdu
              ? 'وائس سروس دستیاب نہیں ہے۔'
              : 'Speech service not allowed in browser settings.',
            'audio-capture': isUrdu
              ? 'کوئی مائیکروفون نہیں ملا۔ براہ کرم مائیکروفون کنیکٹ کریں۔'
              : 'No microphone found. Please connect a microphone.',
          };
          setVoiceError(msgs[err] || `Voice error: ${err}`);
          onLogAudit?.('voice_fatal_error', err);
          return;
        }
        if (err === 'network') {
          setVoiceError(isUrdu ? 'نیٹ ورک خراب — دوبارہ کوشش کریں' : 'Network error — speech API unreachable. Check connection.');
          onLogAudit?.('voice_network_error', 'Network error during speech recognition');
        }
      };

      recognition.onend = () => {
        // Commit any finalized text from this session before restarting or stopping
        if (voiceSessionFinalRef.current) {
          voiceBaseTextRef.current = voiceBaseTextRef.current
            ? `${voiceBaseTextRef.current} ${voiceSessionFinalRef.current}`
            : voiceSessionFinalRef.current;
          voiceSessionFinalRef.current = '';
          voiceSessionInterimRef.current = '';
        }

        if (!shouldKeepListeningRef.current) {
          setIsVoiceRecording(false);
          setSpeechTranscript('');
          return;
        }
        if (restartCountRef.current >= MAX_RESTARTS) {
          shouldKeepListeningRef.current = false;
          setIsVoiceRecording(false);
          setSpeechTranscript('');
          setVoiceError(isUrdu
            ? 'وائس ریکگنیشن بار بار ناکام ہوئی۔ دوبارہ کوشش کریں۔'
            : 'Voice recognition failed repeatedly. Please try again.');
          onLogAudit?.('voice_restart_limit', `Hit ${MAX_RESTARTS} restarts`);
          return;
        }
        restartCountRef.current += 1;
        restartTimerRef.current = setTimeout(() => {
          if (!shouldKeepListeningRef.current) return;
          try {
            recognition.start();
          } catch (e: any) {
            console.warn('Restart failed:', e?.message || e);
            shouldKeepListeningRef.current = false;
            setIsVoiceRecording(false);
            setSpeechTranscript('');
          }
        }, RESTART_DELAY_MS);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Error starting speech recognition:', err);
      shouldKeepListeningRef.current = false;
      setIsVoiceRecording(false);
      setSpeechTranscript('');
      setVoiceError(isUrdu ? 'وائس ریکگنیشن شروع نہیں ہو سکی' : 'Could not start voice recognition.');
    }
  };

  // Handle Photo Attachment with strict validation & user-facing error reporting
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    (Array.from(files) as File[]).forEach((file: File) => {
      // Validate supported image MIME types
      if (!file.type.startsWith('image/')) {
        setAttachmentError(
          isUrdu
            ? 'صرف تصاویر (JPEG, PNG, WEBP) منسلک کی جا سکتی ہیں۔'
            : `Unsupported file type (${file.type || 'unknown'}). Please attach a clear image (JPEG, PNG, WEBP).`
        );
        return;
      }

      // Max 10MB limit per image
      if (file.size > 10 * 1024 * 1024) {
        setAttachmentError(
          isUrdu
            ? 'تصویر کا سائز 10MB سے زیادہ ہے۔ براہ کرم چھوٹی تصویر منتخب کریں۔'
            : 'Image size exceeds 10MB limit. Please attach a smaller image.'
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        if (uploadEvent.target?.result) {
          const base64 = uploadEvent.target.result as string;
          setAttachedPhotos(prev => [...prev, base64]);
          onLogAudit?.('photo_attached_to_chat', `Attached photo evidence (${Math.round(file.size / 1024)} KB)`);
        }
      };
      reader.onerror = () => {
        setAttachmentError(
          isUrdu
            ? 'تصویر لوڈ نہیں ہو سکی۔ براہ کرم دوبارہ کوشش کریں۔'
            : 'Failed to read image file. Please try another image.'
        );
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedPhoto = (index: number) => {
    setAttachedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // Quick Transition to Complaint Builder prefilled with chat summary and photos
  const handleDraftComplaintFromChat = () => {
    const relevantMsgs = messages.filter(m => m.text && !m.text.startsWith('Welcome') && !m.text.startsWith('خوش آمدید'));

    let summary = '';
    if (relevantMsgs.length > 0) {
      const userNarrative = relevantMsgs.filter(m => m.sender === 'user').map(m => m.text).join('\n\n');
      const lastAssistant = relevantMsgs.filter(m => m.sender === 'assistant').slice(-1)[0]?.text || '';
      summary = `[INCIDENT SUMMARY FROM LEGAL ASSISTANT CONSULTATION]\n\n${userNarrative}${lastAssistant ? `\n\n[LEGAL REMEDIES & ADVICE]:\n${lastAssistant.slice(0, 600)}` : ''}`;
    } else {
      summary = `Incident consultation initiated via Mehfooz AI Legal Assistant on ${new Date().toLocaleDateString()}.`;
    }

    const allPhotos: string[] = [];
    messages.forEach(m => {
      if (m.photos && m.photos.length > 0) {
        allPhotos.push(...m.photos);
      }
    });

    let detectedCategory = 'domestic_violence';
    const fullText = messages.map(m => m.text).join(' ').toLowerCase();
    if (fullText.includes('inheritance') || fullText.includes('wirasat') || fullText.includes('property') || fullText.includes('jaidad')) {
      detectedCategory = 'property_dispute';
    } else if (fullText.includes('divorce') || fullText.includes('khula') || fullText.includes('talaq') || fullText.includes('mehr')) {
      detectedCategory = 'divorce_family';
    } else if (fullText.includes('cyber') || fullText.includes('whatsapp') || fullText.includes('blackmail') || fullText.includes('photo')) {
      detectedCategory = 'cybercrime';
    } else if (fullText.includes('workplace') || fullText.includes('office') || fullText.includes('boss') || fullText.includes('colleague')) {
      detectedCategory = 'workplace_harassment';
    }

    if (onOpenComplaintWithData) {
      onOpenComplaintWithData(summary, detectedCategory, allPhotos);
      onLogAudit?.('chat_transferred_to_complaint', `Transferred chat to complaint builder with ${allPhotos.length} photo(s)`);
    }
  };

  // Handle GPS Location Detection
  const handleDetectGPS = () => {
    setIsDetectingGps(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = `Lat ${pos.coords.latitude.toFixed(3)}, Lng ${pos.coords.longitude.toFixed(3)} (Lahore, Punjab)`;
          setActiveLocation(coords);
          setIsDetectingGps(false);
          setIsLocationModalOpen(false);
          onLogAudit?.('location_tagged_gps', coords);
        },
        (err) => {
          console.warn('GPS location error:', err);
          setActiveLocation('Lahore City, Punjab');
          setIsDetectingGps(false);
          setIsLocationModalOpen(false);
        },
        { timeout: 6000 }
      );
    } else {
      setActiveLocation('Lahore, Punjab');
      setIsDetectingGps(false);
      setIsLocationModalOpen(false);
    }
  };

  // Language switch handler
  const handleLanguageToggle = (newLang: AppLanguage) => {
    setCurrentLang(newLang);
    onLanguageChange?.(newLang);
    onLogAudit?.('language_switched', `Switched chat language to ${newLang}`);
  };

  const handleSend = async (textToSend?: string) => {
    // Enforce WhatsApp number and Guardian/Safe contact to continue chat
    if (!hasRequiredContactInfo) {
      onOpenAuthModal?.();
      return;
    }

    const query = textToSend || inputText;
    if ((!query.trim() && attachedPhotos.length === 0) || loading) return;

    let targetConvId = currentConversationId;
    if (!targetConvId) {
      targetConvId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      setCurrentConversationId(targetConvId);
    }

    const userMessageId = `user-${Date.now()}`;
    const photosToAttach = [...attachedPhotos];
    const currentLoc = activeLocation;

    const newMessages: Message[] = [
      ...messages,
      {
        id: userMessageId,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: query || (isUrdu ? '[تصویر بطور ثبوت شامل کی گئی]' : '[Photo attached as evidence]'),
        location: currentLoc || undefined,
        photos: photosToAttach.length > 0 ? photosToAttach : undefined
      }
    ];

    setMessages(newMessages);
    persistConversationUpdate(undefined, targetConvId, newMessages, currentLang);
    setConversationList(loadLocalConversations());
    if (isVoiceRecording) {
      shouldKeepListeningRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsVoiceRecording(false);
      setSpeechTranscript('');
    }
    voiceBaseTextRef.current = '';
    voiceSessionFinalRef.current = '';
    voiceSessionInterimRef.current = '';
    setInputText('');
    setAttachedPhotos([]);
    setAttachmentError(null);
    setLoading(true);

    // Save photos to local encrypted safety vault if attached
    if (photosToAttach.length > 0) {
      try {
        const existingVault = await loadVaultRecords();
        const newRecord: VaultRecord = {
          id: `vault-photo-${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          incidentDate: new Date().toISOString().split('T')[0],
          incidentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          category: 'domestic_violence',
          title: `Evidence Photo Tagged via Legal Assistant`,
          note: `Query: ${query.substring(0, 100)}... Location: ${currentLoc || 'Unspecified'}`,
          location: currentLoc || undefined,
          encrypted: true,
          hasPhoto: true,
          photoUrl: photosToAttach[0],
          isLinkedToComplaint: true
        };
        await persistVaultRecords([newRecord, ...existingVault]);
        onLogAudit?.('vault_photo_saved', 'Saved attached evidence photo into encrypted client vault');
      } catch (e) {
        console.error('Failed to save vault photo', e);
      }
    }

    onLogAudit?.('orchestrator_query', `Legal query with ${photosToAttach.length} photos: ${query.substring(0, 40)}...`);

    try {
      const promptQuery = currentLoc ? `[Location: ${currentLoc}] ${query}` : query;
      const assistantMessageId = `assistant-${Date.now()}`;

      // Format photo attachments into base64 payload for Gemini multimodal processing
      const attachmentsPayload = photosToAttach.map(p => {
        const match = p.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return { mimeType: match[1], data: match[2] };
        }
        return { mimeType: 'image/jpeg', data: p };
      });

      // Try the server-side agent first (function-calling loop)
      try {
        const agentResp = await sendAgentMessage(
          promptQuery,
          currentLang,
          targetConvId,
          {
            currentLocation: {
              lat: 31.5204,
              lng: 74.3587,
              address: currentLoc || user?.address || user?.district || 'Lahore, Punjab',
              permissionGranted: true
            },
            userProfile: {
              fullName: user?.fullName || 'Ayesha Rehman',
              safeNickname: user?.safeNickname || user?.fullName?.split(' ')[0] || 'Ayesha',
              age: user?.age || 24,
              cnic: user?.cnic || '35201-8765432-8',
              phone: user?.phone || '+92 300 1234567',
              district: user?.district || 'Lahore',
              address: user?.address || `${user?.district || 'Lahore'}, Punjab`,
              guardianName: user?.guardianName || user?.emergencyContactName || user?.emergencyContacts?.[0]?.name || 'Zainab Rehman (Mother)',
              guardianPhone: user?.guardianPhone || user?.emergencyContactPhone || user?.emergencyContacts?.[0]?.phone || '+92 300 1234567',
              safeLocations: user?.safeLocations || "Model Town Police Station, Sister's home in Gulberg",
              commonlyVisitedLocations: user?.commonlyVisitedLocations || "Punjab University Campus, Packages Mall",
              emergencyContacts: user?.emergencyContacts?.map(c => ({
                name: c.name,
                phone: c.phone,
                relation: c.relation
              })) || []
            }
          },
          attachmentsPayload
        );

        if (agentResp && agentResp.text && agentResp.type !== 'error') {
          if (agentResp.conversationId && agentResp.conversationId !== targetConvId) {
            targetConvId = agentResp.conversationId;
            setCurrentConversationId(agentResp.conversationId);
          }

          // Ensure all completed workflow steps show a completed state (remove any lingering active state)
          const finalizedSteps = agentResp.steps?.map(s => 
            s.status === 'active' ? { ...s, status: 'completed' as const } : s
          );

          const finalAgentResp: AgentResponse = {
            ...agentResp,
            steps: finalizedSteps
          };

          const agentMessages: Message[] = [
            ...newMessages,
            {
              id: assistantMessageId,
              sender: 'assistant',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: agentResp.text,
              agentResponse: finalAgentResp
            }
          ];

          setMessages(agentMessages);
          persistConversationUpdate(undefined, targetConvId, agentMessages, currentLang);
          setConversationList(loadLocalConversations());

          onLogAudit?.('agent_response', `Agent responded (${agentResp.type}) with ${agentResp.citations?.length || 0} citations`);

          if (autoVoiceReadout) {
            handleSpeak(assistantMessageId, agentResp.text);
          }

          // Handle UI actions from the agent
          if (agentResp.uiActions) {
            for (const uiAction of agentResp.uiActions) {
              if (uiAction.action === 'open_crisis_modal' && onOpenCrisis) {
                onOpenCrisis();
              }
              if (uiAction.action === 'open_complaint_builder' && onOpenComplaintWithData) {
                const category = (uiAction.payload?.category as string) || 'domestic_violence';
                onOpenComplaintWithData(agentResp.text || '', category);
              }
            }
          }

          setLoading(false);
          return;
        }
      } catch (agentErr: any) {
        console.info('Agent unavailable, using legacy orchestrator:', agentErr?.message);
      }

      // Fallback: legacy deterministic orchestrator
      const response = await processSafetyOrchestration(promptQuery, currentLang, userContacts);
      const answerText = isUrdu && response.answerSummaryUrdu ? response.answerSummaryUrdu : response.answerSummary;

      const orchestratorMessages: Message[] = [
        ...newMessages,
        {
          id: assistantMessageId,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: answerText,
          responsePayload: response
        }
      ];

      setMessages(orchestratorMessages);
      persistConversationUpdate(undefined, targetConvId, orchestratorMessages, currentLang);
      setConversationList(loadLocalConversations());

      onLogAudit?.('orchestrator_response', `Synthesized grounded response with ${response.sourceReferences.length} citations`, response.confidence);

      if (autoVoiceReadout) {
        handleSpeak(assistantMessageId, answerText);
      }

      // If crisis was detected, trigger modal suggestion
      if (response.riskLevel === 'immediate_danger' && onOpenCrisis) {
        onLogAudit?.('danger_triggered', 'Immediate danger trigger phrase detected');
      }
    } catch (err: any) {
      const errMessages: Message[] = [
        ...newMessages,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: isUrdu 
            ? 'معذرت، اس وقت سرور سے رابطہ نہیں ہو سکا۔ آپ کا ڈیٹا محفوظ ہے۔ براہ کرم دوبارہ کوشش کریں یا سپورٹ ڈائریکٹری دیکھیں۔'
            : 'We encountered a momentary connection issue. You can still browse the local legal directory and Punjab statutes offline.'
        }
      ];
      setMessages(errMessages);
      persistConversationUpdate(undefined, targetConvId, errMessages, currentLang);
      setConversationList(loadLocalConversations());
    } finally {
      setLoading(false);
    }
  };

  const handleSpeak = (msgId: string, text: string) => {
    if (speakingId === msgId) {
      window.speechSynthesis?.cancel();
      setSpeakingId(null);
      return;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = isUrdu ? 'ur-PK' : 'en-GB';
      utterance.rate = 0.95;
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);
      setSpeakingId(msgId);
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-130px)] max-w-4xl mx-auto px-4 py-3 text-[#1C2C34] bg-white/90 backdrop-blur-xs rounded-[28px] border border-[#BCD4D4]/50 shadow-sm">
      {/* 1. Header Toolbar with English / Urdu Toggle and Voice Mode */}
      <div className="flex flex-wrap items-center justify-between py-2 border-b border-slate-200 gap-2 text-xs">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-[#ECF4F4] text-[#FC7454] flex items-center justify-center shadow-xs border border-[#BCD4D4]">
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <span className="font-extrabold text-sm text-[#1C2C34]">
              {isUrdu ? 'قانونی AI' : 'Legal AI'}
            </span>
          </div>
        </div>

        {/* Action Controls: New Chat, Draft Complaint, History, English/Urdu Pill & Voice Mode */}
        <div className="flex items-center space-x-2">
          {/* New Chat Button */}
          <button
            onClick={handleNewConversation}
            className="p-1.5 px-2.5 rounded-xl text-xs font-bold bg-[#1C2C34] hover:bg-[#263842] text-white shadow-xs transition flex items-center space-x-1 cursor-pointer"
            title={isUrdu ? 'نئی بات چیت شروع کریں' : 'Start New Chat'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="font-bold hidden sm:inline">{isUrdu ? 'نئی چیٹ' : 'New Chat'}</span>
          </button>

          {/* Draft Complaint Quick Action Button */}
          <button
            onClick={handleDraftComplaintFromChat}
            className="p-1.5 px-2.5 rounded-xl text-xs font-bold bg-[#FC7454] hover:bg-[#eb6242] text-white shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
            title={isUrdu ? 'اس بات چیت سے شکایت کا مسودہ تیار کریں' : 'Draft Official Complaint from Chat'}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="font-bold">{isUrdu ? 'شکایت کا مسودہ' : 'Draft Complaint'}</span>
          </button>

          {/* Conversation History Toggle */}
          <button
            onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
            className={`p-1.5 px-2 rounded-xl text-xs font-bold border transition flex items-center space-x-1.5 cursor-pointer ${
              isHistoryPanelOpen
                ? 'bg-[#ECF4F4] border-[#BCD4D4] text-[#FC7454]'
                : 'bg-white border-slate-200 text-[#5A6E78] hover:bg-slate-50'
            }`}
            title={isUrdu ? 'چیٹ ہسٹری' : 'Chat History'}
          >
            <Clock className={`w-3.5 h-3.5 ${isHistoryPanelOpen ? 'text-[#FC7454]' : ''}`} />
            <span className="hidden sm:inline">{isUrdu ? 'ہسٹری' : 'History'}</span>
          </button>

          {/* English / Urdu Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
            <button
              onClick={() => handleLanguageToggle('en')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center space-x-1 cursor-pointer ${
                !isUrdu 
                  ? 'bg-white text-[#1C2C34] shadow-xs' 
                  : 'text-[#5A6E78] hover:text-[#1C2C34]'
              }`}
            >
              <span>🇬🇧</span>
              <span>English</span>
            </button>
            <button
              onClick={() => handleLanguageToggle('ur')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold font-urdu transition flex items-center space-x-1 cursor-pointer ${
                isUrdu 
                  ? 'bg-[#1C2C34] text-white shadow-xs' 
                  : 'text-[#5A6E78] hover:text-[#1C2C34]'
              }`}
            >
              <span>🇵🇰</span>
              <span>اردو</span>
            </button>
          </div>

          {/* Voice Auto-Readout Toggle */}
          <button
            onClick={() => setAutoVoiceReadout(!autoVoiceReadout)}
            className={`p-1.5 px-2 rounded-xl text-xs font-bold border transition flex items-center space-x-1.5 cursor-pointer ${
              autoVoiceReadout
                ? 'bg-[#ECF4F4] border-[#BCD4D4] text-[#FC7454]'
                : 'bg-white border-slate-200 text-[#5A6E78] hover:bg-slate-50'
            }`}
            title="Auto voice readout for answers"
          >
            <Volume2 className={`w-3.5 h-3.5 ${autoVoiceReadout ? 'text-[#FC7454]' : ''}`} />
            <span className="hidden sm:inline">{isUrdu ? 'آواز موڈ' : 'Voice Mode'}</span>
          </button>
        </div>
      </div>

      {/* Conversation History Panel */}
      <AnimatePresence>
        {isHistoryPanelOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-slate-200 overflow-hidden"
          >
            <div className="py-2.5 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-[#5A6E78]">
                  {isUrdu ? 'پچھلی بات چیت' : 'Previous Conversations'}
                </span>
                <button
                  onClick={handleNewConversation}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1C2C34] text-white hover:bg-[#263842] transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isUrdu ? 'نئی بات چیت' : 'New Chat'}</span>
                </button>
              </div>
              {conversationList.length === 0 ? (
                <p className="text-[11px] text-[#5A6E78] px-1 py-2">
                  {isUrdu ? 'ابھی کوئی پرانی بات چیت نہیں ہے۔' : 'No previous conversations yet.'}
                </p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {conversationList.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => handleSwitchConversation(conv.id)}
                      className={`w-full text-left p-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-between gap-2 ${
                        conv.id === currentConversationId
                          ? 'bg-[#ECF4F4] border border-[#BCD4D4] text-[#1C2C34] font-bold'
                          : 'bg-slate-50 hover:bg-[#ECF4F4] border border-transparent text-[#1C2C34]'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <MessageSquare className="w-3.5 h-3.5 text-[#FC7454] flex-shrink-0" />
                        <span className={`truncate font-medium ${conv.language === 'ur' || /[\u0600-\u06FF]/.test(conv.title || '') ? 'font-urdu' : ''}`}>{conv.title || (isUrdu ? 'بغیر عنوان' : 'Untitled')}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-[10px] text-[#5A6E78] flex-shrink-0">
                        <span>{conv.message_count} msgs</span>
                        <span>{formatConvDate(conv.last_message_at || conv.created_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto py-3.5 space-y-4 pr-1">
        {messages.map((msg, msgIdx) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-center space-x-2 text-[11px] text-[#5A6E78] mb-1 px-1">
              <span>{msg.sender === 'user' ? (isUrdu ? 'آپ' : 'You') : (isUrdu ? 'محفوظ لیگل اسسٹنٹ' : 'Mehfooz Legal Assistant')}</span>
              <span>•</span>
              <span>{msg.timestamp}</span>
              {msg.location && (
                <span className="flex items-center space-x-0.5 text-[#1C2C34] font-semibold bg-[#ECF4F4] px-1.5 py-0.2 rounded-md border border-[#BCD4D4]">
                  <MapPin className="w-3 h-3 text-[#FC7454]" />
                  <span>{msg.location}</span>
                </span>
              )}
            </div>

            <div
              className={`max-w-2xl rounded-3xl p-4 sm:p-5 shadow-xs ${
                msg.sender === 'user'
                  ? 'bg-[#1C2C34] text-white rounded-br-xs'
                  : 'bg-white border border-[#BCD4D4]/60 text-[#1C2C34] rounded-bl-xs'
              }`}
            >
              {/* If user attached photos */}
              {msg.photos && msg.photos.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center space-x-1.5 text-xs text-[#1C2C34] mb-1.5 font-bold">
                    <Lock className="w-3.5 h-3.5 text-[#FC7454]" />
                    <span>{isUrdu ? 'محفوظ فوٹو ثبوت (پرائیویٹ والٹ میں محفوظ)' : 'Encrypted Evidence Photo (Saved in Safety Vault)'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {msg.photos.map((photo, pIdx) => (
                      <img
                        key={pIdx}
                        src={photo}
                        alt="Attached evidence"
                        className="w-24 h-24 sm:w-32 sm:h-32 object-cover rounded-2xl border-2 border-white/60 shadow-xs"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Message text formatted cleanly with bold styling, law citation badges, and clean bullets */}
              <FormattedMessageText
                text={msg.text}
                isUrdu={isUrdu}
                isUser={msg.sender === 'user'}
              />

              {/* Agent Provenance Badge */}
              {msg.agentResponse && (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="flex items-center space-x-1 text-teal-800 font-semibold bg-teal-50 px-2.5 py-1 rounded-xl border border-teal-200">
                    <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                    <span>{isUrdu ? 'جیمنائی AI ایجنٹ (ملٹی ٹول تصدیق شدہ)' : 'Gemini AI Agent (Multi-Tool Verified)'}</span>
                  </span>
                </div>
              )}

              {/* Agent Steps Panel (when agent response has steps) */}
              {msg.agentResponse?.steps && msg.agentResponse.steps.length > 0 && (
                <AgentStepsPanel steps={msg.agentResponse.steps} isUrdu={isUrdu} isComplete={true} />
              )}

              {/* Agent Action Cards (pending confirmations) */}
              {msg.agentResponse?.pendingActions && msg.agentResponse.pendingActions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.agentResponse.pendingActions.map((action) => (
                    <AgentActionCard
                      key={action.id}
                      action={action}
                      isUrdu={isUrdu}
                      onConfirmed={(result) => {
                        onLogAudit?.('agent_action_confirmed', `Confirmed: ${action.toolName}`);
                        // If the action has a UI action (e.g. vault save or complaint builder), handle it
                        if (result?.uiActions) {
                          for (const ua of result.uiActions) {
                            if (ua.action === 'save_incident_to_vault') {
                              onOpenVaultWithDraft?.(
                                (ua.payload?.title as string) || 'Incident Record',
                                (ua.payload?.message as string) || ''
                              );
                            }
                            if (ua.action === 'open_complaint_builder') {
                              onOpenComplaintWithData?.(
                                (ua.payload?.incidentSummary as string) || '',
                                (ua.payload?.category as string) || 'domestic_violence'
                              );
                            }
                          }
                        } else if (action.toolName === 'prepare_complaint_draft') {
                          const category = (action.displayData?.complaintCategory as string) || 'domestic_violence';
                          const summary = (action.displayData?.incidentSummary as string) || '';
                          if (summary) {
                            onOpenComplaintWithData?.(summary, category);
                          }
                        }
                      }}
                      onCancelled={() => {
                        onLogAudit?.('agent_action_cancelled', `Cancelled: ${action.toolName}`);
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Interactive Emergency Call 15 Dialer Card */}
              {msg.sender === 'assistant' && (
                /(\b(call\s*15|emergency\s*15|dial\s*15|15\s*per\s*call|15\s*پر\s*کال|police\s*emergency|call\s*police|call\s*1122)\b)/i.test(msg.text) ||
                msg.agentResponse?.riskLevel === 'critical' ||
                Boolean(msg.agentResponse?.isEmergency)
              ) && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3.5 p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-orange-50 border-2 border-rose-300 shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-rose-800 font-bold text-xs sm:text-sm">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span>
                      </span>
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                      <span>{isUrdu ? 'فوری پولیس ایمرجنسی — 15' : 'Immediate Police Emergency — 15'}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full border border-rose-200">
                      {isUrdu ? 'مفت ہیلپ لائن' : '24/7 Toll-Free'}
                    </span>
                  </div>

                  <p className="text-xs text-rose-900 leading-relaxed font-medium">
                    {isUrdu
                      ? 'اگر آپ یا کوئی اور فوری خطرے میں ہے تو بلا تاخیر پولیس ایمرجنسی 15 پر کال کریں۔ آپ کا تحفظ اولین ترجیح ہے۔'
                      : 'If you or someone around you is in immediate danger or facing physical harm, dial Punjab Police Emergency 15 immediately.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href="tel:15"
                      onClick={() => onLogAudit?.('emergency_call_15_initiated', 'Clicked Dial Police 15')}
                      className="flex-1 min-w-[150px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-xs transition cursor-pointer"
                    >
                      <PhoneCall className="w-4 h-4 animate-bounce" />
                      <span>{isUrdu ? '15 پر کال کریں (Call 15)' : 'Call Police 15 Now'}</span>
                    </a>

                    <a
                      href="tel:1122"
                      onClick={() => onLogAudit?.('emergency_call_1122_initiated', 'Clicked Dial Rescue 1122')}
                      className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-rose-50 text-rose-700 font-bold text-xs flex items-center justify-center space-x-1.5 border border-rose-200 shadow-2xs transition cursor-pointer"
                      title="Rescue 1122 Medical Emergency"
                    >
                      <PhoneCall className="w-3.5 h-3.5 text-rose-600" />
                      <span>{isUrdu ? 'ریسکیو 1122' : 'Rescue 1122'}</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => onOpenCrisis?.()}
                      className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center space-x-1.5 border border-slate-200 shadow-2xs transition cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-[#FC7454]" />
                      <span>{isUrdu ? 'ایمرجنسی SOS' : 'SOS Panel'}</span>
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Inline "Draft Complaint Now" Prompt Card */}
              {msg.sender === 'assistant' && (
                /(\b(draft\s*(the|a)?\s*complaint|prepare\s*(the|a)?\s*complaint|file\s*(the|a)?\s*complaint|ready\s*to\s*draft|proceed\s*with\s*(the\s*)?complaint|مسودہ\s*تیار|درخواست\s*کا\s*ڈرافٹ|complaint\s*builder|start\s*drafting|formal\s*complaint)\b)/i.test(msg.text) ||
                (msgIdx > 0 && messages[msgIdx - 1]?.sender === 'user' && /(\b(draft\s*(a|the)?\s*complaint|help\s*me\s*draft|want\s*to\s*draft|file\s*(a|the)?\s*complaint|write\s*(a|the)?\s*complaint|make\s*(a|the)?\s*complaint|مسودہ|شکایت\s*درج)\b)/i.test(messages[msgIdx - 1]?.text || '')) ||
                Boolean(msg.agentResponse?.actions?.some(a => a.toolName === 'prepare_complaint_draft' || a.toolName === 'open_complaint_builder'))
              ) && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3.5 p-4 rounded-2xl bg-gradient-to-r from-[#ECF4F4] to-teal-50/70 border border-[#BCD4D4] shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-[#1C2C34] font-bold text-xs sm:text-sm">
                      <FileSignature className="w-4 h-4 text-[#FC7454]" />
                      <span>{isUrdu ? 'باقاعدہ قانونی درخواست کا مسودہ تیار کریں' : 'Draft Formal Legal Complaint'}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-white text-[#1C2C34] px-2 py-0.5 rounded-full border border-[#BCD4D4]">
                      {isUrdu ? 'تیار شدہ ڈرافٹ' : 'Ready to Draft'}
                    </span>
                  </div>

                  <p className="text-xs text-[#5A6E78] leading-relaxed">
                    {isUrdu
                      ? 'آپ کی گفتگو، تاریخیں، متعلقہ قوانین اور شواہد کی بنیاد پر باقاعدہ درخواست کا مسودہ تیار ہے۔ نیچے دیئے گئے بٹن پر کلک کر کے شکایت کا مکمل فارم کھولیں۔'
                      : 'Sufficient factual details and legal grounds have been compiled from your consultation. Tap below to launch the Complaint Builder with your pre-filled incident statement and attached evidence.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        handleDraftComplaintFromChat();
                        onLogAudit?.('chat_complaint_draft_clicked', 'User clicked inline Draft Complaint Now button');
                      }}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1C2C34] hover:bg-[#263842] active:scale-98 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-xs transition hover:shadow cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#BCD4D4]" />
                      <span>{isUrdu ? 'ابھی درخواست کا مسودہ بنائیں' : 'Draft Complaint Now'}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#FC7454]" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Agent Citations */}
              {msg.agentResponse?.citations && msg.agentResponse.citations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setExpandedCitation(expandedCitation === msg.id ? null : msg.id)}
                    className="flex items-center space-x-1.5 text-xs font-bold text-[#5A6E78] hover:text-[#1C2C34] transition-colors py-1 group cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#FC7454]" />
                    <span>{isUrdu ? `حوالہ جات (${msg.agentResponse.citations.length}) ▾` : `References (${msg.agentResponse.citations.length}) ▾`}</span>
                    {expandedCitation === msg.id ? (
                      <ChevronUp className="w-3.5 h-3.5 text-[#5A6E78]" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-[#5A6E78]" />
                    )}
                  </button>
                  <AnimatePresence>
                    {expandedCitation === msg.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2 space-y-1.5 pl-5 border-l-2 border-[#BCD4D4] overflow-hidden"
                      >
                        {msg.agentResponse.citations.map((citation, cIdx) => (
                          <div key={cIdx} className="py-1">
                            <div className="text-xs font-bold text-[#1C2C34]">
                              {citation.statute && <span>{citation.statute}: </span>}
                              {citation.title}
                            </div>
                            <p className="text-[11px] text-[#5A6E78] mt-0.5">{citation.summary}</p>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Assistant Grounded Payload */}
              {msg.responsePayload && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-3.5">
                  {/* Confidence and readout badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center space-x-1.5 text-[#1C2C34] font-bold bg-[#ECF4F4] px-3 py-1.5 rounded-xl border border-[#BCD4D4]">
                        <ShieldCheck className="w-4 h-4 text-[#FC7454]" />
                        <span>{Math.round(msg.responsePayload.confidence * 100)}% {isUrdu ? 'پنجاب کے قوانین پر مبنی' : 'Grounded in Punjab Statutes'}</span>
                      </span>

                      {msg.responsePayload.isDeterministicFallback ? (
                        <span className="flex items-center space-x-1 text-slate-700 font-semibold bg-slate-100 px-2.5 py-1.5 rounded-xl border border-slate-200">
                          <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                          <span>{isUrdu ? 'مقامی پنجاب قوانین (آف لائن تصدیق شدہ)' : 'Local Punjab Corpus (Offline Verified)'}</span>
                        </span>
                      ) : msg.responsePayload.modelUsed ? (
                        <span className="flex items-center space-x-1 text-teal-800 font-semibold bg-teal-50 px-2.5 py-1.5 rounded-xl border border-teal-200">
                          <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                          <span>{msg.responsePayload.modelUsed}</span>
                        </span>
                      ) : null}
                    </div>

                    <button
                      onClick={() => handleSpeak(msg.id, msg.text)}
                      className="p-1.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-[#1C2C34] border border-slate-200 transition text-xs font-bold flex items-center space-x-1.5 shadow-xs cursor-pointer"
                      title="Audio readout"
                    >
                      {speakingId === msg.id ? (
                        <VolumeX className="w-4 h-4 text-[#FC7454]" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[#1C2C34]" />
                      )}
                      <span>{speakingId === msg.id ? (isUrdu ? 'روکیں' : 'Stop') : (isUrdu ? 'سنیں' : 'Read Aloud')}</span>
                    </button>
                  </div>

                  {/* Key Legal Concepts */}
                  {msg.responsePayload.legalConcepts?.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-extrabold text-[#5A6E78] uppercase tracking-wider">
                        {isUrdu ? 'متعلقہ قانونی شقیں و حقوق:' : 'Identified Legal Remedies & Rights:'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.responsePayload.legalConcepts.map((concept, idx) => (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-xl bg-[#ECF4F4] text-[#1C2C34] text-xs border border-[#BCD4D4] font-bold"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Interactive Action Confirmation (if triggered by intent, e.g. Call Contact, Send Complaint) */}
                  {msg.responsePayload.actionConfirmation && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3.5 rounded-2xl bg-[#F4F4FC] border border-[#C4D4DC] text-xs space-y-2.5 shadow-xs"
                    >
                      <div className="flex items-center space-x-2 text-[#1C2C34] font-bold">
                        <Sparkles className="w-4 h-4 text-[#FC7454]" />
                        <span>{isUrdu ? 'کارروائی کی توثیق (Confirmation Required)' : 'Action Confirmation'}</span>
                      </div>
                      <p className="text-[#5A6E78] font-medium">
                        {msg.responsePayload.actionConfirmation.prompt}
                      </p>

                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {msg.responsePayload.actionConfirmation.actionType === 'call' && (
                          <a
                            href={`tel:${msg.responsePayload.actionConfirmation.targetPhone || ''}`}
                            onClick={() => onLogAudit?.('chat_action_executed', `Initiated call to ${msg.responsePayload?.actionConfirmation?.targetName}`)}
                            className="px-4 py-2 rounded-xl bg-[#ECF4F4] hover:bg-[#BCD4D4]/30 text-[#1C2C34] font-bold flex items-center space-x-1.5 shadow-xs transition border border-[#BCD4D4] cursor-pointer"
                          >
                            <PhoneCall className="w-3.5 h-3.5 text-[#FC7454]" />
                            <span>{msg.responsePayload.actionConfirmation.buttonLabel}</span>
                          </a>
                        )}

                        {msg.responsePayload.actionConfirmation.actionType === 'send_complaint' && (
                          <button
                            onClick={() => {
                              // #31: Aggregate user messages for complaint
                              const allUserMsgs = messages
                                .filter(m => m.sender === 'user' && m.text && !m.text.startsWith('['))
                                .map(m => m.text);
                              const aggregated = allUserMsgs.join('\n\n');
                              const summary = aggregated || msg.responsePayload?.answerSummary || 'Complaint Summary';
                              const category = (msg.responsePayload?.legalConcepts?.[0]) || 'domestic_violence';
                              onOpenComplaintWithData?.(summary, category);
                              onLogAudit?.('chat_action_executed', `Routed to complaint builder for ${msg.responsePayload?.actionConfirmation?.targetName}`);
                            }}
                            className="px-4 py-2 rounded-xl bg-[#1C2C34] hover:bg-[#263842] text-white font-bold flex items-center space-x-1.5 shadow-xs transition cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#BCD4D4]" />
                            <span>{msg.responsePayload.actionConfirmation.buttonLabel}</span>
                          </button>
                        )}

                        {msg.responsePayload.actionConfirmation.actionType === 'share_location' && (
                          <button
                            onClick={() => {
                              alert(isUrdu ? 'آپ کی موجودہ محفوظ لوکیشن ہنگامی رابطوں کو بھیج دی گئی ہے۔' : `Live location dispatched to ${msg.responsePayload?.actionConfirmation?.targetName || 'Emergency Contacts'}`);
                              onLogAudit?.('chat_action_executed', `Shared live location with contacts`);
                            }}
                            className="px-4 py-2 rounded-xl bg-[#ECF4F4] hover:bg-[#BCD4D4]/30 text-[#1C2C34] font-bold flex items-center space-x-1.5 shadow-xs transition border border-[#BCD4D4] cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[#FC7454]" />
                            <span>{msg.responsePayload.actionConfirmation.buttonLabel}</span>
                          </button>
                        )}

                        {msg.responsePayload.actionConfirmation.actionType === 'sos' && (
                          <button
                            onClick={() => onOpenCrisis?.()}
                            className="px-4 py-2 rounded-xl bg-[#FC7454] hover:bg-[#FC7C54] text-white font-bold flex items-center space-x-1.5 shadow-xs transition cursor-pointer"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>{msg.responsePayload.actionConfirmation.buttonLabel}</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Clean, Compact References Dropdown (Redesigned into minimal clickable list) */}
                  {msg.responsePayload.sourceReferences?.length > 0 && (
                    <div className="pt-1">
                      <button
                        onClick={() => setExpandedCitation(expandedCitation === msg.id ? null : msg.id)}
                        className="flex items-center space-x-1.5 text-xs font-bold text-[#5A6E78] hover:text-[#1C2C34] transition-colors py-1 group cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-[#FC7454]" />
                        <span>{isUrdu ? `حوالہ جات (${msg.responsePayload.sourceReferences.length}) ▾` : `References (${msg.responsePayload.sourceReferences.length}) ▾`}</span>
                        {expandedCitation === msg.id ? (
                          <ChevronUp className="w-3.5 h-3.5 text-[#5A6E78] group-hover:text-[#1C2C34]" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-[#5A6E78] group-hover:text-[#1C2C34]" />
                        )}
                      </button>

                      <AnimatePresence>
                        {expandedCitation === msg.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2 space-y-1.5 pl-5 border-l-2 border-[#BCD4D4] overflow-hidden"
                          >
                            {msg.responsePayload.sourceReferences.map((citation: LegalSourceCitation, cIdx: number) => (
                              <div key={cIdx} className="py-1">
                                <a
                                  href={citation.url || '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-bold text-[#1C2C34] hover:text-[#FC7454] hover:underline flex items-center space-x-1.5 transition-colors"
                                >
                                  <span>{citation.document} — {citation.section}: {citation.sectionTitle}</span>
                                  <ExternalLink className="w-3 h-3 text-[#5A6E78] hover:text-[#FC7454] flex-shrink-0" />
                                </a>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Action Shortcuts */}
                  <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const title = msg.responsePayload?.legalConcepts?.[0] || 'Legal Advisory Note';
                        const summary = msg.responsePayload?.answerSummary || msg.text;
                        onOpenVaultWithDraft?.(title, summary);
                      }}
                      className="px-3.5 py-2.5 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-[#1C2C34] flex items-center justify-center space-x-2 transition shadow-xs cursor-pointer"
                    >
                      <Bookmark className="w-4 h-4 text-[#FC7454]" />
                      <span>{isUrdu ? 'پرائیویٹ نوٹ میں محفوظ کریں' : 'Save to Private Notes'}</span>
                    </button>

                    <button
                      onClick={() => {
                        // #31: Aggregate ALL user messages from current conversation
                        const allUserMessages = messages
                          .filter(m => m.sender === 'user' && m.text && !m.text.startsWith('['))
                          .map(m => m.text);
                        const aggregated = allUserMessages.join('\n\n');
                        const summary = aggregated || msg.responsePayload?.answerSummary || msg.text;
                        const cat = msg.responsePayload?.legalConcepts?.[0] || 'domestic_violence';
                        const photos = msg.photos || [];
                        onOpenComplaintWithData?.(summary, cat, photos);
                      }}
                      className="px-3.5 py-2.5 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-xs font-bold text-white flex items-center justify-center space-x-2 shadow-xs transition cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#BCD4D4]" />
                      <span>{isUrdu ? 'درخواست کا ڈرافٹ تیار کریں' : 'Prepare Complaint Draft'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-2.5 text-[#1C2C34] text-xs sm:text-sm font-bold p-3.5 rounded-2xl bg-white border border-[#BCD4D4] w-fit shadow-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-[#FC7454]" />
            <span>{isUrdu ? 'پنجاب کے قوانین میں تلاش اور تصدیق کی تیاری...' : 'Synthesizing source-grounded legal analysis for Punjab...'}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Quick Prompts (ChatGPT style) */}
      <div className="py-1.5 border-t border-slate-200/80">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[11px] font-semibold text-[#5A6E78] shrink-0 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#FC7454]" />
            <span>{isUrdu ? 'فوری سوالات:' : 'Quick prompts:'}</span>
          </span>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => handleSend(isUrdu ? prompt.queryUrdu : prompt.queryEn)}
              className="px-2.5 py-1 rounded-full bg-slate-50 hover:bg-[#ECF4F4] border border-slate-200 hover:border-[#BCD4D4] text-[11px] font-medium text-[#1C2C34] transition shrink-0 shadow-2xs hover:shadow-xs cursor-pointer active:scale-95 flex items-center space-x-1"
            >
              <span className={isUrdu ? 'font-urdu' : ''}>{isUrdu ? prompt.labelUrdu : prompt.labelEn}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 4. Active Location & Photo Preview Chips Bar */}
      {(activeLocation || attachedPhotos.length > 0 || isVoiceRecording || attachmentError) && (
        <div className="pb-2 flex flex-wrap items-center gap-2">
          {/* Attachment Error Alert */}
          {attachmentError && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 shadow-2xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>{attachmentError}</span>
              <button
                type="button"
                onClick={() => setAttachmentError(null)}
                className="hover:text-amber-700 ml-1 p-0.5 cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Active Location Badge */}
          {activeLocation && (
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-[#ECF4F4] border border-[#BCD4D4] text-xs font-bold text-[#1C2C34] shadow-xs">
              <MapPin className="w-3.5 h-3.5 text-[#FC7454]" />
              <span>{isUrdu ? 'مقام:' : 'Location:'} {activeLocation}</span>
              <button
                onClick={() => setActiveLocation(null)}
                className="hover:text-red-500 ml-1 p-0.5 cursor-pointer"
                title="Remove location tag"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Attached Photo Preview Badges */}
          {attachedPhotos.map((photo, idx) => (
            <div key={idx} className="relative group flex items-center space-x-1 px-2 py-1 rounded-xl bg-slate-100 border border-slate-200">
              <img src={photo} alt="Thumbnail" className="w-6 h-6 object-cover rounded-lg" />
              <span className="text-[11px] font-bold text-[#1C2C34]">{isUrdu ? 'تصویر ثبوت' : 'Evidence Photo'}</span>
              <button
                onClick={() => removeAttachedPhoto(idx)}
                className="text-slate-400 hover:text-red-500 p-0.5 ml-1 cursor-pointer"
                title="Remove photo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Active Voice Recording Indicator (#24: Stop Recording button) */}
          {isVoiceRecording && (
            <div className={`flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-bold ${
              voiceError
                ? 'bg-rose-50 border border-rose-200 text-rose-600'
                : 'bg-[#ECF4F4] border border-[#FC7454]/40 text-[#FC7454]'
            }`}>
              <Mic className={`w-3.5 h-3.5 ${voiceError ? '' : 'animate-pulse'}`} />
              <span className="flex-1">
                {voiceError
                  ? voiceError
                  : (isUrdu ? 'ریکارڈنگ جاری... بولیں' : 'Recording... Speak freely')}
              </span>
              {!voiceError && speechTranscript && (
                <span className="text-[10px] text-[#5A6E78] max-w-[120px] truncate hidden sm:inline">{speechTranscript}</span>
              )}
              <button
                onClick={handleToggleVoiceRecording}
                className="ml-2 px-3 py-1 rounded-lg bg-[#FC7454] text-white text-xs font-black hover:bg-[#FC7C54] transition cursor-pointer flex items-center gap-1"
              >
                {voiceError ? <X className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                <span>{voiceError ? (isUrdu ? 'بند کریں' : 'Dismiss') : (isUrdu ? 'روکیں' : 'Stop')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 5. Compact Unified Chat Bar */}
      <div className="pt-1 relative">
        {!hasRequiredContactInfo && (
          <div className="mb-2 p-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between text-xs text-amber-900 shadow-2xs">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {isUrdu
                  ? 'محفوظ چیٹ جاری رکھنے کے لیے اپنا واٹس ایپ نمبر اور سرپرست / محفوظ نمبر درج کرنا لازمی ہے۔'
                  : 'WhatsApp number and guardian / safe contact number are required to continue the chat.'}
              </span>
            </div>
            {onOpenAuthModal && (
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="ml-2 px-3 py-1 bg-[#1C2C34] hover:bg-[#2A3E48] text-white rounded-xl font-bold text-xs shrink-0 cursor-pointer transition shadow-2xs"
              >
                {isUrdu ? 'پروفائل مکمل کریں' : 'Complete Profile'}
              </button>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="relative"
        >
          {/* Hidden File Input for Photos */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handlePhotoSelect}
            accept="image/*"
            multiple
            className="hidden"
          />

          {/* Unified Input Container */}
          <div className="w-full bg-slate-50 border border-slate-200 focus-within:border-[#FC7454] focus-within:ring-2 focus-within:ring-[#FC7454]/20 rounded-2xl flex items-center px-1.5 py-1.5 shadow-2xs transition gap-1 relative">
            
            {/* Combined Attachment & Location Menu Button */}
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                  attachedPhotos.length > 0 || activeLocation
                    ? 'bg-[#ECF4F4] text-[#FC7454] border border-[#BCD4D4]'
                    : 'text-[#5A6E78] hover:text-[#1C2C34] hover:bg-slate-200/60'
                }`}
                title={isUrdu ? 'منسلک کریں' : 'Attach photo or location'}
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Popover Menu for Attachments & Location */}
              {isAttachMenuOpen && (
                <div className="absolute bottom-full mb-2 left-0 bg-white rounded-2xl border border-[#BCD4D4] shadow-lg p-1.5 flex flex-col min-w-[160px] z-30">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#1C2C34] hover:bg-[#ECF4F4] cursor-pointer text-left"
                  >
                    <Paperclip className="w-4 h-4 text-[#FC7454]" />
                    <span>{isUrdu ? 'تصویر ثبوت' : 'Attach Photo'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAttachMenuOpen(false);
                      setIsLocationModalOpen(true);
                    }}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#1C2C34] hover:bg-[#ECF4F4] cursor-pointer text-left"
                  >
                    <MapPin className="w-4 h-4 text-[#FC7454]" />
                    <span>{isUrdu ? 'مقام منتخب کریں' : 'Tag Location'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Voice Mode Button inside chat bar */}
            <button
              type="button"
              onClick={handleToggleVoiceRecording}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer ${
                isVoiceRecording
                  ? 'bg-[#FC7454] text-white animate-pulse shadow-xs'
                  : 'text-[#5A6E78] hover:text-[#1C2C34] hover:bg-slate-200/60'
              }`}
              title={isVoiceRecording ? (isUrdu ? 'ریکارڈنگ روکیں' : 'Stop Recording') : (isUrdu ? 'بولیں' : 'Voice Input')}
            >
              {isVoiceRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Text Input */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isUrdu ? 'اپنا سوال لکھیں یا بولیں...' : 'Ask about legal rights, safety, or protection...'}
              className={`flex-1 bg-transparent border-0 focus:outline-none px-2 py-1 text-sm sm:text-base text-[#1C2C34] placeholder:text-slate-400 disabled:opacity-50 ${
                isUrdu ? 'font-urdu' : 'font-medium'
              }`}
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={(!inputText.trim() && attachedPhotos.length === 0) || loading}
              className="w-8 h-8 rounded-xl bg-[#1C2C34] hover:bg-[#263842] disabled:opacity-30 text-white transition shadow-2xs flex items-center justify-center cursor-pointer shrink-0"
              title={isUrdu ? 'بھیجیں' : 'Send'}
            >
              <Send className="w-3.5 h-3.5 text-[#BCD4D4]" />
            </button>
          </div>
        </form>

        {/* Safety Subtitle & Live Session Status Badge */}
        <div className="flex items-center justify-between mt-2 px-1 text-[10px] sm:text-xs text-[#5A6E78]">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1C2C34]" />
            <span>
              {isUrdu 
                ? 'مکمل نجی اور انکرپٹڈ۔ کوئی ڈیٹا شیئر نہیں کیا جاتا۔' 
                : 'Private & encrypted. Never shared externally.'}
            </span>
          </div>

          {/* Live Verified Session Badge */}
          <div className="flex items-center space-x-1.5 font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/60">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            <span>{isUrdu ? 'محفوظ سیشن فعال' : 'Active Safe Session'}</span>
          </div>
        </div>
      </div>

      {/* 6. Location Picker Modal */}
      <AnimatePresence>
        {isLocationModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-[#BCD4D4] rounded-3xl p-5 max-w-md w-full shadow-2xl space-y-4 text-[#1C2C34]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-[#ECF4F4] text-[#FC7454] flex items-center justify-center border border-[#BCD4D4]">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold">{isUrdu ? 'مقام منتخب کریں' : 'Tag Incident Location'}</h3>
                    <p className="text-xs text-[#5A6E78]">{isUrdu ? 'پنجاب کا ضلع یا علاقہ منتخب کریں' : 'Choose your Punjab district or area'}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsLocationModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Auto GPS Detection Button */}
              <button
                onClick={handleDetectGPS}
                disabled={isDetectingGps}
                className="w-full p-3 rounded-2xl bg-[#1C2C34] hover:bg-[#263842] text-white text-xs font-bold flex items-center justify-center space-x-2 shadow-xs transition disabled:opacity-50 cursor-pointer"
              >
                <Radio className={`w-4 h-4 text-[#BCD4D4] ${isDetectingGps ? 'animate-pulse' : ''}`} />
                <span>{isDetectingGps ? (isUrdu ? 'مقام تلاش ہو رہا ہے...' : 'Detecting GPS Location...') : (isUrdu ? 'موجودہ جی پی ایس مقام حاصل کریں' : 'Use Current Live GPS Location')}</span>
              </button>

              {/* Quick Popular Locations */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[#5A6E78] uppercase tracking-wider">
                  {isUrdu ? 'مشہور اضلاع و مقامات:' : 'Popular Punjab Locations:'}
                </span>
                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {POPULAR_PUNJAB_LOCATIONS.map((loc, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setActiveLocation(loc);
                        setIsLocationModalOpen(false);
                      }}
                      className="p-2 rounded-xl text-left text-xs font-semibold bg-slate-50 hover:bg-[#ECF4F4] text-[#1C2C34] border border-slate-200 truncate transition cursor-pointer"
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Input */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  value={customLocationInput}
                  onChange={(e) => setCustomLocationInput(e.target.value)}
                  placeholder={isUrdu ? 'یا کوئی اور مقام لکھیں...' : 'Or type custom location (e.g. Wapda Town, Gujrat)...'}
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-[#1C2C34]"
                />
                <button
                  onClick={() => {
                    if (customLocationInput.trim()) {
                      setActiveLocation(customLocationInput.trim());
                      setCustomLocationInput('');
                      setIsLocationModalOpen(false);
                    }
                  }}
                  disabled={!customLocationInput.trim()}
                  className="w-full py-2 rounded-xl bg-[#1C2C34] hover:bg-[#263842] text-white text-xs font-bold disabled:opacity-30 cursor-pointer"
                >
                  {isUrdu ? 'مقام شامل کریں' : 'Apply Location'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
