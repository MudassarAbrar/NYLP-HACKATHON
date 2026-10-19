/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Twilio SMS dispatch (Prompt #2) — SERVER-SIDE ONLY.
 * Twilio credentials live exclusively in the server environment and are
 * never exposed to the client bundle.
 *
 * Behavior:
 * - Configured (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER):
 *   real SMS via the `twilio` SDK.
 * - Not configured: graceful "simulated" dispatch so demo flows still work
 *   end-to-end; every dispatch is honestly flagged `simulated` and logged
 *   to api_activity_logs with a simulated marker.
 * - Rate limit guardrail: max 5 SMS per hour per user (violations logged).
 *   Backed by api_activity_logs so the hourly counter survives restarts.
 */

// `twilio` is a CommonJS package whose named exports are assigned at runtime
// (namespace IIFE), so a named ESM import fails under Node. The default import
// resolves to the callable TwilioSDK factory; the class is only imported as a type.
import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { logApiActivity, countRecentActivityLogs } from './apiActivity.js';

export interface SmsDispatchResult {
  success: boolean;
  status: 'dispatched' | 'simulated' | 'failed' | 'rate_limited' | 'invalid_number';
  messageId: string;
  to: string;
  simulated: boolean;
  error?: string;
}

export interface SmsContact {
  id?: string;
  name: string;
  phone: string;
}

export interface SmsDispatchContext {
  userId?: string | null;
  accessToken?: string | null;
  /** Why this SMS is being sent (activity log context). */
  reason?: string;
}

const SMS_HOURLY_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** In-process sliding-window limiter (single-instance Express deployment). */
const rateBuckets = new Map<string, number[]>();

export function isTextBeeConfigured(): boolean {
  return Boolean(
    process.env.TEXTBEE_API_KEY &&
    process.env.TEXTBEE_DEVICE_ID
  );
}

export function isAndroidGatewayConfigured(): boolean {
  return Boolean(process.env.ANDROID_GATEWAY_URL);
}

export function isSmsConfigured(): boolean {
  return isTextBeeConfigured() || isAndroidGatewayConfigured() || Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

export function checkSmsRateLimit(userId: string): { allowed: boolean; sentInLastHour: number; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = (rateBuckets.get(userId) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  if (bucket.length >= SMS_HOURLY_LIMIT) {
    const oldest = bucket[0];
    return {
      allowed: false,
      sentInLastHour: bucket.length,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000))
    };
  }
  return { allowed: true, sentInLastHour: bucket.length, retryAfterSeconds: 0 };
}

function recordSmsSent(userId: string): void {
  const now = Date.now();
  const bucket = (rateBuckets.get(userId) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  bucket.push(now);
  rateBuckets.set(userId, bucket);
}

/** Normalizes to a +E.164-ish form Twilio accepts; returns null when hopeless. */
export function normalizePhone(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.replace(/[\s\-()]/g, '');
  const candidate = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  if (/^\+\d{8,15}$/.test(candidate)) return candidate;
  // Local Pakistani numbers (03xx… or 923xx...) get the +92 prefix automatically.
  if (/^0\d{10}$/.test(candidate)) return `+92${candidate.slice(1)}`;
  if (/^92\d{10}$/.test(candidate)) return `+${candidate}`;
  return null;
}

let twilioClient: Twilio | null = null;

function getTwilioClient(): Twilio | null {
  if (!isSmsConfigured()) return null;
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  }
  return twilioClient;
}

/** Core dispatch — one SMS to one recipient, fully logged. */
export async function sendSms(
  to: string,
  body: string,
  ctx: SmsDispatchContext = {}
): Promise<SmsDispatchResult> {
  const startedAt = Date.now();
  const normalized = normalizePhone(to);
  const baseLog = {
    endpoint: 'twilio:sms',
    method: 'POST',
    targetService: 'twilio' as const,
    userId: ctx.userId ?? null,
    accessToken: ctx.accessToken ?? null,
    requestPreview: { to: normalized || to, body: body.slice(0, 160), reason: ctx.reason || 'unspecified' }
  };

  if (!normalized) {
    const result: SmsDispatchResult = {
      success: false, status: 'invalid_number', messageId: '', to,
      simulated: false, error: 'Phone number is not a valid E.164 format.'
    };
    void logApiActivity({ ...baseLog, status: 'failed', statusCode: 400, errorMessage: result.error, durationMs: 0, responsePreview: result });
    return result;
  }

  if (ctx.userId) {
    const limit = checkSmsRateLimit(ctx.userId);
    // Persistent backing: the in-memory bucket resets on server restart, so
    // also count this user's real dispatches (status 201 rows) logged in the
    // last hour. Falls back to the in-memory verdict when no Supabase client
    // is available (offline dev).
    const persistedCount = await countRecentActivityLogs({
      userId: ctx.userId,
      accessToken: ctx.accessToken,
      endpoint: 'twilio:sms',
      statusCode: 201,
      windowMs: RATE_WINDOW_MS
    });
    if (!limit.allowed || (persistedCount !== null && persistedCount >= SMS_HOURLY_LIMIT)) {
      const retryAfterSeconds = limit.allowed
        ? Math.ceil(RATE_WINDOW_MS / 1000) // restart case — oldest dispatch age unknown
        : limit.retryAfterSeconds;
      const result: SmsDispatchResult = {
        success: false, status: 'rate_limited', messageId: '', to: normalized,
        simulated: false,
        error: `SMS rate limit reached (${SMS_HOURLY_LIMIT}/hour). Try again in ${Math.ceil(retryAfterSeconds / 60)} min.`
      };
      void logApiActivity({
        ...baseLog, status: 'failed', statusCode: 429,
        errorMessage: `RATE_LIMIT VIOLATION user=${ctx.userId}`, durationMs: 0,
        responsePreview: {
          rateLimited: true,
          sentInLastHour: Math.max(limit.sentInLastHour, persistedCount ?? 0)
        }
      });
      return result;
    }
  }

  // 1. TextBee Android Hardware Gateway (Direct SIM-to-SIM via secondary Android phone)
  if (isTextBeeConfigured()) {
    try {
      const apiKey = process.env.TEXTBEE_API_KEY!;
      const deviceId = process.env.TEXTBEE_DEVICE_ID!;
      const resp = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipients: [normalized],
          message: body
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && (data.success || data.data)) {
        if (ctx.userId) recordSmsSent(ctx.userId);
        const result: SmsDispatchResult = {
          success: true,
          status: 'dispatched',
          messageId: data.data?.smsBatchId || data.data?.id || `tb-${Date.now()}`,
          to: normalized,
          simulated: false
        };
        console.log(`[TextBee Android Gateway SMS Dispatched] to=${normalized} id=${result.messageId} reason=${ctx.reason || 'unspecified'}`);
        void logApiActivity({
          ...baseLog,
          targetService: 'textbee' as any,
          status: 'success',
          statusCode: 201,
          durationMs: Date.now() - startedAt,
          responsePreview: { status: 'dispatched', gateway: 'textbee_android_sim', data }
        });
        return result;
      } else {
        console.warn('[TextBee Gateway Dispatch Error]:', data.message || `Status ${resp.status}`);
      }
    } catch (err: any) {
      console.error('[TextBee Gateway Error]:', err?.message);
    }
  }

  // 2. Local Wi-Fi Android Gateway (e.g., http://192.168.x.x:8080/send)
  if (isAndroidGatewayConfigured()) {
    try {
      const gatewayUrl = process.env.ANDROID_GATEWAY_URL!;
      const resp = await fetch(gatewayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: normalized, message: body })
      });
      if (resp.ok) {
        if (ctx.userId) recordSmsSent(ctx.userId);
        const result: SmsDispatchResult = {
          success: true,
          status: 'dispatched',
          messageId: `local-gateway-${Date.now()}`,
          to: normalized,
          simulated: false
        };
        console.log(`[Local Android Gateway SMS Dispatched] to=${normalized}`);
        void logApiActivity({
          ...baseLog,
          targetService: 'local_android_gateway' as any,
          status: 'success',
          statusCode: 201,
          durationMs: Date.now() - startedAt
        });
        return result;
      }
    } catch (err: any) {
      console.error('[Local Android Gateway Error]:', err?.message);
    }
  }

  const client = getTwilioClient();
  if (!client) {
    const result: SmsDispatchResult = {
      success: true, status: 'simulated', messageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      to: normalized, simulated: true
    };
    console.log(`[Mehfooz SMS — SIMULATED] to=${normalized} reason=${ctx.reason || 'unspecified'} body="${body.slice(0, 120)}"`);
    void logApiActivity({
      ...baseLog, status: 'success', statusCode: 200, durationMs: Date.now() - startedAt,
      responsePreview: { simulated: true, messageId: result.messageId }
    });
    return result;
  }

  try {
    const fromNumber = process.env.TWILIO_FROM_NUMBER!;
    const message = await client.messages.create({
      to: normalized,
      // Messaging Service SIDs (MG…) are passed via messagingServiceSid.
      ...(fromNumber.startsWith('MG')
        ? { messagingServiceSid: fromNumber }
        : { from: fromNumber }),
      body
    });
    if (ctx.userId) recordSmsSent(ctx.userId);
    const result: SmsDispatchResult = {
      success: true, status: 'dispatched', messageId: message.sid, to: normalized, simulated: false
    };
    console.log(`[Mehfooz SMS Dispatch] to=${normalized} sid=${message.sid} reason=${ctx.reason || 'unspecified'}`);
    void logApiActivity({
      ...baseLog, status: 'success', statusCode: 201, durationMs: Date.now() - startedAt,
      responsePreview: { sid: message.sid, status: message.status }
    });
    return result;
  } catch (err: any) {
    const message = err?.message || 'Twilio dispatch failed';
    console.error('[Mehfooz SMS Dispatch Error]:', message);
    const result: SmsDispatchResult = {
      success: false, status: 'failed', messageId: `err-${Date.now()}`, to: normalized,
      simulated: false, error: message
    };
    void logApiActivity({
      ...baseLog, status: 'failed', statusCode: 502, durationMs: Date.now() - startedAt,
      errorMessage: message, responsePreview: { error: message }
    });
    return result;
  }
}

