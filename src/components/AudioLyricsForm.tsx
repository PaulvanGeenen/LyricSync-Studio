import React, { useRef, useState, useEffect } from 'react';
import {
  Upload,
  Music,
  FileText,
  Languages,
  Check,
  Sparkles,
  X,
  Volume2,
  RefreshCw,
  ArrowRight,
  BookOpen,
  Loader2,
  Wand2,
  Copy,
  CheckCircle2,
  HelpCircle,
  Video,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { SupportedLanguage, TranslatedLinePair, TranslationStyle, RephraseOption } from '../types/subtitle';
import { formatTimeDisplay } from '../utils/timeFormat';

interface AudioLyricsFormProps {
  audioFile: File | null;
  audioName: string;
  audioDuration: number;
  lyrics: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage | null;
  translationStyle: TranslationStyle;
  isSyncing: boolean;
  isTranslatingPreview: boolean;
  isImprovingTranslation: boolean;
  translatedPreviewPairs: TranslatedLinePair[] | null;
  onAudioSelected: (file: File) => void;
  onAudioRemoved: () => void;
  onLyricsChange: (text: string) => void;
  onSourceLanguageSelect: (lang: SupportedLanguage) => void;
  onTargetLanguageSelect: (lang: SupportedLanguage) => void;
  onTranslationStyleChange: (style: TranslationStyle) => void;
  onTranslatePreview: () => void;
  onImproveTranslation: (feedback?: string) => void;
  onApplyTranslatedLyrics: (translatedText: string) => void;
  onUpdateTranslatedPair?: (id: number, newTranslatedText: string) => void;
  onSubmitSync: () => void;
  onLoadDemoTrack: (lang: SupportedLanguage) => void;
  onOpenMp4Converter?: () => void;
  onOpenTimestampTransfer?: () => void;
  vocalStartTime?: number;
  onVocalStartTimeChange?: (seconds: number) => void;
  currentTime?: number;
}

export const AudioLyricsForm: React.FC<AudioLyricsFormProps> = ({
  audioFile,
  audioName,
  audioDuration,
  lyrics,
  sourceLanguage,
  targetLanguage,
  translationStyle,
  isSyncing,
  isTranslatingPreview,
  isImprovingTranslation,
  translatedPreviewPairs,
  onAudioSelected,
  onAudioRemoved,
  onLyricsChange,
  onSourceLanguageSelect,
  onTargetLanguageSelect,
  onTranslationStyleChange,
  onTranslatePreview,
  onImproveTranslation,
  onApplyTranslatedLyrics,
  onUpdateTranslatedPair,
  onSubmitSync,
  onLoadDemoTrack,
  onOpenMp4Converter,
  onOpenTimestampTransfer,
  vocalStartTime = 0,
  onVocalStartTimeChange,
  currentTime,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSideBySide, setShowSideBySide] = useState(false);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const [activeTab, setActiveTab] = useState<'original' | 'translated'>('original');
  const [rephrasingLineId, setRephrasingLineId] = useState<number | null>(null);
  const [rephraseOptions, setRephraseOptions] = useState<{ [id: number]: RephraseOption[] }>({});
  const [loadingRephraseId, setLoadingRephraseId] = useState<number | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  // Automatically reveal translation side-by-side view when translatedPreviewPairs arrives
  useEffect(() => {
    if (translatedPreviewPairs && translatedPreviewPairs.length > 0) {
      setShowSideBySide(true);
      setActiveTab('translated');
    }
  }, [translatedPreviewPairs]);

  // Request alternative translations for a single line
  const handleRequestRephrase = async (pair: TranslatedLinePair) => {
    if (loadingRephraseId !== null) return;
    if (rephrasingLineId === pair.id) {
      setRephrasingLineId(null);
      return;
    }
    setLoadingRephraseId(pair.id);
    try {
      const res = await fetch('/api/rephrase-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalLine: pair.original,
          currentTranslation: pair.translated,
          sourceLanguage,
          targetLanguage: targetLanguage || (sourceLanguage === 'nl' ? 'en' : 'nl'),
          songContext: lyrics,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.options && Array.isArray(data.options)) {
          setRephraseOptions((prev) => ({ ...prev, [pair.id]: data.options }));
          setRephrasingLineId(pair.id);
        }
      }
    } catch (e) {
      console.error('Rephrase line failed:', e);
    } finally {
      setLoadingRephraseId(null);
    }
  };

  const handleSelectRephraseOption = (pairId: number, text: string) => {
    onUpdateTranslatedPair?.(pairId, text);
    setRephrasingLineId(null);
  };

  // Requirement checks
  const hasAudio = Boolean(audioName && audioDuration > 0);
  const hasLyrics = Boolean(lyrics.trim().length > 0);
  const hasLanguage = Boolean(targetLanguage);
  const canSubmit = hasAudio && hasLyrics && hasLanguage && !isSyncing;

  const isDifferentLanguage = Boolean(
    targetLanguage && sourceLanguage !== targetLanguage
  );

  // Only count lines that actually contain vocal lyrics after stripping bracket tags like [Verse 1]
  const validLyricsLines = lyrics
    .split('\n')
    .map((l) => l.replace(/\[.*?\]/g, '').trim())
    .filter((l) => l.length > 0);
  const lineCount = validLyricsLines.length;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
        onAudioSelected(file);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onAudioSelected(e.target.files[0]);
    }
  };

  // Automatically strips all bracketed tags [verse 1], [chorus 1], [intro], etc.
  const autoCleanLyrics = (text: string): string => {
    return text
      .split('\n')
      .map((l) => l.replace(/\[.*?\]/g, '').trim())
      .filter((l) => l.length > 0)
      .join('\n');
  };

  const handleLyricsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          // Clean all timestamp tags and all bracketed section tags automatically
          const cleanedText = autoCleanLyrics(content);
          onLyricsChange(cleanedText);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleLyricsPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (/\[.*?\]/.test(pasted)) {
      e.preventDefault();
      const cleanedPasted = autoCleanLyrics(pasted);
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const current = target.value;
      const updated = current.substring(0, start) + cleanedPasted + current.substring(end);
      onLyricsChange(autoCleanLyrics(updated));
    }
  };

  const handleLyricsChange = (val: string) => {
    if (/\[.*?\]/.test(val)) {
      onLyricsChange(autoCleanLyrics(val));
    } else {
      onLyricsChange(val);
    }
  };

  const handleLyricsBlur = () => {
    if (/\[.*?\]/.test(lyrics)) {
      onLyricsChange(autoCleanLyrics(lyrics));
    }
  };

  const handleCopyTranslatedText = () => {
    if (!translatedPreviewPairs) return;
    const fullText = translatedPreviewPairs.map((p) => p.translated).join('\n');
    navigator.clipboard.writeText(fullText);
    setCopiedTranslation(true);
    setTimeout(() => setCopiedTranslation(false), 2000);
  };

  const translatedFullString = translatedPreviewPairs
    ? translatedPreviewPairs.map((p) => p.translated).join('\n')
    : '';

  // Detect if preview pairs are still untranslated (original matches translated)
  const isUntranslated = Boolean(
    isDifferentLanguage &&
    translatedPreviewPairs &&
    translatedPreviewPairs.length > 0 &&
    translatedPreviewPairs.filter((p) => p.original.trim().toLowerCase() === p.translated.trim().toLowerCase()).length >= Math.ceil(translatedPreviewPairs.length * 0.5)
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8 space-y-8">
      {/* Header with Quick Presets */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-xl font-semibold text-white tracking-tight">
            1. Setup Audio & Songtekst
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Upload je muziek, voer de songtekst in en selecteer zowel de brontaal als de doeltaal voor de ondertiteling.
          </p>
        </div>

        {/* Demo Fast Track Loaders */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-slate-400">Voorbeeldnummers:</span>
          <button
            type="button"
            onClick={() => onLoadDemoTrack('nl')}
            className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            Nederlands Lied
          </button>
          <button
            type="button"
            onClick={() => onLoadDemoTrack('en')}
            className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            Engels Lied
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Music Upload & Language Dual-Selector */}
        <div className="space-y-6">
          {/* Audio Upload Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                <Music className="w-4 h-4 text-indigo-400" />
                Muziekbestand
                <span className="text-red-400 text-xs">*</span>
              </label>
              {hasAudio && (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Geladen ({formatTimeDisplay(audioDuration, false)})
                </span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac"
              className="hidden"
              onChange={handleFileChange}
            />

            {!hasAudio ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-7 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-700 hover:border-slate-600 bg-slate-950/60'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 mx-auto flex items-center justify-center text-indigo-400 mb-3 shadow-inner">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-slate-200">
                  Klik om te bladeren of sleep een audiobestand hierheen
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Ondersteunt MP3, WAV, OGG, M4A, FLAC, AAC
                </p>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-800/40">
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{audioName}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                      <span>Duur: {formatTimeDisplay(audioDuration, false)}</span>
                      <span>·</span>
                      <span>{audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MB` : 'Gesynthetiseerd'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
                    title="Vervang audiobestand"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onAudioRemoved}
                    className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-md transition-colors"
                    title="Verwijder audiobestand"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {onOpenMp4Converter && (
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-slate-400">
                  {hasAudio ? 'Muziekbestand klaar voor MP4 video' : 'Direct MP3 naar MP4 video omzetten?'}
                </span>
                <button
                  type="button"
                  onClick={onOpenMp4Converter}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-950/60 hover:bg-purple-900/80 text-purple-200 border border-purple-500/40 rounded-lg font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Zet een MP3 audiobestand en JPG cover samen om naar een downloadbare MP4 video"
                >
                  <Video className="w-3.5 h-3.5 text-purple-400" />
                  <span>MP3 + JPG naar MP4</span>
                </button>
              </div>
            )}

            {onOpenTimestampTransfer && (
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-slate-400">
                  Al een Engelse .srt? Kopieer tijden direct naar Nederlandse zinnen:
                </span>
                <button
                  type="button"
                  onClick={onOpenTimestampTransfer}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-500/40 rounded-lg font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Kopieer de tijden van een Engelse .srt naar Nederlandse regels met automatische controle op gelijk aantal zinnen"
                >
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Tijden Kopiëren (.SRT)</span>
                </button>
              </div>
            )}

            {/* Startpunt Zang (Muzikaal intro / Lead-in) */}
            {onVocalStartTimeChange && (
              <div className="bg-slate-950/90 border border-amber-500/30 rounded-xl p-3.5 space-y-2.5 mt-2 shadow-inner">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Startpunt Zang (Muzikaal Intro / Lead-in)</span>
                  </label>
                  <span className="text-[11px] font-mono tabular-nums text-amber-300 bg-amber-950/70 px-2 py-0.5 rounded border border-amber-600/40 font-semibold">
                    {vocalStartTime > 0 ? `${formatTimeDisplay(vocalStartTime)} (${vocalStartTime}s)` : '00:00.00 (direct bij start)'}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Begint de zang niet direct op seconde 0, maar heeft het nummer bijv. een muzikaal intro van <strong>23 seconden</strong>? Vul hier <span className="text-amber-300 font-mono font-bold">23</span> in. Regel #1 start dan exact op 23s en alle vervolgregels schuiven automatisch op.
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={audioDuration > 0 ? audioDuration : 600}
                      value={vocalStartTime === 0 ? '' : vocalStartTime}
                      placeholder="0"
                      onChange={(e) => {
                        const val = Math.max(0, parseFloat(e.target.value) || 0);
                        onVocalStartTimeChange(val);
                      }}
                      className="w-24 pl-3 pr-8 py-1.5 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-lg text-xs font-mono text-amber-300 placeholder:text-slate-600 focus:outline-none"
                    />
                    <span className="absolute right-2 text-slate-500 text-[11px] pointer-events-none">sec</span>
                  </div>

                  {currentTime !== undefined && currentTime > 0 && (
                    <button
                      type="button"
                      onClick={() => onVocalStartTimeChange(Math.round(currentTime * 10) / 10)}
                      className="px-2.5 py-1.5 bg-amber-950/60 hover:bg-amber-900 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                      title="Gebruik de huidige afspeelpositie van de audiospeler als startpunt"
                    >
                      <span>Neem audiotijd ({formatTimeDisplay(currentTime)}) over</span>
                    </button>
                  )}

                  {/* Quick Presets */}
                  <div className="flex items-center gap-1">
                    {[0, 10, 15, 20, 23, 30].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onVocalStartTimeChange(preset)}
                        className={`px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                          vocalStartTime === preset
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                        title={`Stel startpunt zang in op ${preset} seconden`}
                      >
                        {preset}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dual Language Configuration (Source Lyrics Language -> Target Subtitle Language) */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                <Languages className="w-4 h-4 text-indigo-400" />
                Taalconfiguratie & Vertaling
                <span className="text-red-400 text-xs">*</span>
              </label>
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Gemini AI Verbonden</span>
              </div>
            </div>

            {/* Source & Target Side-by-Side Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
              {/* Step A: Source Lyrics Language */}
              <div className="space-y-2">
                <span className="text-xs text-slate-400 block font-medium">
                  1. Taal van de Songtekst
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onSourceLanguageSelect('nl')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                      sourceLanguage === 'nl'
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    Nederlands (NL)
                  </button>
                  <button
                    type="button"
                    onClick={() => onSourceLanguageSelect('en')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                      sourceLanguage === 'en'
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    Engels (EN)
                  </button>
                </div>
              </div>

              {/* Step B: Target Subtitles Language */}
              <div className="space-y-2">
                <span className="text-xs text-slate-400 block font-medium">
                  2. Doeltaal Ondertiteling (SRT)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onTargetLanguageSelect('nl')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                      targetLanguage === 'nl'
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    Nederlands (_NL)
                  </button>
                  <button
                    type="button"
                    onClick={() => onTargetLanguageSelect('en')}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-center transition-all ${
                      targetLanguage === 'en'
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    Engels (_EN)
                  </button>
                </div>
              </div>
            </div>

            {/* Translation Action & Information Card */}
            {isDifferentLanguage ? (
              <div className="p-4 bg-gradient-to-r from-amber-950/40 via-indigo-950/30 to-amber-950/40 border border-amber-500/30 rounded-xl space-y-3.5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>
                      Vertaalstudio: {sourceLanguage === 'nl' ? 'Nederlands' : 'Engels'} →{' '}
                      {targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}
                    </span>
                  </div>
                  {translatedPreviewPairs && (
                    <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-medium border border-emerald-500/20">
                      ✓ Vertaald ({translatedPreviewPairs.length} zinnen)
                    </span>
                  )}
                </div>

                {/* Vertaalstijl Kiezers */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                    <span>Kies gewenste vertaalstijl:</span>
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onTranslationStyleChange('natural')}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold text-center transition-all ${
                        translationStyle === 'natural'
                          ? 'bg-amber-500 text-slate-950 shadow-sm ring-1 ring-amber-400'
                          : 'bg-slate-900/90 text-slate-300 hover:text-white border border-slate-800'
                      }`}
                      title="Natuurlijk & betekenisgetrouw: accurate betekenis, voorkomt vertaalfouten en houterig Nederlands/Engels"
                    >
                      🌟 Natuurlijk
                    </button>
                    <button
                      type="button"
                      onClick={() => onTranslationStyleChange('singable')}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold text-center transition-all ${
                        translationStyle === 'singable'
                          ? 'bg-amber-500 text-slate-950 shadow-sm ring-1 ring-amber-400'
                          : 'bg-slate-900/90 text-slate-300 hover:text-white border border-slate-800'
                      }`}
                      title="Zingbaar & Ritmisch: afgestemd op muzikale cadans, metrum en zangmelodie"
                    >
                      🎵 Zingbaar
                    </button>
                    <button
                      type="button"
                      onClick={() => onTranslationStyleChange('poetic')}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold text-center transition-all ${
                        translationStyle === 'poetic'
                          ? 'bg-amber-500 text-slate-950 shadow-sm ring-1 ring-amber-400'
                          : 'bg-slate-900/90 text-slate-300 hover:text-white border border-slate-800'
                      }`}
                      title="Poëtisch & Literair: literaire beeldspraak en artistieke vocabulaire"
                    >
                      ✍️ Poëtisch
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {translationStyle === 'natural' && '💡 Focus op 100% accurate betekenis en vlot, natuurlijk idioom zonder vertaalfouten.'}
                    {translationStyle === 'singable' && '💡 Focus op natuurlijk zangmetrum en passend lettergreepritme.'}
                    {translationStyle === 'poetic' && '💡 Focus op artistieke diepgang en dichterlijke beeldspraak.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('translated');
                      setShowSideBySide(true);
                      onTranslatePreview();
                    }}
                    disabled={!hasLyrics || isTranslatingPreview}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:scale-98 text-slate-950 font-semibold rounded-lg text-xs transition-all flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTranslatingPreview ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                        <span>Bezig met vertalen...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 text-slate-950" />
                        <span>
                          {translatedPreviewPairs
                            ? `Opnieuw vertalen naar het ${targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}`
                            : `Vertaal nu naar het ${targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}`}
                        </span>
                      </>
                    )}
                  </button>

                  {translatedPreviewPairs && (
                    <button
                      type="button"
                      onClick={() => setShowSideBySide(!showSideBySide)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors border border-slate-700 flex items-center gap-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{showSideBySide ? 'Verberg vergelijking' : 'Bekijk tweetalige zinnen'}</span>
                    </button>
                  )}
                </div>

                {/* Inline translation status / preview right below the button */}
                {isTranslatingPreview && (
                  <div className="p-3 rounded-lg bg-slate-950/90 border border-amber-500/40 flex items-center gap-2.5 text-xs text-amber-200">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                    <span>
                      Je {lineCount} liedregels worden nu regel-voor-regel vertaald naar het{' '}
                      <strong>{targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}</strong>...
                    </span>
                  </div>
                )}

                {!isTranslatingPreview && translatedPreviewPairs && translatedPreviewPairs.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-950/90 border border-emerald-500/30 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          Vertaling gereed ({translatedPreviewPairs.length} regels in het{' '}
                          {targetLanguage === 'nl' ? 'Nederlands' : 'Engels'})
                        </span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCopyTranslatedText}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 border border-slate-700 cursor-pointer"
                        >
                          {copiedTranslation ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Gekopieerd!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-slate-400" />
                              <span>Kopieer NL tekst</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onApplyTranslatedLyrics(translatedFullString);
                            setActiveTab('original');
                          }}
                          className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[11px] font-semibold cursor-pointer"
                          title="Zet deze vertaalde tekst direct in het grote songtekstvak rechts"
                        >
                          Zet in tekstvak rechts
                        </button>
                      </div>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-xs font-sans border-t border-slate-800/80 pt-2">
                      {translatedPreviewPairs.map((p) => (
                        <div key={p.id} className="flex items-baseline gap-2 text-slate-200">
                          <span className="text-[10px] font-mono text-slate-500 w-5 shrink-0">#{p.id}</span>
                          <span className="text-amber-100">{p.translated}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-400">
                  Brontaal en doeltaal zijn hetzelfde ({sourceLanguage === 'nl' ? 'Nederlands' : 'Engels'}). Geen vertaling nodig.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextTarget: SupportedLanguage = sourceLanguage === 'nl' ? 'en' : 'nl';
                    onTargetLanguageSelect(nextTarget);
                  }}
                  className="px-2.5 py-1 text-indigo-400 hover:text-indigo-300 font-medium underline whitespace-nowrap text-xs"
                >
                  Vertaal naar {sourceLanguage === 'nl' ? 'Engels (_EN)' : 'Nederlands (_NL)'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Lyrics Text Area & Translation Tabs */}
        <div className="space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            {/* Tabs between original lyrics and translated view */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('original')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  activeTab === 'original'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Originele tekst ({sourceLanguage === 'nl' ? 'NL' : 'EN'})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('translated')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'translated'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Vertaling ({targetLanguage === 'nl' ? 'NL' : 'EN'})</span>
                {translatedPreviewPairs && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <input
                ref={textFileInputRef}
                type="file"
                accept=".txt,.lrc"
                className="hidden"
                onChange={handleLyricsFileUpload}
              />
              <button
                type="button"
                onClick={() => textFileInputRef.current?.click()}
                className="text-slate-400 hover:text-slate-200 transition-colors underline"
              >
                Upload .txt/.lrc
              </button>
              {hasLyrics && (
                <button
                  type="button"
                  onClick={() => onLyricsChange('')}
                  className="text-red-400 hover:text-red-300 transition-colors"
                >
                  Wissen
                </button>
              )}
            </div>
          </div>

          {activeTab === 'original' ? (
            <div className="relative flex-1">
              <textarea
                rows={9}
                value={lyrics}
                onChange={(e) => handleLyricsChange(e.target.value)}
                onPaste={handleLyricsPaste}
                onBlur={handleLyricsBlur}
                placeholder="Plak of typ elke liedregel op een nieuwe regel...&#10;&#10;Voorbeeld:&#10;De avond valt zacht over de stad&#10;De mooiste herinnering die ik had&#10;We lopen samen langs de gracht"
                className="w-full h-full min-h-[220px] bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans leading-relaxed resize-y"
              />
            </div>
          ) : (
            <div className="relative flex-1 min-h-[240px] bg-slate-950 border border-amber-900/40 rounded-xl p-4 flex flex-col justify-between">
              {translatedPreviewPairs ? (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-slate-800 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Vertaling</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                          Gemini Flash
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* AI Proofread & Improve Button */}
                      <button
                        type="button"
                        onClick={() => onImproveTranslation(feedbackNote || undefined)}
                        disabled={isImprovingTranslation || isTranslatingPreview}
                        className="px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded text-xs transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                        title="Laat Gemini alle regels controleren op taalfouten, onnatuurlijk Nederlands en houterige formuleringen"
                      >
                        {isImprovingTranslation ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Verbeteren...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3 h-3" />
                            <span>AI Foutencheck & Verbeteren</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowFeedbackInput(!showFeedbackInput)}
                        className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded transition-colors text-xs"
                        title="Voeg specifieke instructie toe voor de verbetering"
                      >
                        ✏️
                      </button>

                      <button
                        type="button"
                        onClick={onTranslatePreview}
                        disabled={isTranslatingPreview || isImprovingTranslation}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition-colors flex items-center gap-1 border border-slate-700"
                        title="Vertaal opnieuw met Gemini"
                      >
                        <RefreshCw className={`w-3 h-3 ${isTranslatingPreview ? 'animate-spin text-amber-400' : 'text-slate-400'}`} />
                        <span>Opnieuw</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyTranslatedText}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition-colors flex items-center gap-1 border border-slate-700"
                      >
                        {copiedTranslation ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Gekopieerd</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Kopieer</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onApplyTranslatedLyrics(translatedFullString)}
                        className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-xs transition-colors font-medium border border-amber-500/30"
                        title="Neem deze vertaalde regels over als de actieve liedinvoer"
                      >
                        Gebruik als liedtekst
                      </button>
                    </div>
                  </div>

                  {/* Optional user improvement feedback drawer */}
                  {showFeedbackInput && (
                    <div className="p-2.5 bg-slate-900 border border-amber-500/30 rounded-lg flex items-center gap-2">
                      <input
                        type="text"
                        value={feedbackNote}
                        onChange={(e) => setFeedbackNote(e.target.value)}
                        placeholder="Bijv: 'Maak het minder formeel', 'voorkom leenwoorden', 'meer kleinkunst-stijl'..."
                        className="flex-1 bg-slate-950 border border-slate-800 text-xs text-white rounded px-2.5 py-1 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onImproveTranslation(feedbackNote || undefined);
                          setShowFeedbackInput(false);
                        }}
                        disabled={isImprovingTranslation}
                        className="px-2.5 py-1 bg-amber-500 text-slate-950 font-semibold rounded text-xs whitespace-nowrap hover:bg-amber-400"
                      >
                        Toepassen
                      </button>
                    </div>
                  )}

                  {isUntranslated ? (
                    <div className="p-3 bg-amber-500/20 border border-amber-500/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs animate-in fade-in">
                      <div className="flex items-center gap-2 text-amber-200">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          De regels hieronder zijn nog niet in het <strong>{targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}</strong>. Klik op de knop om de AI-vertaling direct op te halen.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={onTranslatePreview}
                        disabled={isTranslatingPreview}
                        className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shrink-0 shadow transition-all active:scale-95 cursor-pointer"
                      >
                        {isTranslatingPreview ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Bezig met vertalen...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>⚡ Nu vertalen naar {targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-amber-950/30 border border-amber-900/40 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-200/90 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        ✍️ <strong>Direct bewerkbaar:</strong> Pas elke regel direct aan, of klik op <span className="text-amber-400 font-bold">✨ Alternatief</span> voor 3 directe suggesties.
                      </span>
                    </div>
                  )}

                  {/* Line by line translated list with individual rephrase alternatives */}
                  <div className="max-h-[220px] overflow-y-auto space-y-2 text-xs font-sans pr-1">
                    {translatedPreviewPairs.map((p) => {
                      const isRephraseOpen = rephrasingLineId === p.id;
                      const options = rephraseOptions[p.id] || [];
                      const isLoadingThis = loadingRephraseId === p.id;

                      return (
                        <div key={p.id} className="space-y-1.5">
                          <div className="py-1 px-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2 group hover:border-amber-500/40 transition-colors">
                            <span className="text-[10px] text-slate-500 font-mono shrink-0 w-6">#{p.id}</span>
                            <input
                              type="text"
                              value={p.translated}
                              onChange={(e) => onUpdateTranslatedPair?.(p.id, e.target.value)}
                              className="flex-1 bg-transparent border-0 text-amber-100 font-medium text-xs focus:outline-none focus:bg-slate-950/80 focus:ring-1 focus:ring-amber-500/50 rounded px-1.5 py-0.5"
                              placeholder="Vertaalde regel..."
                            />
                            <button
                              type="button"
                              onClick={() => handleRequestRephrase(p)}
                              disabled={isLoadingThis}
                              className={`p-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 shrink-0 ${
                                isRephraseOpen
                                  ? 'bg-amber-500/30 text-amber-300'
                                  : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                              }`}
                              title="Bedenk 3 alternatieve vertalingen voor deze regel"
                            >
                              {isLoadingThis ? (
                                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                              ) : (
                                <Sparkles className="w-3 h-3 text-amber-400" />
                              )}
                              <span className="hidden sm:inline">Alternatief</span>
                            </button>
                          </div>

                          {/* Rephrase options chips */}
                          {isRephraseOpen && options.length > 0 && (
                            <div className="ml-8 p-2 bg-slate-900/90 border border-amber-500/30 rounded-lg space-y-1.5 animate-in fade-in">
                              <span className="text-[10px] text-amber-300/80 font-medium block">
                                Kies een alternatief om direct te vervangen:
                              </span>
                              <div className="grid grid-cols-1 gap-1">
                                {options.map((opt, oIdx) => (
                                  <button
                                    key={oIdx}
                                    type="button"
                                    onClick={() => handleSelectRephraseOption(p.id, opt.text)}
                                    className="text-left px-2 py-1 rounded bg-slate-950 hover:bg-amber-500/20 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/40 text-[11px] transition-colors flex items-baseline justify-between gap-2"
                                  >
                                    <span className="font-medium">{opt.text}</span>
                                    <span className="text-[9px] uppercase tracking-wider text-slate-500 shrink-0 font-mono">
                                      {opt.style === 'natural' ? 'Natuurlijk' : opt.style === 'singable' ? 'Zingbaar' : 'Poëtisch'}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                  <BookOpen className="w-8 h-8 text-amber-400/60" />
                  <div>
                    <p className="text-xs text-slate-300 font-medium">
                      Nog geen vertaling gegenereerd
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Klik hieronder om de songtekst literair te vertalen van{' '}
                      {sourceLanguage === 'nl' ? 'Nederlands naar Engels' : 'Engels naar Nederlands'}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onTranslatePreview}
                    disabled={!hasLyrics || isTranslatingPreview}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isTranslatingPreview ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Vertalen met Gemini...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Start Vertaling</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 gap-1">
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              Sectietags zoals <code className="text-indigo-400 font-mono">[verse]</code> of <code className="text-indigo-400 font-mono">[chorus]</code> worden direct automatisch gefilterd
            </span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {lineCount} {lineCount === 1 ? 'liedregel' : 'liedregels'}
            </span>
          </div>

          {/* Interactive Side-By-Side Comparison Drawer */}
          {showSideBySide && translatedPreviewPairs && (
            <div className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 max-h-72 overflow-y-auto shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Regel-voor-regel vergelijking &amp; Bewerking ({sourceLanguage.toUpperCase()} ↔ {targetLanguage?.toUpperCase()})
                </span>
                <button
                  type="button"
                  onClick={() => setShowSideBySide(false)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Sluiten
                </button>
              </div>

              <div className="space-y-2 text-xs">
                {translatedPreviewPairs.map((pair) => (
                  <div key={pair.id} className="grid grid-cols-2 gap-3 py-1.5 px-2 rounded bg-slate-900/60 border border-slate-800/60 items-center">
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">Origineel #{pair.id} ({sourceLanguage.toUpperCase()}):</span>
                      <span className="text-slate-300 italic">{pair.original}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-amber-400 font-mono block">Vertaling ({targetLanguage?.toUpperCase()}):</span>
                      <input
                        type="text"
                        value={pair.translated}
                        onChange={(e) => onUpdateTranslatedPair?.(pair.id, e.target.value)}
                        className="w-full bg-slate-950/80 border border-amber-900/40 focus:border-amber-400 rounded px-2 py-1 text-xs text-amber-200 font-medium focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Submission Status Checklist & Submit Button */}
      <div className="border-t border-slate-800 pt-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
        {/* Requirement Checklist */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                hasAudio ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {hasAudio ? '✓' : '1'}
            </span>
            <span className={hasAudio ? 'text-slate-300 font-medium' : 'text-slate-500'}>
              Audiobestand
            </span>
          </div>

          <span className="text-slate-700">·</span>

          <div className="flex items-center gap-1.5">
            <span
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                hasLyrics ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {hasLyrics ? '✓' : '2'}
            </span>
            <span className={hasLyrics ? 'text-slate-300 font-medium' : 'text-slate-500'}>
              Songtekst ({lineCount} {lineCount === 1 ? 'regel' : 'regels'})
            </span>
          </div>

          <span className="text-slate-700">·</span>

          <div className="flex items-center gap-1.5">
            <span
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                hasLanguage ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {hasLanguage ? '✓' : '3'}
            </span>
            <span className={hasLanguage ? 'text-slate-300 font-medium' : 'text-slate-500'}>
              Ondertiteltaal ({targetLanguage ? (targetLanguage === 'nl' ? 'Nederlands (_NL)' : 'Engels (_EN)') : 'Nog kiezen'})
              {isDifferentLanguage && ' + Poëtische Vertaling'}
            </span>
          </div>
        </div>

        {/* Submit Action */}
        <button
          type="button"
          onClick={onSubmitSync}
          disabled={!canSubmit}
          className={`px-6 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2.5 transition-all shadow-md ${
            canSubmit
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 cursor-pointer active:scale-98'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${canSubmit ? 'text-indigo-200' : 'text-slate-600'}`} />
          <span>
            {isDifferentLanguage
              ? 'Vertaal zorgvuldig & Synchroniseer'
              : 'Synchroniseer Songtekst naar Audio'}
          </span>
        </button>
      </div>
    </div>
  );
};
