import { SubtitleCue, SupportedLanguage } from '../types/subtitle';
import { formatSecondsToSrt, formatSecondsToVtt } from './timeFormat';

/**
 * Strips any bracketed indicators like [Verse 1], [Chorus], [Bridge], [Intro], etc.
 */
export function stripSquareBrackets(text: string): string {
  return text.replace(/\[.*?\]/g, '').trim();
}

/**
 * Computes the subtitle filename with language suffix:
 * English -> `<name>_EN.<ext>`
 * Dutch   -> `<name>_NL.<ext>`
 */
export function getSubtitleFilename(
  baseName: string,
  format: 'srt' | 'vtt',
  language?: SupportedLanguage | null
): string {
  let cleanBase = stripSquareBrackets(baseName)
    .replace(/\.[^/.]+$/, '')
    .trim() || 'subtitles';

  const suffix = language === 'nl' ? '_NL' : language === 'en' ? '_EN' : '';

  if (suffix) {
    // Prevent duplicate suffixes if the filename already ends with _EN or _NL
    cleanBase = cleanBase.replace(new RegExp(`(${suffix})$`, 'i'), '');
    cleanBase = `${cleanBase}${suffix}`;
  }

  return `${cleanBase}.${format}`;
}

/**
 * Generates SubRip (.srt) subtitle text content.
 * Strictly ignores bracketed markers [verse 1], [chorus], etc.
 * Guarantees monotonic timestamp progression and preserves all cues in order.
 */
export function generateSrt(cues: SubtitleCue[]): string {
  // Sort primarily by id to keep original song sequence intact
  const sorted = [...cues].sort((a, b) => a.id - b.id);

  let lastEnd = 0;
  const processedCues = sorted
    .map((c) => {
      const clean = stripSquareBrackets(c.text);
      let start = Math.max(0, c.startTime);
      // Ensure start doesn't jump backwards behind previous cue's start
      if (start < lastEnd - 0.2) {
        start = lastEnd;
      }
      const naturalDuration = Math.max(1.8, Math.min(7.0, 1.2 + clean.length * 0.12));
      let end = c.endTime > start ? c.endTime : start + naturalDuration;
      lastEnd = end + 0.1;

      return {
        ...c,
        cleanText: clean,
        startTime: Math.round(start * 1000) / 1000,
        endTime: Math.round(end * 1000) / 1000,
      };
    })
    .filter((c) => c.cleanText.length > 0);

  return processedCues
    .map((cue, index) => {
      const cueNumber = index + 1;
      const start = formatSecondsToSrt(cue.startTime);
      const end = formatSecondsToSrt(cue.endTime);
      return `${cueNumber}\n${start} --> ${end}\n${cue.cleanText}`;
    })
    .join('\n\n');
}

/**
 * Generates WebVTT (.vtt) subtitle text content.
 * Strictly ignores bracketed markers [verse 1], [chorus], etc.
 * Guarantees monotonic timestamp progression and preserves all cues in order.
 */
export function generateVtt(cues: SubtitleCue[], title?: string): string {
  const sorted = [...cues].sort((a, b) => a.id - b.id);

  let lastEnd = 0;
  const processedCues = sorted
    .map((c) => {
      const clean = stripSquareBrackets(c.text);
      let start = Math.max(0, c.startTime);
      if (start < lastEnd - 0.2) {
        start = lastEnd;
      }
      const naturalDuration = Math.max(1.8, Math.min(7.0, 1.2 + clean.length * 0.12));
      let end = c.endTime > start ? c.endTime : start + naturalDuration;
      lastEnd = end + 0.1;

      return {
        ...c,
        cleanText: clean,
        startTime: Math.round(start * 1000) / 1000,
        endTime: Math.round(end * 1000) / 1000,
      };
    })
    .filter((c) => c.cleanText.length > 0);

  let header = 'WEBVTT';
  if (title) {
    const cleanTitle = stripSquareBrackets(title);
    header += ` - ${cleanTitle}`;
  }
  header += '\n\n';

  const body = processedCues
    .map((cue, index) => {
      const cueNumber = index + 1;
      const start = formatSecondsToVtt(cue.startTime);
      const end = formatSecondsToVtt(cue.endTime);
      return `${cueNumber}\n${start} --> ${end}\n${cue.cleanText}`;
    })
    .join('\n\n');

  return header + body;
}

/**
 * Triggers a native browser file download for the generated subtitle
 */
export function downloadSubtitleFile(
  baseName: string,
  content: string,
  format: 'srt' | 'vtt',
  language?: SupportedLanguage | null
): void {
  const mimeType = format === 'srt' ? 'application/x-subrip' : 'text/vtt';
  const filename = getSubtitleFilename(baseName, format, language);

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
