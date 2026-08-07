/**
 * SeatSync Entry QR Pass Payload Contract & Parser Utility
 * 
 * Canonical Format:
 * seatsync://entry?v=1&token=<stored_qr_token>
 * 
 * Compatible JSON Format:
 * {"v": 1, "type": "entry", "token": "<stored_qr_token>"}
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
 * Parses any scanned QR payload and extracts the clean stored_qr_token string.
 * Supports canonical URI, JSON objects, and legacy fallback strings.
 * 
 * @param {string} scannedValue - Raw decoded string from QR scanner/camera
 * @returns {string|null} Extracted token string, or null if unparseable/empty
 */
export function parseEntryQrPayload(scannedValue) {
  if (!scannedValue || typeof scannedValue !== 'string') {
    return null;
  }

  const trimmed = scannedValue.trim();
  if (!trimmed) return null;

  // Development mode logging (does not expose full tokens in production)
  if (process.env.NODE_ENV !== 'production') {
    const preview = trimmed.length > 25 ? `${trimmed.slice(0, 22)}...` : trimmed;
    console.debug('[QRParser] Decoded raw payload preview:', preview);
  }

  // 1. Check Canonical URI: seatsync://entry?v=1&token=...
  if (trimmed.startsWith('seatsync://')) {
    try {
      // Replace protocol with https for standard URL parsing
      const dummyUrl = new URL(trimmed.replace(/^seatsync:\/\//, 'https://seatsync.local/'));
      const tokenParam = dummyUrl.searchParams.get('token');
      if (tokenParam && tokenParam.trim()) {
        return tokenParam.trim();
      }
    } catch {
      // Manual regex fallback if URL parsing fails
      const match = trimmed.match(/[?&]token=([^&]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]).trim();
      }
    }
  }

  // 2. Check JSON Format: {"v": 1, "type": "entry", "token": "..."} or legacy JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (parsed.token && typeof parsed.token === 'string' && parsed.token.trim()) {
          return parsed.token.trim();
        }
        if (parsed.qrToken && typeof parsed.qrToken === 'string' && parsed.qrToken.trim()) {
          return parsed.qrToken.trim();
        }
        if (parsed.bookingId && typeof parsed.bookingId === 'string' && parsed.bookingId.trim()) {
          return parsed.bookingId.trim();
        }
        if (parsed.booking_id && typeof parsed.booking_id === 'string' && parsed.booking_id.trim()) {
          return parsed.booking_id.trim();
        }
      }
    } catch {
      /* Fallback to plain string extraction if JSON parsing fails */
    }
  }

  // 3. Fallback for plain token strings (e.g. "QR-5406EB70F2DDE2EA" or UUID or "BK-114312")
  // Exclude raw long JSON strings that failed to parse properly
  if (!trimmed.includes('{') && !trimmed.includes('}') && !trimmed.includes('http://') && !trimmed.includes('https://')) {
    return trimmed;
  }

  return null;
}
