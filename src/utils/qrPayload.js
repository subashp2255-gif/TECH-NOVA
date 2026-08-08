/**
 * SeatSync Entry QR Pass Payload Contract & Parser Utility
 * 
 * Canonical Format:
 * seatsync://entry?v=1&token=<stored_qr_token>
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Builds canonical SeatSync entry QR pass payload.
 * @param {string} qrToken - Stored qr_token or booking ID/code from bookings table
 * @returns {string} Canonical URI payload
 */
export function buildEntryQrPayload(qrToken) {
  if (!qrToken || typeof qrToken !== 'string') {
    return '';
  }
  const cleanToken = qrToken.trim();
  return `seatsync://entry?v=1&token=${encodeURIComponent(cleanToken)}`;
}

/**
 * Helper to log masked tokens in development mode only
 */
function logMaskedTokenInDev(rawInput, extractedToken) {
  try {
    const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') || 
                  (typeof import.meta !== 'undefined' && import.meta.env?.DEV);
    if (isDev && extractedToken) {
      const str = String(extractedToken);
      const prefix = str.length > 4 ? str.slice(0, 4) : str;
      const suffix = str.length > 8 ? str.slice(-4) : '****';
      console.debug('[QRParser] Decoded Masked Token:', {
        token_prefix: prefix,
        token_length: str.length,
        token_suffix: suffix
      });
    }
  } catch { /* ignore logging errors */ }
}

/**
 * Parses any scanned QR payload and extracts the clean reference token.
 * Supports:
 * - Plain booking UUIDs
 * - User-facing booking codes (e.g. BK-1785, BK-114312)
 * - JSON containing booking ID / code / token
 * - SeatSync URIs (seatsync://entry?v=1&token=...)
 * - Standard web URLs (http(s)://.../scan?token=... or ?bookingId=...)
 * 
 * @param {string} scannedValue - Raw decoded string from QR scanner/camera
 * @returns {string} Extracted clean reference token
 * @throws {Error} INVALID_QR_FORMAT, UNSUPPORTED_QR_VERSION, MISSING_QR_TOKEN
 */
export function parseEntryQrPayload(scannedValue) {
  const raw = String(scannedValue || '').trim();
  if (!raw) {
    throw new Error('MISSING_QR_TOKEN');
  }

  let extractedToken = null;

  // 1. SeatSync Custom Protocol URI
  if (raw.startsWith('seatsync://') || raw.startsWith('seatsync:')) {
    try {
      const dummyUrlStr = raw.replace(/^seatsync:(\/\/)?/, 'https://seatsync.local/');
      const url = new URL(dummyUrlStr);

      const version = url.searchParams.get('v');
      if (version && version !== '1') {
        throw new Error('UNSUPPORTED_QR_VERSION');
      }

      const token = (url.searchParams.get('token') || url.searchParams.get('bookingId') || url.searchParams.get('code'))?.trim();
      if (token) {
        extractedToken = decodeURIComponent(token);
      }
    } catch (err) {
      if (err.message === 'UNSUPPORTED_QR_VERSION') throw err;
      
      const match = raw.match(/[?&](token|bookingId|code|booking_code)=([^&]+)/);
      if (match && match[2]) {
        extractedToken = decodeURIComponent(match[2]).trim();
      } else {
        throw new Error('INVALID_QR_FORMAT');
      }
    }
  }
  // 2. HTTP/HTTPS Web URL
  else if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw);
      const token = (url.searchParams.get('token') || url.searchParams.get('bookingId') || url.searchParams.get('code') || url.searchParams.get('booking_code'))?.trim();
      if (token) {
        extractedToken = decodeURIComponent(token);
      } else {
        // Use path segment if URL contains UUID or BK code
        const segments = url.pathname.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1];
        if (lastSegment && (UUID_REGEX.test(lastSegment) || lastSegment.toUpperCase().startsWith('BK-') || lastSegment.toUpperCase().startsWith('QR-'))) {
          extractedToken = lastSegment;
        }
      }
    } catch {
      throw new Error('INVALID_QR_FORMAT');
    }
  }
  // 3. JSON Payload Format
  else if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const token = (parsed.token || parsed.qrToken || parsed.qr_token || parsed.bookingId || parsed.booking_id || parsed.bookingCode || parsed.booking_code || parsed.id)?.trim();
        if (token) {
          extractedToken = token;
        }
      }
    } catch {
      throw new Error('INVALID_QR_FORMAT');
    }
  }
  // 4. Raw Token String (e.g. UUID, "BK-1785", "QR-5406EB70F2DDE2EA", "SS-12345678-ABC")
  else if (!raw.includes('{') && !raw.includes('}')) {
    extractedToken = raw;
  }

  if (!extractedToken || !extractedToken.trim()) {
    throw new Error('MISSING_QR_TOKEN');
  }

  const cleanResult = extractedToken.trim();
  logMaskedTokenInDev(raw, cleanResult);
  return cleanResult;
}

/**
 * Returns structured object parsing raw QR input.
 * @param {string} scannedValue
 * @returns {{ bookingId?: string, bookingCode?: string, qrToken?: string, referenceToken: string }}
 */
export function parseEntryQrDetails(scannedValue) {
  const token = parseEntryQrPayload(scannedValue);
  const result = { referenceToken: token };

  if (UUID_REGEX.test(token)) {
    result.bookingId = token;
  } else if (token.toUpperCase().startsWith('BK-')) {
    result.bookingCode = token;
  } else {
    result.qrToken = token;
  }

  return result;
}
