/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Context Resolver — Performs conversational entity and pronoun resolution
 * across multi-turn dialogs. Formulates an optimal, resolved search query for
 * RAG retrieval and extracts structured incident facts while faithfully preserving
 * user uncertainty.
 */

import { StoredMessage } from './context.js';

export interface StructuredIncidentContext {
  category?: string;
  location?: string;
  peopleInvolved?: string;
  threatLevel?: 'immediate' | 'ongoing' | 'past';
  timeline?: string;
  uncertaintyPhrases: string[];
}

export interface ContextResolutionResult {
  resolvedQuery: string;
  structuredIncident: StructuredIncidentContext;
  isFollowUp: boolean;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  inheritance_dispute: [
    'inheritance', 'wirasat', 'varasat', 'jaidad', 'property share', 'father property',
    'abu ki property', 'walid ki property', 'heirs', 'succession', 'mutation', 'intiqal',
    'wirasaat', 'وراثت', 'جائیداد', 'ترکہ', 'حق وراثت', 'وراثتی حق'
  ],
  property_dispute: [
    'property', 'land', 'plot', 'house', 'makan', 'khasra', 'registry', 'fard',
    'possession', 'qabza', 'dispossession', 'kabza', 'rent', 'tenant', 'landlord',
    'eviction', 'disowned', 'گھر سے نکال', 'قبضہ', 'پلاٹ', 'زمین', 'بے دخل'
  ],
  divorce_khula_family: [
    'divorce', 'khula', 'talaq', 'separation', 'nikahnama', 'mehr', 'dower',
    'maintenance', 'kharcha', 'custody', 'children', 'talaaq', 'طلاق', 'خلع',
    'مہر', 'خرچہ', 'نان نفقہ', 'حق مہر', 'بچوں کی کسٹڈی', 'علیحدگی'
  ],
  workplace_harassment: [
    'workplace', 'office', 'boss', 'manager', 'colleague', 'coworker', 'job',
    'employment', 'salary', 'harassment', 'harass', 'tang karna', 'harrash',
    'پریشان', 'ہراساں', 'دفتر'
  ],
  domestic_violence: [
    'husband', 'in-laws', 'sas', 'susar', 'shohar', 'home', 'domestic', 'marpeet',
    'tashaddud', 'wife', 'beaten', 'violence', 'abuse', 'mar peet', 'مار پیٹ',
    'تشدد', 'شوہر', 'ساس', 'سسر', 'گھریلو تشدد'
  ],
  cyber_harassment: [
    'whatsapp', 'facebook', 'instagram', 'online', 'photos', 'leaked', 'viral',
    'video', 'compromise', 'deepfake', 'cyber', 'messages', 'blackmail', 'leak',
    'private pictures', 'بلیک میل', 'تصاویر', 'سوشل میڈیا', 'بلیک میلنگ'
  ],
  public_stalking: [
    'stalking', 'stalker', 'following', 'peechha', 'bus stop', 'market', 'car',
    'bike', 'street', 'metro', 'پیچھا'
  ],
  forced_marriage: [
    'forced marriage', 'nikah', 'consent', 'quran', 'family pressure',
    'zabardasti shadi', 'shadi', 'زبردستی شادی', 'نکاح'
  ],
  child_marriage: [
    'child marriage', 'underage', 'minor marriage', 'kam umar shadi', 'کم عمری کی شادی'
  ],
  criminal_intimidation: [
    'threat', 'threaten', 'dhamki', 'kill', 'acid', 'destroy', 'consequences', 'دھمکی', 'تیزاب'
  ]
};

const UNCERTAINTY_PATTERNS = [
  /\b(i\s+think|i\s+believe|probably|maybe|might\s+be|approximately|around|about|not\s+sure|as\s+far\s+as\s+i\s+remember)\b/gi,
  /\b(شاید|میرا\s+خیال\s+ہے|تقریباً|یقین\s+سے\s+نہیں\s+کہہ\s+سکتی|اندازاً)\b/gi
];

/**
 * Resolves pronoun references and formulates an enriched search query for RAG.
 */
