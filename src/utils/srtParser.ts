import { SubtitleCue } from '../types/subtitle';
import { parseTimeToSeconds } from './timeFormat';

/**
 * Strips bracketed section headers like [Verse 1], [Chorus], [Bridge], etc.
 */
export function stripBrackets(text: string): string {
  return text.replace(/\[.*?\]/g, '').trim();
}

/**
 * Normalizes line endings (\r\n -> \n) and strips BOM
 */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parses raw lyric text into clean non-empty lines, ignoring empty lines and bracketed markers.
 */
export function parseCleanLyricLines(rawText: string): string[] {
  const normalized = normalizeText(rawText);
  return normalized
    .split('\n')
    .map((l) => stripBrackets(l))
    .filter((l) => l.length > 0);
}

/**
 * Robust SubRip (.srt) parser that parses cues into SubtitleCue format.
 */
export function parseSrtFile(srtContent: string): SubtitleCue[] {
  const normalized = normalizeText(srtContent).trim();
  if (!normalized) return [];

  // Split by double (or more) newlines separating subtitle blocks
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  let fallbackId = 1;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) continue;

    // Line 1 is often the index number (e.g. "1"), but could be omitted in some files
    let timeIndex = 0;
    let cueId = fallbackId;

    if (/^\d+$/.test(lines[0]) && lines.length > 1) {
      cueId = parseInt(lines[0], 10) || fallbackId;
      timeIndex = 1;
    }

    const timeLine = lines[timeIndex];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const timeParts = timeLine.split('-->');
    if (timeParts.length !== 2) continue;

    const startTime = parseSrtTimestampToSeconds(timeParts[0].trim());
    const endTime = parseSrtTimestampToSeconds(timeParts[1].trim());

    if (startTime === null || endTime === null) continue;

    // Remaining lines are the subtitle text
    const textLines = lines.slice(timeIndex + 1);
    const rawText = textLines.join(' ').trim();
    const clean = stripBrackets(rawText);

    if (clean.length > 0) {
      cues.push({
        id: cueId,
        startTime: Math.round(startTime * 100) / 100,
        endTime: Math.round(Math.max(startTime + 0.5, endTime) * 100) / 100,
        text: clean,
      });
      fallbackId = cueId + 1;
    }
  }

  // Sort by id / startTime
  return cues.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Parses timestamp string (00:01:23,456 or 00:01:23.456) into seconds
 */
export function parseSrtTimestampToSeconds(timeStr: string): number | null {
  const clean = timeStr.trim().replace(',', '.');
  const match = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) {
    // Try general parser
    return parseTimeToSeconds(clean);
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const millis = parseInt(match[4].padEnd(3, '0').slice(0, 3), 10);

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}
