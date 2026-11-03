/**
 * Formats a timestamp in seconds to standard MM:SS.mmm format for UI display
 */
export function formatTimeDisplay(seconds: number, includeMs = true): string {
  if (isNaN(seconds) || seconds < 0) return includeMs ? '00:00.00' : '00:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  const mm = mins.toString().padStart(2, '0');
  const ss = secs.toString().padStart(2, '0');
  const mmm = ms.toString().padStart(2, '0');

  return includeMs ? `${mm}:${ss}.${mmm}` : `${mm}:${ss}`;
}

/**
 * Formats a timestamp in seconds to standard SubRip (.srt) timestamp:
 * 00:01:23,456
 */
export function formatSecondsToSrt(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hh = hours.toString().padStart(2, '0');
  const mm = mins.toString().padStart(2, '0');
  const ss = secs.toString().padStart(2, '0');
  const mmm = ms.toString().padStart(3, '0');

  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Formats a timestamp in seconds to standard WebVTT (.vtt) timestamp:
 * 00:01:23.456
 */
export function formatSecondsToVtt(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hh = hours.toString().padStart(2, '0');
  const mm = mins.toString().padStart(2, '0');
  const ss = secs.toString().padStart(2, '0');
  const mmm = ms.toString().padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Parses user input string (e.g. "01:24.50", "00:01:24,500", or "84.5") into seconds
 */
export function parseTimeToSeconds(input: string): number | null {
  if (!input) return null;
  const clean = input.trim().replace(',', '.');

  // Check if it's already a single float or int
  if (!clean.includes(':')) {
    const num = parseFloat(clean);
    return isNaN(num) ? null : Math.max(0, num);
  }

  const parts = clean.split(':');
  if (parts.length === 2) {
    // mm:ss.ms
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    if (isNaN(mins) || isNaN(secs)) return null;
    return Math.max(0, mins * 60 + secs);
  } else if (parts.length === 3) {
    // hh:mm:ss.ms
    const hours = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    if (isNaN(hours) || isNaN(mins) || isNaN(secs)) return null;
    return Math.max(0, hours * 3600 + mins * 60 + secs);
  }

  return null;
}