export function resolveConversationContext(
  currentQuery: string,
  language: 'en' | 'ur',
  history: StoredMessage[] = []
): ContextResolutionResult {
  const trimmed = currentQuery.trim();
  const lower = trimmed.toLowerCase();

  // 1. Detect uncertainty phrases in user statement
  const uncertaintyPhrases: string[] = [];
  for (const pattern of UNCERTAINTY_PATTERNS) {
    const matches = trimmed.match(pattern);
    if (matches) {
      uncertaintyPhrases.push(...matches.map(m => m.trim()));
    }
  }

  // 2. Extract structured incident context from the full conversation
  const structuredIncident: StructuredIncidentContext = {
    uncertaintyPhrases
  };

  // Compile full user narrative from history + current message
  const userNarratives = history
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .concat([currentQuery]);
  const combinedUserText = userNarratives.join(' ').toLowerCase();

  // Determine category
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(kw => combinedUserText.includes(kw))) {
      structuredIncident.category = cat;
      break;
    }
  }

  // Determine threat level
  if (/\b(right now|today|just now|outside right now|urgent|immediately|ابھی|فوری)\b/i.test(combinedUserText)) {
    structuredIncident.threatLevel = 'immediate';
  } else if (/\b(keeps|continuous|every day|repeatedly|روزانہ|مسلسل|بار بار)\b/i.test(combinedUserText)) {
    structuredIncident.threatLevel = 'ongoing';
  } else if (/\b(yesterday|last week|last month|ago|پہلے|گزشتہ)\b/i.test(combinedUserText)) {
    structuredIncident.threatLevel = 'past';
  }

  // Determine location (e.g. Lahore, Rawalpindi, Faisalabad, Multan, or generic 'workplace' / 'home')
  const districtMatch = combinedUserText.match(/\b(lahore|rawalpindi|faisalabad|multan|gujranwala|sialkot|bahawalpur|sargodha|sheikhupura)\b/i);
  if (districtMatch) {
    structuredIncident.location = districtMatch[1].charAt(0).toUpperCase() + districtMatch[1].slice(1);
  }

  // Check if current query is an ambiguous or dependent follow-up
  const isFollowUp = 
    trimmed.split(/\s+/).length <= 7 ||
    /\b(it|this|that|these|the incident|the situation|about it|about this|my options|what should i do|can i report|what evidence)\b/i.test(trimmed);

  // Synthesize resolved query
  let resolvedQuery = trimmed;

  if (isFollowUp && history.length > 0) {
    // Find recent incident details mentioned by user
    const recentUserMsgs = history.filter(m => m.role === 'user').slice(-3);
    const incidentContextSnippets: string[] = [];

    for (const msg of recentUserMsgs) {
      const text = msg.content;
      if (text.length > 5 && !/^(hi|hello|ok|thanks|yes|no)\b/i.test(text.trim())) {
        incidentContextSnippets.push(text);
      }
    }

    if (incidentContextSnippets.length > 0) {
      const contextSummary = incidentContextSnippets.join('; ').slice(0, 150);
      resolvedQuery = `${trimmed} (Context: ${contextSummary}${structuredIncident.category ? `, Category: ${structuredIncident.category}` : ''})`;
    }
  }

  return {
    resolvedQuery,
    structuredIncident,
    isFollowUp
  };
}

/**
 * Formats a structured case understanding block for the model context
 * instructing the agent on adaptive intake questioning according to the detected domain.
 */
export function formatCaseUnderstandingPrompt(structuredIncident: StructuredIncidentContext): string {
  if (!structuredIncident.category && !structuredIncident.threatLevel && !structuredIncident.location) {
    return '';
  }

  const parts: string[] = ['==================================================', 'ACTIVE CASE INTAKE ADVISORY (DYNAMIC INTAKE STATE)', '=================================================='];
  if (structuredIncident.category) {
    parts.push(`- Detected Primary Legal Category: ${structuredIncident.category.replace(/_/g, ' ').toUpperCase()}`);
  }
  if (structuredIncident.threatLevel) {
    parts.push(`- Urgency / Threat Level: ${structuredIncident.threatLevel.toUpperCase()}`);
  }
  if (structuredIncident.location) {
    parts.push(`- Location Mentioned in Conversation: ${structuredIncident.location}`);
  }
  if (structuredIncident.uncertaintyPhrases && structuredIncident.uncertaintyPhrases.length > 0) {
    parts.push(`- User Stated Uncertainty: (${structuredIncident.uncertaintyPhrases.join(', ')}). Preserve this uncertainty without assuming unproven facts.`);
  }

  parts.push(
    `- ADAPTIVE INTAKE DIRECTIVE: If key facts are still missing to determine the specific legal forum or remedy, do NOT immediately dump a generic textbook explanation. First acknowledge the issue with compassion, then ask 2 to 4 targeted, category-specific follow-up questions (per Sections 4-10 of your system instructions). Never ask for basic registration demographics (name, age, CNIC, guardian, current location) which are already verified in your prompt header.`
  );
  parts.push('==================================================');

  return parts.join('\n');
}