// =====================================================================
// Formatted safety templates (Prompt #2: name + GPS link + timestamp
// + battery level when available)
// =====================================================================

export function formatMapsLink(lat?: number | null, lng?: number | null): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

interface PhoneStatusContext {
  isSilent?: boolean;
  isCharging?: boolean;
}

export function cleanDestinationShort(dest?: string, maxLen = 42): string {
  if (!dest) return 'Destination';
  const clean = dest.replace(/[-—–→>]/g, ' to ').replace(/[\(\)\[\]\{\}]/g, '').trim();
  const segments = clean.split(',').map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return 'Destination';
  let short = segments[0];
  if (segments.length > 1 && (short.length + segments[1].length + 2) <= maxLen) {
    short = `${short}, ${segments[1]}`;
  }
  if (short.length > maxLen) {
    short = short.slice(0, maxLen).trim();
  }
  return short;
}

function appendSharedDetails(
  parts: string[], 
  lat?: number | null, 
  lng?: number | null, 
  batteryLevel?: number | null,
  status?: PhoneStatusContext
): void {
  const mapLink = formatMapsLink(lat, lng);
  if (mapLink) parts.push(`Live: ${mapLink}`);
  if (typeof batteryLevel === 'number' && batteryLevel >= 0) {
    const pct = Math.round(batteryLevel > 1 ? batteryLevel : batteryLevel * 100);
    const chargingStr = status?.isCharging ? ' (Charging)' : '';
    parts.push(`Battery: ${pct}%${chargingStr}`);
  }
  if (status?.isSilent) {
    parts.push(`Alert: Silent mode`);
  }
  parts.push(`Time: ${new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })} PKT`);
  parts.push('Sent via Mehfooz AI');
}

