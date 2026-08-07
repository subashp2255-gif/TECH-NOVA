/**
 * SeatSync Entry QR Pass Payload Contract & Parser Utility
 * 
 * Canonical Format:
 * seatsync://entry?v=1&token=<stored_qr_token>
 */

/**
 * Builds canonical SeatSync entry QR pass payload.
 * @param {string} qrToken - Stored qr_token from bookings table
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
 * Parses any scanned QR payload and extracts the clean stored qr_token string.
 * Supports canonical URI (seatsync://entry?v=1&token=...), JSON objects, and raw tokens.
 * 
 * @param {string} scannedValue - Raw decoded string from QR scanner/camera
 * @returns {string} Extracted token string
 * @throws {Error} INVALID_QR_FORMAT, UNSUPPORTED_QR_VERSION, MISSING_QR_TOKEN
 */
export function parseEntryQrPayload(scannedValue) {
  const raw = String(scannedValue || '').trim();
  if (!raw) {
    throw new Error('MISSING_QR_TOKEN');
  }

  let extractedToken = null;

  // 1. Check Canonical URI format
  if (raw.startsWith('seatsync://') || raw.startsWith('seatsync:')) {
    try {
      // Replace protocol to parse with standard URL class regardless of hostname vs pathname handling
      const dummyUrlStr = raw.replace(/^seatsync:(\/\/)?/, 'https://seatsync.local/');
      const url = new URL(dummyUrlStr);

      const version = url.searchParams.get('v');
      if (version && version !== '1') {
        throw new Error('UNSUPPORTED_QR_VERSION');
      }

      const token = url.searchParams.get('token')?.trim();
      if (token) {
        extractedToken = decodeURIComponent(token);
      }
    } catch (err) {
      if (err.message === 'UNSUPPORTED_QR_VERSION') throw err;
      
      // Fallback regex for URI query parameter token
      const match = raw.match(/[?&]token=([^&]+)/);
      if (match && match[1]) {
        extractedToken = decodeURIComponent(match[1]).trim();
      } else {
        throw new Error('INVALID_QR_FORMAT');
      }
    }
  } 
  // 2. Check JSON payload format
  else if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const token = (parsed.token || parsed.qrToken || parsed.qr_token || parsed.bookingId || parsed.id)?.trim();
        if (token) {
          extractedToken = token;
        }
      }
    } catch {
      throw new Error('INVALID_QR_FORMAT');
    }
  } 
  // 3. Raw Token string format (e.g. "QR-5406EB70F2DDE2EA", UUID, or "BK-114312")
  else if (!raw.includes('{') && !raw.includes('}') && !raw.includes('http://') && !raw.includes('https://')) {
    extractedToken = raw;
  }

  if (!extractedToken) {
    throw new Error('MISSING_QR_TOKEN');
  }

  logMaskedTokenInDev(raw, extractedToken);
  return extractedToken;
}
