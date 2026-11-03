export interface SubtitleCue {
  id: number;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;      // subtitle text in target language
  originalText?: string; // original lyric line before translation
}

export type SupportedLanguage = 'en' | 'nl';

export type TranslationStyle = 'natural' | 'singable' | 'poetic';

export interface TranslatedLinePair {
  id: number;
  original: string;
  translated: string;
}

export interface RephraseOption {
  style: TranslationStyle;
  label: string;
  text: string;
}

export interface SyncProgressState {
  isSyncing: boolean;
  step: number; // 1 to 5
  stepLabel: string;
  progressPercent: number;
  source?: string;
  isTranslating?: boolean;
}

export interface DemoTrack {
  id: string;
  title: string;
  artist: string;
  language: SupportedLanguage;
  lyrics: string;
  genre: string;
  tempo: number;
}