export function formatEmergencyMessage(params: {
  userName: string;
  lat?: number | null;
  lng?: number | null;
  batteryLevel?: number | null;
  helpline?: string;
  isSilent?: boolean;
  isCharging?: boolean;
}): string {
  const cleanName = (params.userName || 'User').replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
  const parts = [
    `Mehfooz AI Emergency Alert`,
    `${cleanName} triggered emergency SOS and may need assistance.`
  ];
  if (params.helpline) parts.push(`Contacting: ${params.helpline}`);
  appendSharedDetails(parts, params.lat, params.lng, params.batteryLevel, {
    isSilent: params.isSilent,
    isCharging: params.isCharging
  });
  return parts.join('\n');
}

export function formatCheckInMissedMessage(params: {
  userName: string;
  destination: string;
  departure?: string | null;
  lat?: number | null;
  lng?: number | null;
  expectedArrival?: string | null;
  batteryLevel?: number | null;
  isSilent?: boolean;
  isCharging?: boolean;
  phoneStatus?: string | null;
}): string {
  const cleanDest = cleanDestinationShort(params.destination, 40);
  const cleanDept = params.departure ? cleanDestinationShort(params.departure, 40) : null;
  const cleanName = (params.userName || 'User').replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();

  const parts: string[] = [
    `URGENT: Mehfooz Safety Alert!`,
    `Your child/family member ${cleanName} has NOT reached yet and timer is UP!`
  ];

  if (cleanDept) {
    parts.push(`Departure: ${cleanDept}`);
  }
  parts.push(`Destination: ${cleanDest}`);

  if (typeof params.lat === 'number' && typeof params.lng === 'number') {
    parts.push(`Coordinates: ${params.lat.toFixed(5)}, ${params.lng.toFixed(5)}`);
    parts.push(`Live Map: https://maps.google.com/?q=${params.lat.toFixed(5)},${params.lng.toFixed(5)}`);
  }

  if (typeof params.batteryLevel === 'number' && params.batteryLevel >= 0) {
    const pct = Math.round(params.batteryLevel > 1 ? params.batteryLevel : params.batteryLevel * 100);
    const chargingStr = params.isCharging ? ' (Charging)' : ' (Unplugged)';
    parts.push(`Battery: ${pct}%${chargingStr}`);
  }

  const statusStr = params.phoneStatus || (params.isSilent ? 'Silent mode' : 'Active Ringer');
  parts.push(`Phone Status: ${statusStr}`);
  parts.push(`Time: ${new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })} PKT`);
  parts.push(`Action: Please call or check on her immediately.`);
  parts.push(`Sent via Mehfooz AI`);

  return parts.join('\n');
}

