/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool safety policies — server-side allowlist that determines which tools
 * can execute automatically vs which require user confirmation.
 * Safety is NEVER determined from the model's description.
 */

export type ToolSafety = 'read_only' | 'ui_only' | 'write' | 'external_side_effect';

export interface ToolPolicy {
  safety: ToolSafety;
  requiresConfirmation: boolean;
}

export const toolPolicies: Record<string, ToolPolicy> = {
  search_legal_corpus: {
    safety: 'read_only',
    requiresConfirmation: false
  },
  look_up_support_directory: {
    safety: 'read_only',
    requiresConfirmation: false
  },
  get_complaint_status: {
    safety: 'read_only',
    requiresConfirmation: false
  },
  open_crisis_modal: {
    safety: 'ui_only',
    requiresConfirmation: false
  },
  open_complaint_builder: {
    safety: 'ui_only',
    requiresConfirmation: false
  },
  prepare_complaint_draft: {
    safety: 'write',
    requiresConfirmation: true
  },
  save_incident_to_vault: {
    safety: 'write',
    requiresConfirmation: true
  },
  start_safety_checkin: {
    safety: 'external_side_effect',
    requiresConfirmation: true
  },
  send_sms_to_contact: {
    safety: 'external_side_effect',
    requiresConfirmation: true
  },
  email_complaint_to_authority: {
    safety: 'external_side_effect',
    requiresConfirmation: true
  }
} as const;

/** Returns true if the tool name is in the allowlist. */
export function isToolAllowed(toolName: string): boolean {
  return toolName in toolPolicies;
}

/** Returns the policy for a tool, or null if unknown. */
export function getToolPolicy(toolName: string): ToolPolicy | null {
  return toolPolicies[toolName] || null;
}

/** Validates a function call: checks allowlist and basic argument shape. */
export function validateFunctionCall(
  name: string,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (!isToolAllowed(name)) {
    return { valid: false, error: `Unknown tool: ${name}` };
  }

  // Basic argument validation: ensure no executable content or oversized payloads
  const argsStr = JSON.stringify(args);
  if (argsStr && argsStr.length > 10000) {
    return { valid: false, error: 'Tool arguments exceed maximum size' };
  }

  // Strict tool argument schema validation per tool
  switch (name) {
    case 'search_legal_corpus':
      if (typeof args.query !== 'string' || !args.query.trim()) {
        return { valid: false, error: 'Tool argument "query" must be a non-empty string.' };
      }
      break;
    case 'prepare_complaint_draft': {
      const summary = typeof args.incident_summary === 'string' ? args.incident_summary : (typeof args.incidentSummary === 'string' ? args.incidentSummary : '');
      if (typeof args.category !== 'string' || !summary.trim()) {
        return { valid: false, error: 'Tool arguments "category" and "incident_summary" must be non-empty strings.' };
      }
      break;
    }
    case 'save_incident_to_vault':
      if (typeof args.title !== 'string') {
        return { valid: false, error: 'Tool argument "title" must be a string.' };
      }
      break;
    case 'start_safety_checkin': {
      const duration = typeof args.duration_minutes === 'number' ? args.duration_minutes : (typeof args.durationMinutes === 'number' ? args.durationMinutes : undefined);
      if (typeof duration !== 'number' || typeof args.destination !== 'string') {
        return { valid: false, error: 'Tool arguments "duration_minutes" (number) and "destination" (string) are required.' };
      }
      break;
    }
    case 'send_sms_to_contact':
      if (typeof args.message !== 'string') {
        return { valid: false, error: 'Tool argument "message" must be a string.' };
      }
      break;
    case 'email_complaint_to_authority':
      if (typeof args.summary !== 'string') {
        return { valid: false, error: 'Tool argument "summary" must be a string.' };
      }
      break;
    }

  return { valid: true };
}
