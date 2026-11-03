/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { AudioLyricsForm } from './components/AudioLyricsForm';
import { SubtitleEditStudio } from './components/SubtitleEditStudio';
import { PreviewPlayer } from './components/PreviewPlayer';
import { CueEditor } from './components/CueEditor';
import { SyncProgressModal } from './components/SyncProgressModal';
import { ExportModal } from './components/ExportModal';
import { Mp3ToMp4Modal } from './components/Mp3ToMp4Modal';
import { TimestampTransferModal } from './components/TimestampTransferModal';
import {
  SubtitleCue,
  SupportedLanguage,
  SyncProgressState,
  TranslatedLinePair,
  TranslationStyle,
} from './types/subtitle';
import {
  extractWaveformPeaks,
  detectVocalStartLocally,
  alignLyricsToAudioAcoustically,
  alignCuesWithAcousticWaveform,
} from './utils/audioWaveform';
import { runLocalWhisperAlignment } from './utils/whisperAligner';
import { DEMO_TRACKS, synthesizeDemoTrack } from './utils/audioSynthesizer';
import { formatTimeDisplay } from './utils/timeFormat';
import { CheckCircle2, AlertCircle, Info, FileSpreadsheet, RotateCcw, Video, Clock } from 'lucide-react';

export default function App() {
  // Main Audio & Lyrics State
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>('');
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [lyrics, setLyrics] = useState<string>('');
  
  // Dual Language State: Source lyrics language and Target subtitle language
  const [sourceLanguage, setSourceLanguage] = useState<SupportedLanguage>('nl');
  const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage | null>('nl');
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>('natural');
  const [vocalStartTime, setVocalStartTime] = useState<number>(0);

  // Translation Preview State
  const [isTranslatingPreview, setIsTranslatingPreview] = useState<boolean>(false);
  const [isImprovingTranslation, setIsImprovingTranslation] = useState<boolean>(false);
  const [translatedPreviewPairs, setTranslatedPreviewPairs] = useState<TranslatedLinePair[] | null>(null);

  // Subtitle Cues & Playback State
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [selectedCueId, setSelectedCueId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // Syncing & UI State
  const [progressState, setProgressState] = useState<SyncProgressState>({
    isSyncing: false,
    step: 1,
    stepLabel: 'Initializing',
    progressPercent: 0,
  });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isMp4ModalOpen, setIsMp4ModalOpen] = useState(false);
  const [isTimestampTransferOpen, setIsTimestampTransferOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'studio' | 'subtitle-edit' | 'editor'>('studio');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const subtitleEditSectionRef = useRef<HTMLDivElement>(null);
  const previewSectionRef = useRef<HTMLDivElement>(null);
  const editorSectionRef = useRef<HTMLDivElement>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Keyboard shortcut: Spacebar to toggle Play/Pause when not focused in an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.code === 'Space' && audioUrl) {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioUrl]);

  // Handle User Upload of Audio File
  const handleAudioSelected = async (file: File) => {
    try {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      const url = URL.createObjectURL(file);
      setAudioFile(file);
      setAudioBlob(file);
      setAudioUrl(url);
      setAudioName(file.name);

      // Measure duration & perform local acoustic analysis
      const tempAudio = new Audio(url);
      tempAudio.addEventListener('loadedmetadata', async () => {
        const dur = tempAudio.duration || 30;
        setAudioDuration(dur);

        // Extract waveform peaks
        const peaks = await extractWaveformPeaks(file);
        setWaveformPeaks(peaks);

        // Local acoustic intro detection (works 100% offline without API key)
        const localIntroSec = await detectVocalStartLocally(file);
        if (localIntroSec >= 1.5) {
          setVocalStartTime(localIntroSec);
          showToast(
            `✨ Muzikaal intro van ${localIntroSec}s akoestisch herkend (zang start op ${localIntroSec}s)!`,
            'success'
          );
        }
      });

      // Convert to base64 for API sync & auto-probe vocal start
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result as string;
        if (result && result.includes(',')) {
          const b64 = result.split(',')[1];
          setAudioBase64(b64);

          // Auto-probe vocal intro lead-in so the user doesn't have to guess or manually enter 21 seconds
          try {
            const probeRes = await fetch('/api/detect-vocal-start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64: b64, mimeType: file.type || 'audio/mp3' }),
            });
            if (probeRes.ok) {
              const probeData = await probeRes.json();
              if (probeData.vocalStartSeconds >= 2.0) {
                setVocalStartTime(probeData.vocalStartSeconds);
                showToast(
                  `✨ Muzikaal intro van ${probeData.vocalStartSeconds}s automatisch herkend (zang start op ${probeData.vocalStartSeconds}s)!`,
                  'success'
                );
              }
            }
          } catch (_) {
            // Non-fatal probe failure
          }
        }
      };
      reader.readAsDataURL(file);

      showToast(`Audiobestand geladen: ${file.name}`, 'success');
    } catch (err: any) {
      console.error('Failed to load audio file:', err);
      showToast('Kon audioformaat niet verwerken', 'error');
    }
  };

  const handleAudioRemoved = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioFile(null);
    setAudioBlob(null);
    setAudioBase64(null);
    setAudioUrl(null);
    setAudioName('');
    setAudioDuration(0);
    setWaveformPeaks([]);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Completely reset everything to start fresh with a new song
  const executeStartNewSong = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    document.querySelectorAll('audio').forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch (_) {}
    });

    setAudioFile(null);
    setAudioBlob(null);
    setAudioBase64(null);
    setAudioUrl(null);
    setAudioName('');
    setAudioDuration(0);
    setWaveformPeaks([]);
    setIsPlaying(false);
    setCurrentTime(0);

    setLyrics('');
    setVocalStartTime(0);
    setTranslatedPreviewPairs(null);
    setIsTranslatingPreview(false);

    setSourceLanguage('nl');
    setTargetLanguage('nl');

    setCues([]);
    setSelectedCueId(null);

    setIsExportModalOpen(false);
    setIsMp4ModalOpen(false);
    setIsTimestampTransferOpen(false);
    setIsResetConfirmOpen(false);
    setProgressState({
      isSyncing: false,
      step: 1,
      stepLabel: 'Initializing',
      progressPercent: 0,
    });

    setActiveSection('studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Klaar voor een nieuw lied! Alle invoer is gereset.', 'success');
  };

  const handleRequestStartNewSong = (skipConfirm: boolean = false) => {
    const hasContent = Boolean(audioUrl || lyrics.trim() || cues.length > 0);
    if (skipConfirm || !hasContent) {
      executeStartNewSong();
    } else {
      setIsResetConfirmOpen(true);
    }
  };

  // Handle Demo Track Loading
  const handleLoadDemoTrack = async (lang: SupportedLanguage) => {
    const track = DEMO_TRACKS.find((t) => t.language === lang) || DEMO_TRACKS[0];
    showToast(`Voorbeeldnummer (${track.genre}) genereren...`, 'info');

    try {
      const { blob, base64, duration } = await synthesizeDemoTrack(
        track.id as 'demo-en' | 'demo-nl'
      );
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioFile(null);
      setAudioUrl(url);
      setAudioBase64(base64);
      setAudioName(`${track.artist} - ${track.title} (${track.genre})`);
      setAudioDuration(duration);
      setLyrics(track.lyrics);
      setSourceLanguage(lang);
      setTargetLanguage(lang);
      setTranslatedPreviewPairs(null);

      // Extract waveform peaks
      const peaks = await extractWaveformPeaks(blob);
      setWaveformPeaks(peaks);

      showToast(`"${track.title}" geladen (${lang === 'nl' ? 'Nederlands' : 'Engels'})!`, 'success');
    } catch (err: any) {
      console.error('Failed to load demo track:', err);
      showToast('Fout bij het synthetiseren van het demobestand', 'error');
    }
  };

  const autoCleanLyrics = (text: string): string => {
    return text
      .split('\n')
      .map((l) => l.replace(/\[.*?\]/g, '').trim())
      .filter((l) => l.length > 0)
      .join('\n');
  };

  // Standalone Pre-Translation Handler
  const handleTranslatePreview = async () => {
    const cleanLyrics = autoCleanLyrics(lyrics);
    if (!cleanLyrics.trim()) {
      showToast('Voer eerst een songtekst in om te vertalen.', 'info');
      return;
    }

    let effectiveTarget = targetLanguage;
    if (!effectiveTarget || effectiveTarget === sourceLanguage) {
      // Auto-toggle to the other language so user is never stuck
      effectiveTarget = sourceLanguage === 'nl' ? 'en' : 'nl';
      setTargetLanguage(effectiveTarget);
    }

    setLyrics(cleanLyrics);
    setIsTranslatingPreview(true);
    const styleLabel =
      translationStyle === 'singable'
        ? 'zingbaar & ritmisch'
        : translationStyle === 'poetic'
        ? 'poëtisch & literair'
        : 'natuurlijk & betekenisgetrouw';
    showToast(
      `Songtekst zorgvuldig vertalen (${styleLabel}) naar het ${effectiveTarget === 'nl' ? 'Nederlands' : 'Engels'}...`,
      'info'
    );

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: cleanLyrics,
          sourceLanguage,
          targetLanguage: effectiveTarget,
          style: translationStyle,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Vertaling mislukt');
      }

      const data = await res.json();
      if (data.pairs && Array.isArray(data.pairs)) {
        setTranslatedPreviewPairs(data.pairs);
        showToast('Vertaling met Gemini voltooid!', 'success');
      }
    } catch (err: any) {
      console.error('Error during preview translation:', err);
      showToast(err.message || 'Vertaling mislukt', 'error');
    } finally {
      setIsTranslatingPreview(false);
    }
  };

  // AI Proofread & Improve Translation Handler
  const handleImproveTranslation = async (feedback?: string) => {
    if (!translatedPreviewPairs || translatedPreviewPairs.length === 0) {
      showToast('Er zijn nog geen vertaalde regels om te verbeteren.', 'info');
      return;
    }

    setIsImprovingTranslation(true);
    showToast('AI analyseert en verbetert de vertaling op grammatica, idioom en vloeiendheid...', 'info');

    try {
      const res = await fetch('/api/improve-translation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairs: translatedPreviewPairs,
          sourceLanguage,
          targetLanguage,
          feedback,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Verbeteren mislukt');
      }

      const data = await res.json();
      if (data.pairs && Array.isArray(data.pairs)) {
        setTranslatedPreviewPairs(data.pairs);
        showToast('Alle vertaalregels zijn gecontroleerd en geoptimaliseerd door Gemini!', 'success');
      }
    } catch (err: any) {
      console.error('Error improving translation:', err);
      showToast(err.message || 'Verbeteren mislukt', 'error');
    } finally {
      setIsImprovingTranslation(false);
    }
  };

  const handleApplyTranslatedLyrics = (translatedText: string) => {
    const cleanTranslated = autoCleanLyrics(translatedText);
    setLyrics(cleanTranslated);
    showToast('Songtekst bijgewerkt met de vertaalde versie. Tweetalige uitlijning blijft behouden!', 'success');
  };

  const handleUpdateTranslatedPair = (id: number, newTranslatedText: string) => {
    setTranslatedPreviewPairs((prev) => {
      if (!prev) return null;
      return prev.map((item) => (item.id === id ? { ...item, translated: newTranslatedText } : item));
    });
  };

  // Synchronize Lyrics to Audio Submission
  const handleSubmitSync = async () => {
    const rawLyricsWithStructure = lyrics;
    const cleanLyrics = autoCleanLyrics(lyrics);
    if (!audioName || audioDuration <= 0 || !cleanLyrics.trim() || !targetLanguage) {
      showToast('Vul eerst alle 3 de vereisten in', 'error');
      return;
    }

    const isTranslating = sourceLanguage !== targetLanguage;

    setProgressState({
      isSyncing: true,
      step: 1,
      stepLabel: isTranslating
        ? `Zorgvuldige vertaling naar het ${targetLanguage === 'nl' ? 'Nederlands' : 'Engels'}...`
        : 'Vocale frequentieband (280–3500 Hz) en audio spectrum analyseren...',
      progressPercent: 20,
    });

    try {
      // Step 2 Progress
      setTimeout(() => {
        setProgressState((prev) => ({
          ...prev,
          step: 2,
          stepLabel: isTranslating
            ? 'Liedstructuur, rijmschema en metrum verifiëren...'
            : `Adempauzes, frasedalen en zanginzetten detecteren...`,
          progressPercent: 48,
        }));
      }, 600);

      // Step 3 Progress
      setTimeout(() => {
        setProgressState((prev) => ({
          ...prev,
          step: 3,
          stepLabel: 'Akoestische zang-uitlijning op de geluidsgolf berekenen...',
          progressPercent: 78,
        }));
      }, 1200);

      // Execute Server API Sync (handles optional translation or Gemini sync if key is present)
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: audioBase64 || '',
          mimeType: audioFile?.type || 'audio/wav',
          lyrics: cleanLyrics,
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
          language: targetLanguage,
          audioDuration: Math.round(audioDuration),
          translatedPairs: translatedPreviewPairs || undefined,
          style: translationStyle,
          vocalStartTime: vocalStartTime || 0,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server antwoordde met ${response.status}`);
      }

      const data = await response.json();

      // Final Step 4 Progress
      setProgressState((prev) => ({
        ...prev,
        step: 4,
        stepLabel: `Ondertitels op vocale onsets en frasedalen vastzetten (${targetLanguage === 'nl' ? '_NL' : '_EN'})...`,
        progressPercent: 94,
      }));

      if (data.cues && Array.isArray(data.cues)) {
        let finalCues: SubtitleCue[] = [...data.cues].sort((a, b) => a.id - b.id);
        let detectedBreaks = data.detectedBreaks || [];
        let effectiveStart = Math.max(vocalStartTime || 0, data.detectedIntroSilence || 0);

        // If server ran without external Gemini API key (cadence-alignment-engine) and we have the audio,
        // run our full local Whisper AI speech recognition & word-level forced aligner!
        if (audioBlob && (!data.source || data.source === 'cadence-alignment-engine')) {
          const pairsForWhisper = finalCues.map((c) => ({
            id: c.id,
            text: c.text,
            originalText: c.originalText,
          }));

          try {
            const whisperResult = await runLocalWhisperAlignment(
              audioBlob,
              pairsForWhisper,
              audioDuration,
              (targetLanguage || 'en') === 'nl' ? 'nl' : 'en',
              (percent, statusText) => {
                setProgressState((prev) => ({
                  ...prev,
                  step: 3,
                  stepLabel: statusText,
                  progressPercent: percent,
                }));
              }
            );

            if (whisperResult.cues.length > 0) {
              // Automatic waveform snapping: tightens cue borders directly onto visible acoustic peaks & valleys
              try {
                const arrayBuf = await audioBlob.arrayBuffer();
                const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decodedBuf = await actx.decodeAudioData(arrayBuf);
                await actx.close();
                const snapped = alignCuesWithAcousticWaveform(
                  decodedBuf,
                  whisperResult.cues,
                  whisperResult.detectedIntroSilence
                );
                finalCues = snapped.length > 0 ? snapped : whisperResult.cues;
              } catch (_) {
                finalCues = whisperResult.cues;
              }
              detectedBreaks = whisperResult.detectedBreaks;
              effectiveStart = whisperResult.detectedIntroSilence;
            }
          } catch (whisperErr: any) {
            console.warn('Whisper alignment error, falling back to acoustic aligner:', whisperErr);
            // Fallback to acoustic DSP aligner if Web Worker has an issue
            const pairsForAcoustic = finalCues.map((c) => ({
              id: c.id,
              original: c.originalText || c.text,
              translated: c.text,
            }));
            const acousticResult = await alignLyricsToAudioAcoustically(
              audioBlob,
              rawLyricsWithStructure,
              pairsForAcoustic,
              vocalStartTime || 0
            );
            if (acousticResult.cues.length > 0) {
              finalCues = acousticResult.cues;
              detectedBreaks = acousticResult.detectedBreaks;
              effectiveStart = Math.max(vocalStartTime || 0, acousticResult.detectedIntroSilence || 0);
            }
          }
        }

        if (vocalStartTime === 0 && effectiveStart >= 1.5) {
          setVocalStartTime(Math.round(effectiveStart * 10) / 10);
        }

        setCues(finalCues);
        setSelectedCueId(finalCues[0]?.id || null);

        const breaksNotice =
          detectedBreaks && detectedBreaks.length > 0
            ? ` (${detectedBreaks.length} instrumentale pauzes/breaks herkend)`
            : '';
        showToast(
          `Succesvol ${finalCues.length} ${data.translated ? 'vertaalde en ' : ''}akoestisch uitgelijnde regels gegenereerd${breaksNotice}!`,
          'success'
        );
      }

      setProgressState((prev) => ({
        ...prev,
        isSyncing: false,
        progressPercent: 100,
      }));

      // Scroll smoothly to Subtitle Edit Studio
      setActiveSection('subtitle-edit');
      setTimeout(() => {
        subtitleEditSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    } catch (err: any) {
      console.error('Error during synchronization:', err);
      setProgressState((prev) => ({ ...prev, isSyncing: false }));
      showToast(err.message || 'Synchronisatie mislukt', 'error');
    }
  };

  // Apply cues from Timestamp Transfer Modal
  const handleApplyTransferredCues = (transferredCues: SubtitleCue[], language: SupportedLanguage) => {
    setCues(transferredCues);
    setTargetLanguage(language);
    setSelectedCueId(transferredCues[0]?.id || null);
    setActiveSection('subtitle-edit');
    showToast(
      `Succesvol ${transferredCues.length} getimede cues in het ${language === 'nl' ? 'Nederlands' : 'Engels'} geladen!`,
      'success'
    );
    setTimeout(() => {
      subtitleEditSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  };

  // Cue Editing Handlers
  const handleUpdateCue = (updatedCue: SubtitleCue) => {
    setCues((prev) =>
      prev.map((c) => (c.id === updatedCue.id ? updatedCue : c))
    );
  };

  const handleAddCue = (afterIndex: number, specificStart?: number) => {
    const newId = cues.length > 0 ? Math.max(...cues.map((c) => c.id)) + 1 : 1;
    let newStart = 0;
    let newEnd = 3;

    if (specificStart !== undefined && !isNaN(specificStart) && specificStart >= 0) {
      newStart = Math.round(specificStart * 100) / 100;
      newEnd = Math.round((newStart + 3.0) * 100) / 100;
    } else if (afterIndex >= 0 && afterIndex < cues.length) {
      const prev = cues[afterIndex];
      newStart = Math.round((prev.endTime + 0.1) * 100) / 100;
      newEnd = Math.round((newStart + 3.0) * 100) / 100;
    }

    const newCue: SubtitleCue = {
      id: newId,
      startTime: newStart,
      endTime: newEnd,
      text: 'Nieuwe ondertitelregel',
    };

    const nextCues = [...cues, newCue].sort((a, b) => a.startTime - b.startTime);
    setCues(nextCues);
    setSelectedCueId(newId);
    showToast(`Nieuwe cue #${newId} toegevoegd (${formatTimeDisplay(newStart)})`, 'info');
  };

  const handleDeleteCue = (id: number) => {
    setCues((prev) => prev.filter((c) => c.id !== id));
    showToast('Cue verwijderd', 'info');
  };

  const handleSplitCue = (id: number, splitTime: number) => {
    const cue = cues.find((c) => c.id === id);
    if (!cue) return;

    if (splitTime <= cue.startTime || splitTime >= cue.endTime) {
      showToast('Plaats de afspeelkop binnen de cue-duur om te splitsen', 'info');
      return;
    }

    const words = cue.text.split(' ');
    const half = Math.ceil(words.length / 2);
    const text1 = words.slice(0, half).join(' ') || cue.text;
    const text2 = words.slice(half).join(' ') || '...';

    const newId = Math.max(...cues.map((c) => c.id), 0) + 1;
    const cue1: SubtitleCue = {
      ...cue,
      endTime: Math.round(splitTime * 100) / 100,
      text: text1,
    };
    const cue2: SubtitleCue = {
      id: newId,
      startTime: Math.round(splitTime * 100) / 100,
      endTime: cue.endTime,
      text: text2,
      originalText: cue.originalText,
    };

    const index = cues.findIndex((c) => c.id === id);
    const nextCues = [...cues];
    nextCues.splice(index, 1, cue1, cue2);
    setCues(nextCues);
    showToast(`Cue #${cue.id} gesplitst op ${splitTime.toFixed(2)}s`, 'success');
  };

  const handleMergeWithNext = (id: number) => {
    const index = cues.findIndex((c) => c.id === id);
    if (index === -1 || index >= cues.length - 1) return;

    const curr = cues[index];
    const next = cues[index + 1];

    const mergedCue: SubtitleCue = {
      id: curr.id,
      startTime: curr.startTime,
      endTime: next.endTime,
      text: `${curr.text} ${next.text}`.trim(),
      originalText: curr.originalText && next.originalText ? `${curr.originalText} / ${next.originalText}` : curr.originalText || next.originalText,
    };

    const nextCues = [...cues];
    nextCues.splice(index, 2, mergedCue);
    setCues(nextCues);
    showToast(`Cues #${curr.id} en #${next.id} samengevoegd`, 'success');
  };

  const handleGlobalShift = (offsetSeconds: number) => {
    setCues((prev) =>
      prev.map((c) => ({
        ...c,
        startTime: Math.max(0, Math.round((c.startTime + offsetSeconds) * 100) / 100),
        endTime: Math.max(0.5, Math.round((c.endTime + offsetSeconds) * 100) / 100),
      }))
    );
    showToast(`Alle cues met ${offsetSeconds > 0 ? `+${offsetSeconds}` : offsetSeconds}s verschoven`, 'info');
  };

  const handleShiftToVocalStartTime = (newStart: number) => {
    if (newStart < 0 || isNaN(newStart)) return;
    setVocalStartTime(newStart);
    if (cues.length > 0) {
      const currentFirstStart = cues[0].startTime;
      const delta = Math.round((newStart - currentFirstStart) * 100) / 100;
      if (Math.abs(delta) < 0.01) {
        showToast(`Regel #1 begint al op ${newStart.toFixed(2)}s`, 'info');
        return;
      }
      setCues((prev) =>
        prev.map((c) => ({
          ...c,
          startTime: Math.max(0, Math.round((c.startTime + delta) * 100) / 100),
          endTime: Math.max(0.5, Math.round((c.endTime + delta) * 100) / 100),
        }))
      );
      showToast(
        `Alle ${cues.length} cues met ${delta > 0 ? `+${delta}` : delta}s verschoven! Regel #1 start nu op ${newStart}s.`,
        'success'
      );
    } else {
      showToast(`Zang starttijd ingesteld op ${newStart}s voor de synchronisatie.`, 'info');
    }
  };

  const handleAutoFixOverlaps = () => {
    const sorted = [...cues].sort((a, b) => a.startTime - b.startTime);
    let fixes = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        sorted[i].endTime = Math.max(sorted[i].startTime + 0.2, sorted[i + 1].startTime - 0.05);
        sorted[i].endTime = Math.round(sorted[i].endTime * 100) / 100;
        fixes++;
      }
    }

    setCues(sorted);
    showToast(fixes > 0 ? `${fixes} timing-overlappen hersteld` : 'Geen overlappen gevonden', 'success');
  };

  const handleDistributeCuesEvenly = () => {
    if (cues.length === 0) return;
    const startPoint = cues[0]?.startTime || vocalStartTime || 0;
    const totalDur = audioDuration > 10 ? audioDuration : cues.length * 5;
    const outroPad = Math.min(10, Math.max(3, totalDur * 0.05));
    const endPoint = Math.max(startPoint + cues.length * 2.5, totalDur - outroPad);
    const span = endPoint - startPoint;
    const slot = span / cues.length;

    const distributed = cues.map((cue, idx) => {
      const start = Math.round((startPoint + idx * slot + Math.max(0.2, slot * 0.08)) * 100) / 100;
      const naturalDur = Math.max(2.0, Math.min(slot * 0.84, 1.4 + cue.text.length * 0.12));
      const end = Math.round((start + naturalDur) * 100) / 100;
      return {
        ...cue,
        startTime: start,
        endTime: end,
      };
    });

    setCues(distributed);
    showToast(
      `Alle ${cues.length} regels zijn gelijkmatig verdeeld over het nummer (${formatTimeDisplay(startPoint)} tot ${formatTimeDisplay(endPoint)})! Het midden van het lied is nu gevuld.`,
      'success'
    );
  };

  // Snap a specific cue (e.g. Cue #9) and all subsequent cues to the white playhead line (targetTime)
  const handleSnapCueToPlayhead = (cueId: number, targetTime: number) => {
    if (cues.length === 0) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const targetIdx = sorted.findIndex((c) => c.id === cueId);
    if (targetIdx === -1) return;

    const snappedStart = Math.max(0, Math.round(targetTime * 100) / 100);
    const oldStart = sorted[targetIdx].startTime;
    const delta = Math.round((snappedStart - oldStart) * 100) / 100;

    const totalDur = audioDuration > 10 ? audioDuration : sorted.length * 5;
    const outroPad = Math.min(8, Math.max(2.5, totalDur * 0.04));
    const maxSongEnd = Math.max(snappedStart + (sorted.length - targetIdx) * 2.5, totalDur - outroPad);

    const updated = sorted.map((c) => ({ ...c }));

    // Ensure previous cue doesn't overlap the newly snapped start time
    if (targetIdx > 0 && updated[targetIdx - 1].endTime > snappedStart - 0.1) {
      updated[targetIdx - 1].endTime = Math.max(
        updated[targetIdx - 1].startTime + 0.8,
        Math.round((snappedStart - 0.15) * 100) / 100
      );
    }

    // Shift target cue and all following cues by delta, maintaining relative spacing
    let runningEnd = snappedStart;
    const remainingCount = updated.length - targetIdx;

    for (let i = targetIdx; i < updated.length; i++) {
      const cue = updated[i];
      const origDur = Math.max(1.8, Math.min(7.0, cue.endTime - cue.startTime));
      if (i === targetIdx) {
        cue.startTime = snappedStart;
        cue.endTime = Math.round((snappedStart + origDur) * 100) / 100;
      } else {
        let shiftedStart = Math.round((cue.startTime + delta) * 100) / 100;
        // Ensure cues do not overlap, but preserve genuine pauses and instrumental breaks
        if (shiftedStart < runningEnd + 0.15) {
          shiftedStart = Math.round((runningEnd + 0.2) * 100) / 100;
        }
        cue.startTime = shiftedStart;
        cue.endTime = Math.round((shiftedStart + origDur) * 100) / 100;
      }
      runningEnd = cue.endTime;
    }

    // If the tail cues exceed the audio duration, scale the tail proportionally into [snappedStart, maxSongEnd]
    const lastCueEnd = updated[updated.length - 1].endTime;
    if (audioDuration > 15 && lastCueEnd > audioDuration - 0.5 && remainingCount > 1) {
      const currentSpan = Math.max(1, lastCueEnd - snappedStart);
      const targetSpan = Math.max(remainingCount * 2.2, maxSongEnd - snappedStart);
      const scale = targetSpan / currentSpan;
      for (let i = targetIdx; i < updated.length; i++) {
        const relStart = updated[i].startTime - snappedStart;
        const relDur = Math.max(1.8, (updated[i].endTime - updated[i].startTime) * scale);
        const newS = Math.round((snappedStart + relStart * scale) * 100) / 100;
        updated[i].startTime = newS;
        updated[i].endTime = Math.round((newS + Math.min(6.5, relDur)) * 100) / 100;
      }
    }

    setCues(updated);
    setSelectedCueId(cueId);
    showToast(
      `Regel #${cueId} ("${updated[targetIdx].text.slice(0, 28)}…") én alle volgende regels starten nu op de witte lijn (${formatTimeDisplay(snappedStart)})!`,
      'success'
    );
  };

  // Insert an instrumental break / solo pause before a cue (pushes this cue and all following cues forward by breakSeconds)
  const handleInsertInstrumentalBreak = (fromCueId: number, breakSeconds: number = 15) => {
    if (cues.length === 0) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const targetIdx = sorted.findIndex((c) => c.id === fromCueId);
    if (targetIdx === -1) return;

    const updated = sorted.map((c) => ({ ...c }));
    for (let i = targetIdx; i < updated.length; i++) {
      const dur = Math.max(1.8, Math.min(8.0, updated[i].endTime - updated[i].startTime));
      updated[i].startTime = Math.round((updated[i].startTime + breakSeconds) * 100) / 100;
      updated[i].endTime = Math.round((updated[i].startTime + dur) * 100) / 100;
    }

    setCues(updated);
    setSelectedCueId(fromCueId);
    showToast(
      `🎸 Instrumentale solo/break (+${breakSeconds}s) ingevoegd vóór Regel #${fromCueId}! Alle volgende zinnen zijn ${breakSeconds}s doorgeschoven.`,
      'success'
    );
  };

  // Cut vocal line early at playhead (when singer stops before an instrumental break)
  const handleCutVocalAtPlayhead = (cueId: number, cutTime?: number) => {
    const atTime = cutTime !== undefined ? cutTime : currentTime;
    const targetIdx = cues.findIndex((c) => c.id === cueId);
    if (targetIdx === -1) return;
    const targetCue = cues[targetIdx];
    const newEnd = Math.max(targetCue.startTime + 0.8, Math.round(atTime * 100) / 100);
    const updated = [...cues];
    updated[targetIdx] = { ...targetCue, endTime: newEnd };
    setCues(updated);
    showToast(
      `✂️ Regel #${cueId} beëindigd op ${formatTimeDisplay(newEnd)} (zang stopt hier voor instrumentale break).`,
      'success'
    );
  };

  // Detect and close unnatural mid-song gaps (manual trigger from button only)
  const handleRepairMidSongGaps = () => {
    if (cues.length < 2) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id).map((c) => ({ ...c }));
    let repairedGaps = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gap = curr.startTime - prev.endTime;

      // Case 1: If white playhead (currentTime) is currently inside a large gap (> 10s), snap to white playhead
      if (gap > 10 && currentTime > prev.endTime + 0.5 && currentTime < curr.startTime - 0.5) {
        const shift = Math.round((currentTime - curr.startTime) * 100) / 100;
        for (let k = i; k < sorted.length; k++) {
          sorted[k].startTime = Math.max(prev.endTime + 0.3, Math.round((sorted[k].startTime + shift) * 100) / 100);
          sorted[k].endTime = Math.max(
            sorted[k].startTime + 1.8,
            Math.round((sorted[k].endTime + shift) * 100) / 100
          );
        }
        repairedGaps++;
        continue;
      }

      // Case 2: Any gap > 20s can be compacted to 5s if user manually clicked repair
      if (gap > 20) {
        const targetStart = Math.round((prev.endTime + 5.0) * 100) / 100;
        const shift = Math.round((targetStart - curr.startTime) * 100) / 100;
        for (let k = i; k < sorted.length; k++) {
          sorted[k].startTime = Math.max(prev.endTime + 0.3, Math.round((sorted[k].startTime + shift) * 100) / 100);
          sorted[k].endTime = Math.max(
            sorted[k].startTime + 1.8,
            Math.round((sorted[k].endTime + shift) * 100) / 100
          );
        }
        repairedGaps++;
      }
    }

    if (repairedGaps > 0) {
      setCues(sorted);
      showToast(
        `${repairedGaps} gat(en) in het midden van het nummer hersteld!`,
        'success'
      );
    } else {
      handleDistributeCuesEvenly();
    }
  };

  const handleNavigation = (section: 'studio' | 'subtitle-edit' | 'editor') => {
    setActiveSection(section);
    if (section === 'subtitle-edit' && subtitleEditSectionRef.current) {
      subtitleEditSectionRef.current.scrollIntoView({ behavior: 'smooth' });
    } else if (section === 'editor' && editorSectionRef.current) {
      editorSectionRef.current.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-full flex flex-col bg-slate-950 text-slate-100">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-xl border backdrop-blur-md text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast.type === 'success' ? (
            <div className="flex items-center gap-2 bg-emerald-950/90 text-emerald-200 border-emerald-800/80 px-3 py-1.5 rounded-lg border">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{toast.text}</span>
            </div>
          ) : toast.type === 'error' ? (
            <div className="flex items-center gap-2 bg-red-950/90 text-red-200 border-red-800/80 px-3 py-1.5 rounded-lg border">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span>{toast.text}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-slate-900/90 text-slate-200 border-slate-700 px-3 py-1.5 rounded-lg border">
              <Info className="w-4 h-4 text-indigo-400" />
              <span>{toast.text}</span>
            </div>
          )}
        </div>
      )}

      {/* Top Navigation */}
      <Navbar
        canExport={cues.length > 0}
        onExportClick={() => setIsExportModalOpen(true)}
        onOpenDemo={handleLoadDemoTrack}
        activeSection={activeSection}
        onNavigate={handleNavigation}
        hasActiveProject={Boolean(audioUrl || lyrics.trim() || cues.length > 0)}
        onStartNewSong={() => handleRequestStartNewSong(false)}
        onOpenMp4Converter={() => setIsMp4ModalOpen(true)}
        onOpenTimestampTransfer={() => setIsTimestampTransferOpen(true)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Editorial Sub-Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-400">
            <span>Audio & Songtekst Synchronisatie</span>
            <span aria-hidden="true">·</span>
            <span>Zorgvuldige Poëtische Vertaling (NL & EN)</span>
            <span aria-hidden="true">·</span>
            <span>SRT & WebVTT Exporter</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Precision Music Subtitle Studio
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
            Upload je muziekbestand en songtekst. Kies de brontaal en doeltaal. Indien de talen verschillen,
            wordt de tekst eerst literair en poëtisch vertaald met behoud van emotie, ritme en zeggingskracht,
            vervolgens milliseconde-nauwkeurig gesynchroniseerd met de audio en geëxporteerd als SRT of VTT.
          </p>
        </div>

        {/* Section 1: Audio & Lyrics Setup Form */}
        <AudioLyricsForm
          audioFile={audioFile}
          audioName={audioName}
          audioDuration={audioDuration}
          lyrics={lyrics}
          sourceLanguage={sourceLanguage}
          targetLanguage={targetLanguage}
          isSyncing={progressState.isSyncing}
          isTranslatingPreview={isTranslatingPreview}
          translatedPreviewPairs={translatedPreviewPairs}
          onAudioSelected={handleAudioSelected}
          onAudioRemoved={handleAudioRemoved}
          onLyricsChange={setLyrics}
          onSourceLanguageSelect={setSourceLanguage}
          onTargetLanguageSelect={setTargetLanguage}
          onTranslatePreview={handleTranslatePreview}
          onApplyTranslatedLyrics={handleApplyTranslatedLyrics}
          onUpdateTranslatedPair={handleUpdateTranslatedPair}
          translationStyle={translationStyle}
          onTranslationStyleChange={setTranslationStyle}
          isImprovingTranslation={isImprovingTranslation}
          onImproveTranslation={handleImproveTranslation}
          onSubmitSync={handleSubmitSync}
          onLoadDemoTrack={handleLoadDemoTrack}
          onOpenMp4Converter={() => setIsMp4ModalOpen(true)}
          onOpenTimestampTransfer={() => setIsTimestampTransferOpen(true)}
          vocalStartTime={vocalStartTime}
          onVocalStartTimeChange={setVocalStartTime}
          currentTime={currentTime}
        />

        {/* Section 2: Flagship Subtitle Edit Studio Workspace (Matching Subtitle Edit v5.2 layout) */}
        {audioUrl && (
          <div ref={subtitleEditSectionRef} className="space-y-4">
            <SubtitleEditStudio
              audioUrl={audioUrl}
              audioBlob={audioBlob}
              audioDuration={audioDuration}
              audioName={audioName}
              cues={cues}
              waveformPeaks={waveformPeaks}
              selectedCueId={selectedCueId}
              onSelectCue={setSelectedCueId}
              onUpdateCue={handleUpdateCue}
              onUpdateAllCues={setCues}
              onAddCue={handleAddCue}
              onDeleteCue={handleDeleteCue}
              onSplitCue={handleSplitCue}
              onMergeWithNext={handleMergeWithNext}
              onSnapCueToPlayhead={handleSnapCueToPlayhead}
              onInsertInstrumentalBreak={handleInsertInstrumentalBreak}
              onCutVocalAtPlayhead={handleCutVocalAtPlayhead}
              onRepairMidSongGaps={handleRepairMidSongGaps}
              onDistributeCuesEvenly={handleDistributeCuesEvenly}
              onOpenExportModal={() => setIsExportModalOpen(true)}
              onOpenMp4Converter={() => setIsMp4ModalOpen(true)}
              onOpenTimestampTransfer={() => setIsTimestampTransferOpen(true)}
            />
          </div>
        )}

        {/* Section 3: Optional Classic Table View (Accessible via navigation) */}
        {cues.length > 0 && activeSection === 'editor' && (
          <div ref={editorSectionRef} className="space-y-4">
            <CueEditor
              cues={cues}
              currentTime={currentTime}
              selectedCueId={selectedCueId}
              onSelectCue={setSelectedCueId}
              onUpdateCue={handleUpdateCue}
              onAddCue={handleAddCue}
              onDeleteCue={handleDeleteCue}
              onSplitCue={handleSplitCue}
              onMergeWithNext={handleMergeWithNext}
              onJumpToTime={(t) => {
                setCurrentTime(t);
                const audioEl = document.querySelector('audio');
                if (audioEl) {
                  audioEl.currentTime = t;
                  audioEl.play().catch(() => {});
                  setIsPlaying(true);
                }
              }}
              onGlobalShift={handleGlobalShift}
              onAutoFixOverlaps={handleAutoFixOverlaps}
              onOpenTimestampTransfer={() => setIsTimestampTransferOpen(true)}
              vocalStartTime={vocalStartTime}
              onShiftToVocalStartTime={handleShiftToVocalStartTime}
              onDistributeCuesEvenly={handleDistributeCuesEvenly}
              onSnapCueToPlayhead={handleSnapCueToPlayhead}
              onRepairMidSongGaps={handleRepairMidSongGaps}
              onInsertInstrumentalBreak={handleInsertInstrumentalBreak}
              onCutVocalAtPlayhead={handleCutVocalAtPlayhead}
            />
          </div>
        )}

        {/* Export Banner CTA when cues exist */}
        {cues.length > 0 && (
          <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/60 border border-indigo-900/50 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center sm:text-left">
              <h3 className="text-base font-semibold text-white flex items-center gap-2 justify-center sm:justify-start">
                <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
                Ondertitels Gereed voor Export
              </h3>
              <p className="text-xs text-slate-400">
                {cues.length} gesynchroniseerde cues gereed voor download ({targetLanguage === 'nl' ? 'bestand_NL.srt' : 'bestand_EN.srt'}).
                {sourceLanguage !== targetLanguage && ' (Inclusief poëtische vertaling)'}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap justify-center sm:justify-end">
              <button
                type="button"
                onClick={() => handleRequestStartNewSong(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 active:scale-95 cursor-pointer"
                title="Begin helemaal opnieuw met een nieuw lied"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>Nieuw lied starten</span>
              </button>

              <button
                type="button"
                onClick={() => setIsTimestampTransferOpen(true)}
                className="px-4 py-2.5 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-500/40 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 active:scale-95 cursor-pointer shadow-sm"
                title="Kopieer Engelse tijden direct naar Nederlandse of andere taal .srt met zinscontrole"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tijden Kopiëren (.SRT)</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMp4ModalOpen(true)}
                className="px-4 py-2.5 bg-purple-950/70 hover:bg-purple-900/80 text-purple-200 border border-purple-500/40 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 active:scale-95 cursor-pointer shadow-sm"
                title="Zet audio en cover om naar een MP4 video"
              >
                <Video className="w-4 h-4 text-purple-400" />
                <span>MP3 naar MP4 Video</span>
              </button>

              <button
                type="button"
                onClick={() => setIsExportModalOpen(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/30 transition-transform active:scale-95 whitespace-nowrap cursor-pointer flex items-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Exporteer & Download Bestand</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Real-Time Syncing Feedback Modal */}
      <SyncProgressModal
        progressState={progressState}
        sourceLanguage={sourceLanguage}
        targetLanguage={targetLanguage}
      />

      {/* Subtitle Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        cues={cues}
        songTitle={audioName || 'song_subtitles'}
        language={targetLanguage}
        onStartNewSong={() => executeStartNewSong()}
        onOpenMp4Converter={() => setIsMp4ModalOpen(true)}
        onOpenTimestampTransfer={() => setIsTimestampTransferOpen(true)}
      />

      {/* MP3 to MP4 Video Converter Modal */}
      <Mp3ToMp4Modal
        isOpen={isMp4ModalOpen}
        onClose={() => setIsMp4ModalOpen(false)}
        currentAudioFile={audioFile}
        currentAudioBase64={audioBase64}
        currentAudioName={audioName}
        currentAudioDuration={audioDuration}
        cues={cues}
      />

      {/* Timestamp Transfer to Another Language Modal */}
      <TimestampTransferModal
        isOpen={isTimestampTransferOpen}
        onClose={() => setIsTimestampTransferOpen(false)}
        activeCues={cues}
        songTitle={audioName || 'song_subtitles'}
        defaultSourceLang={sourceLanguage}
        availableTargetLyrics={
          translatedPreviewPairs && translatedPreviewPairs.length > 0
            ? translatedPreviewPairs.map((p) => p.translated).join('\n')
            : lyrics
        }
        onApplyCuesToStudio={handleApplyTransferredCues}
      />

      {/* In-App Confirmation Modal for Starting Over */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Helemaal opnieuw beginnen?
                </h3>
                <p className="text-xs text-slate-400">
                  Alle huidige audio, tekst en synchronisaties worden gewist.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 text-xs text-slate-300 space-y-1.5">
              {audioName && (
                <p className="flex items-center gap-2">
                  <span className="text-slate-500">Audio:</span>
                  <span className="font-semibold text-slate-200 truncate">{audioName}</span>
                </p>
              )}
              {cues.length > 0 && (
                <p className="flex items-center gap-2">
                  <span className="text-slate-500">Ondertitels:</span>
                  <span className="font-semibold text-indigo-400">{cues.length} gesynchroniseerde cues</span>
                </p>
              )}
              <p className="text-[11px] text-amber-400/90 pt-1">
                💡 Tip: Zorg dat u het SRT- of VTT-bestand al heeft gedownload indien u deze wilt bewaren.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={executeStartNewSong}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-md shadow-red-600/20 active:scale-95 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Ja, begin met nieuw lied</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-6 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">LyricSync Studio</span>
            <span>·</span>
            <span>Nederlands & Engels Audio-Songtekst Synchronisator met Poëtische Vertaling</span>
          </div>
          <div>
            Ondersteunt officiële SRT en WebVTT standaarden met taalcoderingen _NL en _EN
          </div>
        </div>
      </footer>
    </div>
  );
}
