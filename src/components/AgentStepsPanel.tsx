/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentStepsPanel — collapsible panel showing the agent's reasoning steps.
 * Synchronizes with actual agent execution state so completed responses
 * show all steps completed without stale "in progress" states.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { AgentStep } from '../types';

interface AgentStepsPanelProps {
  steps: AgentStep[];
  isUrdu?: boolean;
  isComplete?: boolean;
}

/** Maps raw tool names or common step labels to user-friendly localized labels. */
const SAFE_STEP_LABELS: Record<string, { en: string; ur: string }> = {
  search_legal_corpus: { en: 'Searching legal corpus…', ur: 'قانونی مجموعہ تلاش ہو رہا ہے…' },
  look_up_support_directory: { en: 'Looking up support resources…', ur: 'مدد کے وسائل تلاش ہو رہے ہیں…' },
  get_complaint_status: { en: 'Checking complaint status…', ur: 'شکایت کی حیثیت دیکھی جا رہی ہے…' },
  open_crisis_modal: { en: 'Opening crisis support…', ur: 'ہنگامی مدد کھولی جا رہی ہے…' },
  open_complaint_builder: { en: 'Opening complaint builder…', ur: 'شکایت ڈرافٹر کھولا جا رہا ہے…' },
  prepare_complaint_draft: { en: 'Preparing complaint draft…', ur: 'شکایت کا مسودہ تیار ہو رہا ہے…' },
  save_incident_to_vault: { en: 'Saving to private vault…', ur: 'پرائیویٹ والٹ میں محفوظ ہو رہا ہے…' },
  start_safety_checkin: { en: 'Starting safety check-in…', ur: 'سیفٹی چیک ان شروع ہو رہا ہے…' },
  send_sms_to_contact: { en: 'Preparing SMS…', ur: 'پیغام تیار ہو رہا ہے…' },
  email_complaint_to_authority: { en: 'Preparing email…', ur: 'ای میل تیار ہو رہا ہے…' },
};

const COMMON_LABEL_MAP: Record<string, { en: string; ur: string }> = {
  'Reasoning grounded response…': { en: 'Reasoning grounded legal response…', ur: 'قانونی بنیاد پر جواب تیار ہو رہا ہے…' },
  'Reasoning grounded response...': { en: 'Reasoning grounded legal response…', ur: 'قانونی بنیاد پر جواب تیار ہو رہا ہے…' },
  'Searching verified Punjab legal corpus…': { en: 'Searching verified Punjab legal corpus…', ur: 'پنجاب کے تصدیق شدہ قوانین میں تلاش…' },
  'Verifying safety and legal accuracy…': { en: 'Verifying safety and legal accuracy…', ur: 'حفاظتی اور قانونی درستگی کی تصدیق…' },
  'Loading conversation…': { en: 'Loading conversation context…', ur: 'گفتگو کا ریکارڈ لوڈ ہو رہا ہے…' },
  'Immediate safety alert detected': { en: 'Immediate safety alert checked', ur: 'فوری حفاظتی جانچ مکمل' },
  'Checking request domain': { en: 'Checking legal & safety domain', ur: 'قانونی دائرہ کار کی جانچ' },
  'Preparing confirmation…': { en: 'Preparing action confirmation…', ur: 'کارروائی کی تصدیق کی تیاری…' },
  'Waiting for your approval…': { en: 'Waiting for your approval…', ur: 'آپ کی منظوری کا انتظار…' },
  'Looking up information…': { en: 'Looking up legal information…', ur: 'معلومات حاصل کی جا رہی ہیں…' }
};

function getSafeLabel(step: AgentStep, isUrdu: boolean): string {
  if (step.toolName && SAFE_STEP_LABELS[step.toolName]) {
    return isUrdu ? SAFE_STEP_LABELS[step.toolName].ur : SAFE_STEP_LABELS[step.toolName].en;
  }
  const cleanLabel = step.label?.trim();
  if (cleanLabel && COMMON_LABEL_MAP[cleanLabel]) {
    return isUrdu ? COMMON_LABEL_MAP[cleanLabel].ur : COMMON_LABEL_MAP[cleanLabel].en;
  }
  return step.label;
}