export function formatCheckInMissedWhatsAppMessage(params: {
  userName: string;
  destination: string;
  departure?: string | null;
  lat?: number | null;
  lng?: number | null;
  expectedArrival?: string | null;
  batteryLevel?: number | null;
  isSilent?: boolean;
  isCharging?: boolean;
  phoneStatus?: string | null;
}): string {
  const cleanDest = cleanDestinationShort(params.destination, 60);
  const cleanDept = params.departure ? cleanDestinationShort(params.departure, 60) : null;
  const cleanName = (params.userName || 'User').replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
  const eta = params.expectedArrival
    ? new Date(params.expectedArrival).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })
    : '';
  const mapLink = formatMapsLink(params.lat, params.lng);
  const coordStr = typeof params.lat === 'number' && typeof params.lng === 'number'
    ? `\n*Coordinates:* ${params.lat.toFixed(5)}° N, ${params.lng.toFixed(5)}° E`
    : '';
  const nowTime = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });

  const batteryText = typeof params.batteryLevel === 'number' && params.batteryLevel >= 0
    ? `\n*Phone Battery:* ${Math.round(params.batteryLevel > 1 ? params.batteryLevel : params.batteryLevel * 100)}%${params.isCharging ? ' (Charging)' : ' (Unplugged)'}`
    : '';
  const statusStr = params.phoneStatus || (params.isSilent ? 'Silent mode' : 'Active Ringer');
  const modeText = `\n*Phone Status:* ${statusStr}`;

  return `*URGENT: MEHFOOZ SAFETY ALERT — TIMER IS UP*
⚠️ *Please check on / look for your child or family member!*
*${cleanName}* has NOT reached her destination and timer is UP!

📞 *Action Required:* Please call her immediately to check on her safety!
${cleanDept ? `*Departure Point:* ${cleanDept}\n` : ''}*Destination Point:* ${cleanDest}${eta ? `\n*Expected Arrival Was:* ${eta} PKT` : ''}${coordStr}${mapLink ? `\n*Live Coordinates / Map:* ${mapLink}` : ''}${batteryText}${modeText}
*Alert Triggered:* ${nowTime} PKT
— Mehfooz AI Safety Network`;
}

