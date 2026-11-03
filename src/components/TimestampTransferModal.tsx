import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Upload,
  FileText,
  Sparkles,
  Download,
  Copy,
  Check,
  Split,
  Combine,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  Info,
  ShieldCheck,
  Languages,
} from 'lucide-react';
import { SubtitleCue, SupportedLanguage } from '../types/subtitle';
import { parseCleanLyricLines, parseSrtFile } from '../utils/srtParser';
import { formatTimeDisplay, formatSecondsToSrt } from '../utils/timeFormat';
import { generateSrt, generateVtt, downloadSubtitleFile } from '../utils/exportSubtitles';

interface TimestampTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCues: SubtitleCue[];
  songTitle: string;
  defaultSourceLang?: SupportedLanguage;
  availableTargetLyrics?: string;
  onApplyCuesToStudio: (cues: SubtitleCue[], language: SupportedLanguage) => void;
}

export const TimestampTransferModal: React.FC<TimestampTransferModalProps> = ({
  isOpen,
  onClose,
  activeCues,
  songTitle,
  defaultSourceLang = 'en',
  availableTargetLyrics = '',
  onApplyCuesToStudio,
}) => {
  // Source State: Either use current active cues or an uploaded SRT file
  const [sourceMode, setSourceMode] = useState<'studio' | 'upload'>('studio');
  const [uploadedSourceCues, setUploadedSourceCues] = useState<SubtitleCue[]>([]);
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [sourceLang, setSourceLang] = useState<SupportedLanguage>(defaultSourceLang);

  // Target State
  const [targetLang, setTargetLang] = useState<SupportedLanguage>('nl');
  const [targetText, setTargetText] = useState<string>(availableTargetLyrics || '');
  const [targetFileName, setTargetFileName] = useState<string>('');

  // Editing & UI State
  const [viewMode, setViewMode] = useState<'text' | 'side-by-side'>('side-by-side');
  const [isRealigningWithAI, setIsRealigningWithAI] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const targetFileInputRef = useRef<HTMLInputElement>(null);

  // Sync available target lyrics and source mode when modal opens
  useEffect(() => {
    if (isOpen) {
      if (!targetText.trim() && availableTargetLyrics.trim()) {
        setTargetText(availableTargetLyrics);
      }
      if (activeCues.length === 0 && uploadedSourceCues.length === 0) {
        setSourceMode('upload');
      }
    }
  }, [isOpen, availableTargetLyrics, activeCues.length, uploadedSourceCues.length, targetText]);

  // Determine current effective source cues
  const effectiveSourceCues: SubtitleCue[] = useMemo(() => {
    if (sourceMode === 'upload' && uploadedSourceCues.length > 0) {
      return uploadedSourceCues;
    }
    if (uploadedSourceCues.length > 0 && activeCues.length === 0) {
      return uploadedSourceCues;
    }
    return activeCues;
  }, [sourceMode, uploadedSourceCues, activeCues]);

  // Source lines from cues
  const sourceLines = useMemo(() => {
    return effectiveSourceCues.map((c) => c.text);
  }, [effectiveSourceCues]);

  // Target lines parsed from target text
  const targetLines = useMemo(() => {
    return parseCleanLyricLines(targetText);
  }, [targetText]);

  // Verification check: Does sentence count match?
  const sourceCount = sourceLines.length;
  const targetCount = targetLines.length;
  const isCountMatched = sourceCount > 0 && targetCount > 0 && sourceCount === targetCount;
  const lineDifference = targetCount - sourceCount;

  // Generate transferred cues if matched
  const transferredCues: SubtitleCue[] = useMemo(() => {
    if (!isCountMatched) return [];
    return effectiveSourceCues.map((cue, idx) => ({
      id: cue.id,
      startTime: cue.startTime,
      endTime: cue.endTime,
      text: targetLines[idx] || cue.text,
      originalText: cue.text,
    }));
  }, [isCountMatched, effectiveSourceCues, targetLines]);

  const cleanTitle = songTitle.replace(/\.[^/.]+$/, '').trim() || 'subtitles';
  const targetSrtContent = useMemo(() => {
    return transferredCues.length > 0 ? generateSrt(transferredCues) : '';
  }, [transferredCues]);

  if (!isOpen) return null;

  // Handle uploading a source .SRT file
  const handleUploadSourceSrt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = parseSrtFile(content);
        if (parsed.length > 0) {
          setUploadedSourceCues(parsed);
          setSourceFileName(file.name);
          setSourceMode('upload');
          setStatusMessage({
            type: 'success',
            text: `Bron .srt geladen: ${file.name} met ${parsed.length} zinnen/cues.`,
          });
        } else {
          setStatusMessage({
            type: 'error',
            text: 'Kon geen geldige ondertitels vinden in het geüploade bestand.',
          });
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Handle uploading target text / srt file
  const handleUploadTargetFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        if (file.name.toLowerCase().endsWith('.srt')) {
          const parsed = parseSrtFile(content);
          const lines = parsed.map((c) => c.text).join('\n');
          setTargetText(lines);
        } else {
          setTargetText(content);
        }
        setTargetFileName(file.name);
        setStatusMessage({
          type: 'success',
          text: `Doelbestand geladen: ${file.name}`,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // AI Realign: uses Gemini to restructure the target text into exactly sourceCount lines
  const handleRealignWithAI = async () => {
    if (sourceCount === 0 || !targetText.trim()) return;

    setIsRealigningWithAI(true);
    setStatusMessage({
      type: 'info',
      text: `AI herschikt de doeltaaltekst naar exact ${sourceCount} zinnen...`,
    });

    try {
      const res = await fetch('/api/realign-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLines,
          targetText,
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'AI-uitlijning mislukt');
      }

      const data = await res.json();
      if (data.alignedLines && Array.isArray(data.alignedLines)) {
        setTargetText(data.alignedLines.join('\n'));
        setStatusMessage({
          type: 'success',
          text: `Succes! De tekst is automatisch aangepast naar exact ${data.alignedLines.length} zinnen.`,
        });
      }
    } catch (err: any) {
      console.error('Error during AI realign:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Kon lijnen niet automatisch uitlijnen met AI.',
      });
    } finally {
      setIsRealigningWithAI(false);
    }
  };

  // Manual Line Operations in Side-by-Side view
  const handleUpdateTargetLine = (index: number, newText: string) => {
    const updated = [...targetLines];
    updated[index] = newText;
    setTargetText(updated.join('\n'));
  };

  const handleSplitTargetLine = (index: number) => {
    const line = targetLines[index] || '';
    const words = line.split(' ');
    if (words.length <= 1) {
      setStatusMessage({
        type: 'info',
        text: 'Regel heeft te weinig woorden om automatisch in tweeën te splitsen. Pas handmatig aan.',
      });
      return;
    }
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');

    const updated = [...targetLines];
    updated.splice(index, 1, line1, line2);
    setTargetText(updated.join('\n'));
    setStatusMessage({
      type: 'info',
      text: `Regel ${index + 1} gesplitst in 2 regels.`,
    });
  };

  const handleMergeTargetWithNext = (index: number) => {
    if (index >= targetLines.length - 1) return;
    const line1 = targetLines[index] || '';
    const line2 = targetLines[index + 1] || '';
    const merged = `${line1} ${line2}`.trim();

    const updated = [...targetLines];
    updated.splice(index, 2, merged);
    setTargetText(updated.join('\n'));
    setStatusMessage({
      type: 'info',
      text: `Regel ${index + 1} samengevoegd met regel ${index + 2}.`,
    });
  };

  const handleAddEmptyTargetLine = (afterIndex: number) => {
    const updated = [...targetLines];
    updated.splice(afterIndex + 1, 0, '...');
    setTargetText(updated.join('\n'));
  };

  const handleDeleteTargetLine = (index: number) => {
    const updated = [...targetLines];
    updated.splice(index, 1);
    setTargetText(updated.join('\n'));
  };

  // Export / Apply
  const handleDownloadSrt = () => {
    if (!isCountMatched || transferredCues.length === 0) return;
    downloadSubtitleFile(cleanTitle, targetSrtContent, 'srt', targetLang);
    setStatusMessage({
      type: 'success',
      text: `Bestand gedownload: ${cleanTitle}_${targetLang.toUpperCase()}.srt`,
    });
  };

  const handleDownloadVtt = () => {
    if (!isCountMatched || transferredCues.length === 0) return;
    const vtt = generateVtt(transferredCues, cleanTitle);
    downloadSubtitleFile(cleanTitle, vtt, 'vtt', targetLang);
    setStatusMessage({
      type: 'success',
      text: `Bestand gedownload: ${cleanTitle}_${targetLang.toUpperCase()}.vtt`,
    });
  };

  const handleCopySrt = async () => {
    if (!targetSrtContent) return;
    try {
      await navigator.clipboard.writeText(targetSrtContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setStatusMessage({ type: 'success', text: 'SRT-inhoud gekopieerd naar klembord!' });
    } catch (_) {}
  };

  const handleApplyToStudio = () => {
    if (!isCountMatched || transferredCues.length === 0) return;
    onApplyCuesToStudio(transferredCues, targetLang);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full flex flex-col max-h-[92vh] shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Tijden Kopiëren naar Andere Taal (.SRT Sync)
                </h2>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                  Exacte Tijdsynchronisatie
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Kopieer de getimede start- en eindtijden van je Engelse .srt direct naar de Nederlandse (of andere taal) .srt
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toast */}
        {statusMessage && (
          <div
            className={`px-4 py-2.5 text-xs flex items-center justify-between border-b transition-all ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
                : statusMessage.type === 'error'
                ? 'bg-rose-950/60 border-rose-500/30 text-rose-300'
                : 'bg-indigo-950/60 border-indigo-500/30 text-indigo-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>{statusMessage.text}</span>
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white text-[11px] ml-2"
            >
              Sluiten
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Top Grid: Source Setup vs Target Setup */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Bron (Engelse SRT / Cues) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Bron (Tijdstempels)
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                    {sourceCount} zinnen / cues
                  </span>
                </div>

                {/* Source Selection Toggle */}
                <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs mb-3">
                  <button
                    type="button"
                    onClick={() => setSourceMode('studio')}
                    disabled={activeCues.length === 0}
                    className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-all ${
                      sourceMode === 'studio'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : activeCues.length === 0
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Huidige cues ({activeCues.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode('upload');
                      sourceFileInputRef.current?.click();
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                      sourceMode === 'upload'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Upload className="w-3 h-3" />
                    <span>Upload .SRT</span>
                  </button>
                  <input
                    ref={sourceFileInputRef}
                    type="file"
                    accept=".srt"
                    onChange={handleUploadSourceSrt}
                    className="hidden"
                  />
                </div>

                {sourceMode === 'upload' && sourceFileName && (
                  <p className="text-[11px] text-slate-400 mb-2 truncate">
                    Bestand: <span className="text-white font-mono">{sourceFileName}</span>
                  </p>
                )}

                {sourceCount === 0 ? (
                  <div
                    onClick={() => sourceFileInputRef.current?.click()}
                    className="p-4 rounded-xl bg-indigo-950/30 hover:bg-indigo-950/50 border-2 border-dashed border-indigo-500/40 text-indigo-200 text-xs flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center"
                  >
                    <Upload className="w-5 h-5 text-indigo-400" />
                    <div>
                      <p className="font-semibold text-white">Klik hier om je Engelse .SRT bestand te kiezen</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Alle start- en eindtijden worden direct ingelezen
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/90 rounded-lg p-2.5 border border-slate-800/80 max-h-24 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
                    {effectiveSourceCues.slice(0, 3).map((cue, idx) => (
                      <div key={cue.id} className="truncate">
                        <span className="text-indigo-400">[{formatTimeDisplay(cue.startTime)} → {formatTimeDisplay(cue.endTime)}]</span>{' '}
                        <span>#{idx + 1}: {cue.text}</span>
                      </div>
                    ))}
                    {sourceCount > 3 && (
                      <div className="text-slate-500 italic text-[10px]">
                        + nog {sourceCount - 3} regels...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Language selection */}
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">Brontaal:</span>
                <select
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value as SupportedLanguage)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                >
                  <option value="en">Engels (EN)</option>
                  <option value="nl">Nederlands (NL)</option>
                </select>
              </div>
            </div>

            {/* Box 2: Doeltaal & Tekst */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600/30 text-emerald-400 text-xs font-bold flex items-center justify-center">
                      2
                    </span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Doeltaal (Tekst)
                    </span>
                  </div>
                  <span
                    className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                      isCountMatched
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800/40'
                        : targetCount > 0
                        ? 'bg-amber-950 text-amber-300 border-amber-800/40'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {targetCount} zinnen gedetecteerd
                  </span>
                </div>

                {/* Upload or paste actions */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => targetFileInputRef.current?.click()}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3 h-3 text-emerald-400" />
                    <span>Upload bestand (.txt / .srt)</span>
                  </button>
                  <input
                    ref={targetFileInputRef}
                    type="file"
                    accept=".txt,.srt"
                    onChange={handleUploadTargetFile}
                    className="hidden"
                  />

                  {availableTargetLyrics && (
                    <button
                      type="button"
                      onClick={() => setTargetText(availableTargetLyrics)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-300 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Vul met de reeds vertaalde songtekst uit de studio"
                    >
                      <Sparkles className="w-3 h-3 text-indigo-400" />
                      <span>Gebruik studio-vertaling</span>
                    </button>
                  )}
                </div>

                <textarea
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  placeholder="Plak hier de Nederlandse tekst of vertaling (1 zin/regel per ondertitel)..."
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 font-mono text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              {/* Target Language dropdown */}
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">Doeltaal:</span>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value as SupportedLanguage)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                >
                  <option value="nl">Nederlands (_NL)</option>
                  <option value="en">Engels (_EN)</option>
                </select>
              </div>
            </div>
          </div>

          {/* CRITICAL SENTENCE COUNT VERIFICATION BANNER */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border transition-all ${
              isCountMatched
                ? 'bg-gradient-to-r from-emerald-950/90 via-slate-900 to-indigo-950/70 border-emerald-500/50 shadow-lg shadow-emerald-950/20'
                : targetCount > 0
                ? 'bg-gradient-to-r from-amber-950/90 via-slate-900 to-rose-950/60 border-amber-500/50 shadow-lg shadow-amber-950/20'
                : 'bg-slate-950/60 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    isCountMatched
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : targetCount > 0
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      : 'bg-slate-800 text-slate-500 border-slate-700'
                  }`}
                >
                  {isCountMatched ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : targetCount > 0 ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <ShieldCheck className="w-5 h-5" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      {isCountMatched
                        ? 'Controle geslaagd: Exact gelijk aantal zinnen!'
                        : targetCount > 0
                        ? 'Aantal zinnen verschilt!'
                        : 'Wachten op doeltaaltekst...'}
                    </h3>
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                        isCountMatched
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      Bron: {sourceCount} zinnen | Doeltaal: {targetCount} zinnen
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {isCountMatched ? (
                      <span>
                        Elke bronregel heeft exact één corresponderende regel in de doeltaal.
                        De start- en eindtijden worden <strong>1-op-1</strong> overgedragen!
                      </span>
                    ) : targetCount > 0 ? (
                      <span>
                        De doeltaal heeft{' '}
                        <strong>
                          {Math.abs(lineDifference)} {Math.abs(lineDifference) === 1 ? 'regel' : 'regels'}{' '}
                          {lineDifference > 0 ? 'te veel' : 'te weinig'}
                        </strong>
                        . Synchroniseer regels met de AI-knop hiernaast of pas regels handmatig aan in het overzicht.
                      </span>
                    ) : (
                      <span>Plak hierboven de Nederlandse tekst om de zinscontrole uit te voeren.</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Action for Mismatch: AI Smart Realign */}
              {!isCountMatched && targetCount > 0 && sourceCount > 0 && (
                <div className="shrink-0 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleRealignWithAI}
                    disabled={isRealigningWithAI}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-950/40 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    <Sparkles className={`w-4 h-4 text-amber-300 ${isRealigningWithAI ? 'animate-spin' : ''}`} />
                    <span>
                      {isRealigningWithAI
                        ? 'AI egaliseert zinnen...'
                        : `Gelijkstellen met AI (${sourceCount} regels)`}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* View Toggle & Line-by-Line Table */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-3 sm:p-4 bg-slate-900/60 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  Regel-voor-regel vergelijking & tijden
                </span>
                <span className="text-[10px] text-slate-400">
                  (Klik op een regel om direct tekst aan te passen)
                </span>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'side-by-side' ? 'text' : 'side-by-side')}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>{viewMode === 'side-by-side' ? 'Wissel naar platte tekst' : 'Wissel naar tabel'}</span>
                </button>
              </div>
            </div>

            {viewMode === 'side-by-side' ? (
              <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-800/60 text-xs">
                {Array.from({ length: Math.max(sourceCount, targetCount) }).map((_, index) => {
                  const sourceCue = effectiveSourceCues[index];
                  const sourceLine = sourceLines[index];
                  const targetLine = targetLines[index];
                  const isRowMissing = !sourceLine || !targetLine;

                  return (
                    <div
                      key={index}
                      className={`grid grid-cols-12 gap-3 p-3 items-center transition-colors ${
                        isRowMissing
                          ? 'bg-amber-950/20'
                          : index % 2 === 0
                          ? 'bg-slate-950/40'
                          : 'bg-slate-900/20'
                      }`}
                    >
                      {/* Index & Timestamp */}
                      <div className="col-span-3 sm:col-span-2 flex flex-col">
                        <div className="flex items-center gap-1 font-mono font-bold text-slate-400">
                          <span>#{index + 1}</span>
                          {isRowMissing && (
                            <span className="text-[10px] text-amber-400 font-sans">
                              {!sourceLine ? '(Geen bron)' : '(Ontbreekt)'}
                            </span>
                          )}
                        </div>
                        {sourceCue ? (
                          <span className="font-mono text-[10px] text-indigo-400">
                            {formatTimeDisplay(sourceCue.startTime)} → {formatTimeDisplay(sourceCue.endTime)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">Geen tijd</span>
                        )}
                      </div>

                      {/* Source Text (English) */}
                      <div className="col-span-4 sm:col-span-4 text-slate-300 font-mono text-[11px] truncate" title={sourceLine || ''}>
                        {sourceLine || <span className="text-slate-600 italic">-</span>}
                      </div>

                      {/* Target Text (Dutch / Other) Editable */}
                      <div className="col-span-4 sm:col-span-5">
                        <input
                          type="text"
                          value={targetLine || ''}
                          placeholder={sourceCue ? 'Vul doeltaalzin in...' : ''}
                          onChange={(e) => handleUpdateTargetLine(index, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      {/* Action buttons (Split / Merge) */}
                      <div className="col-span-1 sm:col-span-1 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleSplitTargetLine(index)}
                          title="Splits deze regel in tweeën (+1 regel)"
                          className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                        >
                          <Split className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMergeTargetWithNext(index)}
                          title="Voeg samen met volgende regel (-1 regel)"
                          disabled={index >= targetLines.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Combine className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {sourceCount === 0 && targetCount === 0 && (
                  <div className="p-8 text-center text-slate-500 text-xs italic">
                    Geen regels om weer te geven. Voer een bron en doeltaal in.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4">
                <textarea
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Resultaat:</span>
            <span className="font-mono text-white font-semibold">
              {cleanTitle}_{targetLang.toUpperCase()}.srt
            </span>
            {isCountMatched && (
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                {transferredCues.length} getimede cues
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={handleCopySrt}
              disabled={!isCountMatched}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Gekopieerd!' : 'Kopieer .SRT'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadVtt}
              disabled={!isCountMatched}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .VTT</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadSrt}
              disabled={!isCountMatched}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md ${
                isCountMatched
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-700/30 cursor-pointer active:scale-95'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {targetLang.toUpperCase()} .SRT</span>
            </button>

            <button
              type="button"
              onClick={handleApplyToStudio}
              disabled={!isCountMatched}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md ${
                isCountMatched
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 cursor-pointer active:scale-95'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
              title="Laad deze getimede ondertitels direct in de studio speler en editor"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Toepassen in Studio</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
