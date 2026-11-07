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
        startTime: Math.round(startTime * 1000) / 1000,
        endTime: Math.round(Math.max(startTime + 0.3, endTime) * 1000) / 1000,
        text: clean,
      });
      fallbackId = cueId + 1;
    }
  }

  // Re-index sequentially by startTime so IDs are always clean 1..N
  return cues
    .sort((a, b) => a.startTime - b.startTime)
    .map((c, idx) => ({ ...c, id: idx + 1 }));
}

/**
 * Parses timestamp string (00:01:23,456 or 00:01:23.456 or 01:23.456) into seconds
 */
export function parseSrtTimestampToSeconds(timeStr: string): number | null {
  // Strip any WebVTT cue settings after the timestamp (e.g. "00:01:23.456 line:85%")
  const firstToken = timeStr.trim().split(/\s+/)[0] || '';
  const clean = firstToken.replace(',', '.');
  const matchHMS = clean.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (matchHMS) {
    const hours = parseInt(matchHMS[1], 10);
    const minutes = parseInt(matchHMS[2], 10);
    const seconds = parseInt(matchHMS[3], 10);
    const millis = parseInt(matchHMS[4].padEnd(3, '0').slice(0, 3), 10);
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  const matchMS = clean.match(/^(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (matchMS) {
    const minutes = parseInt(matchMS[1], 10);
    const seconds = parseInt(matchMS[2], 10);
    const millis = parseInt(matchMS[3].padEnd(3, '0').slice(0, 3), 10);
    return minutes * 60 + seconds + millis / 1000;
  }

  return parseTimeToSeconds(clean);
}

/**
 * Infers language ('nl' or 'en') from filename or subtitle text content
 */
export function detectSrtLanguage(fileName: string, cues: SubtitleCue[]): 'nl' | 'en' {
  const lowerName = fileName.toLowerCase();
  if (lowerName.includes('_nl.') || lowerName.includes('-nl.') || lowerName.includes('dutch') || lowerName.includes('nederlands')) {
    return 'nl';
  }
  if (lowerName.includes('_en.') || lowerName.includes('-en.') || lowerName.includes('english') || lowerName.includes('engels')) {
    return 'en';
  }
  // Heuristic check on common Dutch vs English words in the cues
  const sampleText = ' ' + cues.slice(0, 12).map((c) => c.text.toLowerCase()).join(' ') + ' ';
  const nlWords = [' de ', ' het ', ' een ', ' van ', ' en ', ' in ', ' op ', ' mijn ', ' niet ', ' met ', ' naar ', ' voor ', ' zijn '];
  const enWords = [' the ', ' and ', ' in ', ' of ', ' my ', ' to ', ' with ', ' for ', ' from ', ' that ', ' this ', ' into '];
  let nlScore = 0;
  let enScore = 0;
  for (const w of nlWords) if (sampleText.includes(w)) nlScore++;
  for (const w of enWords) if (sampleText.includes(w)) enScore++;
  return enScore > nlScore ? 'en' : 'nl';
}