export function formatCheckInSafeMessage(params: { userName: string }): string {
  const cleanName = (params.userName || 'User').replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
  return `*Mehfooz AI Safe Arrival Notice*\n${cleanName} has confirmed safe arrival. No further action needed.`;
}

// =====================================================================
// Multi-contact dispatch helpers
// =====================================================================

export async function sendEmergencyAlert(
  contacts: SmsContact[],
  params: {
    userName: string;
    lat?: number | null;
    lng?: number | null;
    batteryLevel?: number | null;
    helpline?: string;
  } & SmsDispatchContext
): Promise<SmsDispatchResult[]> {
  const body = formatEmergencyMessage(params);
  const results: SmsDispatchResult[] = [];
  for (const contact of contacts) {
    results.push(await sendSms(contact.phone, `${contact.name ? '' : ''}${body}`, {
      userId: params.userId,
      accessToken: params.accessToken,
      reason: `crisis_alert${params.helpline ? `:${params.helpline}` : ''}`
    }));
  }
  return results;
}

/** Send WhatsApp via Twilio (#21). Same Messages API, prefixed with whatsapp:. */
export async function sendWhatsApp(
  to: string,
  body: string,
  ctx: SmsDispatchContext = {}
): Promise<SmsDispatchResult> {
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { success: false, status: 'invalid_number', messageId: '', to, simulated: false, error: 'Invalid phone.' };
  }

  const client = getTwilioClient();
  const waFrom = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_NUMBER;

  if (!client || !waFrom) {
    // Simulated WhatsApp when Twilio or WhatsApp number not configured
    const result: SmsDispatchResult = {
      success: true, status: 'simulated',
      messageId: `wa-sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      to: `whatsapp:${normalized}`, simulated: true
    };
    console.log(`[Mehfooz WhatsApp — SIMULATED] to=${normalized} reason=${ctx.reason || 'unspecified'}`);
    void logApiActivity({
      endpoint: 'twilio:whatsapp', method: 'POST', targetService: 'twilio' as const,
      userId: ctx.userId ?? null, accessToken: ctx.accessToken ?? null,
      status: 'success', statusCode: 200, durationMs: 0,
      requestPreview: { to: `whatsapp:${normalized}`, body: body.slice(0, 160), reason: ctx.reason },
      responsePreview: { simulated: true, messageId: result.messageId }
    });
    return result;
  }

  try {
    const message = await client.messages.create({
      to: `whatsapp:${normalized}`,
      from: `whatsapp:${waFrom}`,
      body
    });
    const result: SmsDispatchResult = {
      success: true, status: 'dispatched', messageId: message.sid,
      to: `whatsapp:${normalized}`, simulated: false
    };
    void logApiActivity({
      endpoint: 'twilio:whatsapp', method: 'POST', targetService: 'twilio' as const,
      userId: ctx.userId ?? null, accessToken: ctx.accessToken ?? null,
      status: 'success', statusCode: 201, durationMs: 0,
      requestPreview: { to: `whatsapp:${normalized}`, body: body.slice(0, 160), reason: ctx.reason },
      responsePreview: { sid: message.sid, status: message.status }
    });
    return result;
  } catch (err: any) {
    const msg = err?.message || 'WhatsApp dispatch failed';
    const result: SmsDispatchResult = {
      success: false, status: 'failed', messageId: `wa-err-${Date.now()}`,
      to: `whatsapp:${normalized}`, simulated: false, error: msg
    };
    void logApiActivity({
      endpoint: 'twilio:whatsapp', method: 'POST', targetService: 'twilio' as const,
      userId: ctx.userId ?? null, accessToken: ctx.accessToken ?? null,
      status: 'failed', statusCode: 502, durationMs: 0,
      errorMessage: msg, responsePreview: { error: msg }
    });
    return result;
  }
}

/** Send both SMS + WhatsApp when a journey/check-in starts (#19, #21). */
export async function sendJourneyStartAlert(
  contacts: SmsContact[],
  params: {
    userName: string;
    destination: string;
    expectedMinutes: number;
    lat?: number | null;
    lng?: number | null;
  } & SmsDispatchContext
): Promise<{ sms: SmsDispatchResult[]; whatsapp: SmsDispatchResult[] }> {
  const cleanDest = cleanDestinationShort(params.destination, 42);
  const cleanName = (params.userName || 'User').replace(/[-—–→]/g, ' ').replace(/[\(\)\[\]\{\}]/g, '').trim();
  const eta = new Date(Date.now() + params.expectedMinutes * 60000)
    .toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  const mapLink = formatMapsLink(params.lat, params.lng);

  // Compact SMS format: avoids carrier multi-part modem errors & stays within GSM limit
  const smsBody = `Mehfooz AI Safety Check In:\n${cleanName} heading to ${cleanDest}.\nETA: ${eta} (${params.expectedMinutes}m).${mapLink ? `\nLive: ${mapLink}` : ''}\nYou will be alerted if arrival unconfirmed.`;
  // Rich WhatsApp format
  const waBody = `*Mehfooz AI Safety Check In*\n${cleanName} started a journey to ${cleanDest}.\n*Expected Arrival:* ${eta} (${params.expectedMinutes} mins)${mapLink ? `\n*Live Location:* ${mapLink}` : ''}\nYou will be alerted if arrival is not confirmed on time.`;

  const sms: SmsDispatchResult[] = [];
  const whatsapp: SmsDispatchResult[] = [];
  for (const c of contacts) {
    sms.push(await sendSms(c.phone, smsBody, { userId: params.userId, accessToken: params.accessToken, reason: 'journey_start_sms' }));
    whatsapp.push(await sendWhatsApp(c.phone, waBody, { userId: params.userId, accessToken: params.accessToken, reason: 'journey_start_whatsapp' }));
  }
  return { sms, whatsapp };
}

export async function sendCheckInAlert(
  contacts: SmsContact[],
  params: {
    userName: string;
    destination: string;
    departure?: string | null;
    lat?: number | null;
    lng?: number | null;
    expectedArrival?: string | null;
    batteryLevel?: number | null;
    isSilent?: boolean;
    isCharging?: boolean;
    phoneStatus?: string | null;
  } & SmsDispatchContext
): Promise<{ sms: SmsDispatchResult[]; whatsapp: SmsDispatchResult[] }> {
  const smsBody = formatCheckInMissedMessage(params);
  const waBody = formatCheckInMissedWhatsAppMessage(params);
  const sms: SmsDispatchResult[] = [];
  const whatsapp: SmsDispatchResult[] = [];
  for (const contact of contacts) {
    sms.push(await sendSms(contact.phone, smsBody, {
      userId: params.userId,
      accessToken: params.accessToken,
      reason: 'check_in_missed_sms'
    }));
    whatsapp.push(await sendWhatsApp(contact.phone, waBody, {
      userId: params.userId,
      accessToken: params.accessToken,
      reason: 'check_in_missed_whatsapp'
    }));
  }
  return { sms, whatsapp };
}