function StatusIcon({ status }: { status: AgentStep['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
    case 'active':
      return <Loader2 className="w-3.5 h-3.5 text-[#FC7454] animate-spin shrink-0" />;
    case 'waiting':
      return <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    case 'failed':
      return <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
    default:
      return <div className="w-3.5 h-3.5 rounded-full bg-slate-200 shrink-0" />;
  }
}

function statusLabel(status: AgentStep['status'], isUrdu: boolean): string {
  switch (status) {
    case 'completed': return isUrdu ? 'مکمل' : 'Completed';
    case 'active': return isUrdu ? 'جاری ہے' : 'In Progress';
    case 'waiting': return isUrdu ? 'انتظار' : 'Waiting';
    case 'failed': return isUrdu ? 'ناکام' : 'Failed';
    default: return '';
  }
}

export const AgentStepsPanel: React.FC<AgentStepsPanelProps> = ({ 
  steps, 
  isUrdu = false, 
  isComplete = true 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!steps || steps.length === 0) return null;

  // 1. If response is complete, normalize any lingering 'active' step into 'completed'
  const normalizedSteps = steps.map((step) => {
    if (isComplete && step.status === 'active') {
      return { ...step, status: 'completed' as const };
    }
    return step;
  });

  // 2. Deduplicate consecutive identical steps (e.g. repeated reasoning fallback attempts)
  const cleanedSteps: AgentStep[] = [];
  for (const s of normalizedSteps) {
    const prev = cleanedSteps[cleanedSteps.length - 1];
    if (prev && prev.label === s.label && prev.toolName === s.toolName) {
      if (s.status === 'completed' || prev.status === 'completed') {
        prev.status = 'completed';
      }
      continue;
    }
    cleanedSteps.push({ ...s });
  }

  const hasActive = cleanedSteps.some(s => s.status === 'active');
  const hasWaiting = cleanedSteps.some(s => s.status === 'waiting');
  const completedCount = cleanedSteps.filter(s => s.status === 'completed').length;
  const isAllCompleted = completedCount === cleanedSteps.length;

  return (
    <div className="mt-2 rounded-xl border border-[#BCD4D4]/40 bg-[#F8FBFB] overflow-hidden transition-all shadow-2xs">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-[#ECF4F4]/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          {hasActive ? (
            <Loader2 className="w-3.5 h-3.5 text-[#FC7454] animate-spin shrink-0" />
          ) : hasWaiting ? (
            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          )}

          <span className="font-bold text-[#1C2C34]">
            {isUrdu ? 'کارروائی کے مراحل' : 'Agent Steps'}
          </span>

          <span className="text-[#5A6E78] font-mono font-medium text-[11px]">
            ({completedCount}/{cleanedSteps.length})
          </span>

          {isAllCompleted ? (
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold tracking-tight">
              {isUrdu ? 'مکمل شدہ' : 'Completed'}
            </span>
          ) : hasActive ? (
            <span className="px-1.5 py-0.5 rounded-md bg-orange-50 text-[#FC7454] border border-orange-200 text-[9px] font-bold tracking-tight">
              {isUrdu ? 'جاری ہے' : 'In Progress'}
            </span>
          ) : hasWaiting ? (
            <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold tracking-tight">
              {isUrdu ? 'انتظار' : 'Pending Approval'}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 text-[#5A6E78]">
          <span className="text-[10px] hidden sm:inline">
            {isExpanded ? (isUrdu ? 'چھپائیں' : 'Hide') : (isUrdu ? 'تفصیلات' : 'Details')}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </div>
      </button>

      {/* Expanded step list */}
      {isExpanded && (
        <div className="px-3 pb-2.5 pt-1 space-y-1.5 border-t border-slate-100">
          {cleanedSteps.map((step) => (
            <div key={step.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5">
              <div className="flex items-center gap-2 overflow-hidden">
                <StatusIcon status={step.status} />
                <span className="text-[#1C2C34] font-medium truncate">
                  {getSafeLabel(step, isUrdu)}
                </span>
              </div>
              <span className={`font-bold text-[10px] shrink-0 ${
                step.status === 'completed' ? 'text-emerald-700' :
                step.status === 'active' ? 'text-[#FC7454]' :
                step.status === 'waiting' ? 'text-amber-700' :
                step.status === 'failed' ? 'text-rose-600' :
                'text-[#5A6E78]'
              }`}>
                {statusLabel(step.status, isUrdu)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
