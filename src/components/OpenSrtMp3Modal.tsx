import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  FolderOpen,
  Music,
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Search,
  Play,
  Sparkles,
  Loader2,
  Check,
  Library,
} from 'lucide-react';
import { SubtitleCue, SupportedLanguage } from '../types/subtitle';
import { parseSrtFile, detectSrtLanguage } from '../utils/srtParser';
import { formatSecondsToSrt, formatTimeDisplay } from '../utils/timeFormat';

interface MusicLibraryItem {
  folder: string;
  audioFiles: string[];
  srtFiles: string[];
  txtFiles: string[];
}

interface OpenSrtMp3ModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAudioFile: File | null;
  currentAudioName: string;
  currentAudioDuration: number;
  onLoadSrtAndMp3: (params: {
    audioFile: File | null;
    cues: SubtitleCue[];
    srtFileName: string;
    language: SupportedLanguage;
    runDoubleCheck: boolean;
  }) => Promise<void> | void;
}

export const OpenSrtMp3Modal: React.FC<OpenSrtMp3ModalProps> = ({
  isOpen,
  onClose,
  currentAudioFile,
  currentAudioName,
  currentAudioDuration,
  onLoadSrtAndMp3,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'library'>('files');

  // File selection state
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [selectedSrtFileName, setSelectedSrtFileName] = useState<string>('');
  const [parsedCues, setParsedCues] = useState<SubtitleCue[]>([]);
  const [detectedLanguage, setDetectedLanguage] = useState<SupportedLanguage>('nl');
  const [runDoubleCheck, setRunDoubleCheck] = useState<boolean>(false);
  const [isDraggingBoth, setIsDraggingBoth] = useState<boolean>(false);
  const [isLoadingSubmit, setIsLoadingSubmit] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // @music Library state
  const [libraryAvailable, setLibraryAvailable] = useState<boolean>(false);
  const [libraryRootPath, setLibraryRootPath] = useState<string>('');
  const [libraryItems, setLibraryItems] = useState<MusicLibraryItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(false);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [loadingLibraryKey, setLoadingLibraryKey] = useState<string | null>(null);

  const combinedInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill current audio file if already loaded in studio
  useEffect(() => {
    if (isOpen) {
      if (!selectedAudioFile && currentAudioFile) {
        setSelectedAudioFile(currentAudioFile);
      }
      fetchMusicLibrary();
    }
  }, [isOpen, currentAudioFile]);

  const fetchMusicLibrary = async () => {
    setIsLoadingLibrary(true);
    try {
      const res = await fetch('/api/music-library');
      if (res.ok) {
        const data = await res.json();
        setLibraryAvailable(Boolean(data.available));
        setLibraryRootPath(data.rootPath || '');
        setLibraryItems(Array.isArray(data.items) ? data.items : []);
      }
    } catch (_) {
      setLibraryAvailable(false);
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const processSrtFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      const cues = parseSrtFile(content);
      if (cues.length > 0) {
        const lang = detectSrtLanguage(file.name, cues);
        setParsedCues(cues);
        setSelectedSrtFileName(file.name);
        setDetectedLanguage(lang);
        setStatusMessage({
          type: 'success',
          text: `Ondertitelbestand "${file.name}" geladen (${cues.length} blokken, ${lang === 'nl' ? 'Nederlands' : 'Engels'}).`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: `Kon geen geldige tijdcodes vinden in "${file.name}". Controleer of het een geldig .srt of .vtt bestand is.`,
        });
      }
    };
    reader.readAsText(file);
  };

  const processMultipleFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    let foundAudio: File | null = null;
    let foundSrt: File | null = null;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.srt') || lower.endsWith('.vtt')) {
        foundSrt = file;
      } else if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(lower)) {
        foundAudio = file;
      }
    }

    if (foundAudio) {
      setSelectedAudioFile(foundAudio);
    }
    if (foundSrt) {
      processSrtFile(foundSrt);
    }

    if (foundAudio && foundSrt) {
      setStatusMessage({
        type: 'success',
        text: `Beide bestanden klaargezet: "${foundAudio.name}" + "${foundSrt.name}"!`,
      });
    } else if (foundAudio && !foundSrt) {
      setStatusMessage({
        type: 'info',
        text: `Audio "${foundAudio.name}" geselecteerd. Kies nu nog het bijbehorende .SRT bestand.`,
      });
    }
  };

  const handleOpenFromLibrary = async (item: MusicLibraryItem, srtFile: string) => {
    const audioFileName = item.audioFiles[0];
    if (!audioFileName) {
      setStatusMessage({
        type: 'error',
        text: `Geen audiobestand (.mp3) gevonden in map "${item.folder}".`,
      });
      return;
    }

    const key = `${item.folder}::${srtFile}`;
    setLoadingLibraryKey(key);
    setStatusMessage({
      type: 'info',
      text: `Bezig met inladen van "${audioFileName}" en "${srtFile}"...`,
    });

    try {
      const [audioRes, srtRes] = await Promise.all([
        fetch(`/api/music-library/file?folder=${encodeURIComponent(item.folder)}&file=${encodeURIComponent(audioFileName)}`),
        fetch(`/api/music-library/file?folder=${encodeURIComponent(item.folder)}&file=${encodeURIComponent(srtFile)}`),
      ]);

      if (!audioRes.ok || !srtRes.ok) {
        throw new Error('Kon audio- of ondertitelbestand niet ophalen uit @music map.');
      }

      const [audioBlob, srtText] = await Promise.all([audioRes.blob(), srtRes.text()]);
      const cues = parseSrtFile(srtText);
      if (cues.length === 0) {
        throw new Error(`Geen geldige ondertitelblokken gevonden in ${srtFile}.`);
      }

      const audioFile = new File([audioBlob], audioFileName, {
        type: audioBlob.type || 'audio/mpeg',
      });
      const lang = detectSrtLanguage(srtFile, cues);

      await onLoadSrtAndMp3({
        audioFile,
        cues,
        srtFileName: srtFile,
        language: lang,
        runDoubleCheck,
      });
      onClose();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Fout bij openen uit @music bibliotheek.',
      });
    } finally {
      setLoadingLibraryKey(null);
    }
  };

  const handleConfirmOpen = async () => {
    const effectiveAudio = selectedAudioFile || currentAudioFile;
    if (!effectiveAudio && !currentAudioName) {
      setStatusMessage({
        type: 'error',
        text: 'Selecteer een bijbehorend .MP3 / audiobestand.',
      });
      return;
    }
    if (parsedCues.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'Selecteer een .SRT of .VTT ondertitelbestand.',
      });
      return;
    }

    setIsLoadingSubmit(true);
    try {
      await onLoadSrtAndMp3({
        audioFile: effectiveAudio,
        cues: parsedCues,
        srtFileName: selectedSrtFileName,
        language: detectedLanguage,
        runDoubleCheck,
      });
      onClose();
    } finally {
      setIsLoadingSubmit(false);
    }
  };

  const filteredLibraryItems = useMemo(() => {
    const withSrt = libraryItems.filter((item) => item.srtFiles.length > 0 && item.audioFiles.length > 0);
    if (!librarySearch.trim()) return withSrt;
    const q = librarySearch.toLowerCase().trim();
    return withSrt.filter(
      (item) =>
        item.folder.toLowerCase().includes(q) ||
        item.audioFiles.some((a) => a.toLowerCase().includes(q)) ||
        item.srtFiles.some((s) => s.toLowerCase().includes(q))
    );
  }, [libraryItems, librarySearch]);

  if (!isOpen) return null;

  const effectiveAudioName = selectedAudioFile?.name || currentAudioName || '';
  const canConfirm = Boolean(effectiveAudioName && parsedCues.length > 0 && !isLoadingSubmit);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                Open bestaande .SRT met bijbehorende .MP3
              </h2>
              <p className="text-xs text-slate-400">
                Laad een bestaand ondertitelbestand (.srt / .vtt) samen met de MP3 direct in de Subtitle Edit Studio om te bekijken, corrigeren of exporteren.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-6 pt-3 bg-slate-950/50 border-b border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'files'
                ? 'border-amber-400 text-amber-300 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Bestanden Kiezen / Slepen (.SRT + .MP3)</span>
          </button>

          {libraryAvailable && (
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'library'
                  ? 'border-amber-400 text-amber-300 bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Library className="w-3.5 h-3.5" />
              <span>Uit @music Bibliotheek ({libraryItems.filter((i) => i.srtFiles.length > 0).length} nummers met .SRT)</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : statusMessage.type === 'error'
                  ? 'bg-red-950/60 border-red-500/40 text-red-200'
                  : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {activeTab === 'files' ? (
            <>
              {/* Combined Multi-File Dropzone */}
              <input
                ref={combinedInputRef}
                type="file"
                multiple
                accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.srt,.vtt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    processMultipleFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingBoth(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDraggingBoth(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingBoth(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    processMultipleFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => combinedInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDraggingBoth
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-amber-500/40 hover:border-amber-400 bg-slate-950/70'
                }`}
              >
                <div className="w-11 h-11 rounded-full bg-amber-500/20 text-amber-300 mx-auto flex items-center justify-center mb-2">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <p className="text-sm font-bold text-white">
                  Klik hier om .MP3 én .SRT tegelijk te selecteren (of sleep ze samen hierheen)
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Tip: Houd in Windows Verkenner <strong className="text-slate-200">Ctrl</strong> ingedrukt om in één keer zowel het <code className="text-amber-300">.mp3</code> als het <code className="text-amber-300">.srt</code> bestand aan te klikken!
                </p>
              </div>

              {/* Individual Pickers (Step 1: MP3, Step 2: SRT) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. MP3 Picker */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Music className="w-4 h-4 text-indigo-400" />
                      1. Bijbehorende Audio (.MP3 / .WAV)
                    </span>
                    {effectiveAudioName && (
                      <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Klaar
                      </span>
                    )}
                  </div>

                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setSelectedAudioFile(f);
                        setStatusMessage({
                          type: 'info',
                          text: `Audiobestand "${f.name}" geselecteerd.`,
                        });
                      }
                      e.target.value = '';
                    }}
                  />

                  {effectiveAudioName ? (
                    <div className="bg-slate-900 border border-indigo-500/30 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{effectiveAudioName}</p>
                        <p className="text-[11px] text-slate-400">
                          {selectedAudioFile
                            ? `${(selectedAudioFile.size / (1024 * 1024)).toFixed(1)} MB`
                            : currentAudioDuration > 0
                            ? `Huidige geladen audio (${formatTimeDisplay(currentAudioDuration, false)})`
                            : 'Geladen in studio'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => audioInputRef.current?.click()}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-medium shrink-0 cursor-pointer"
                      >
                        Wijzig .MP3
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => audioInputRef.current?.click()}
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-indigo-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Kies .MP3 audiobestand...</span>
                    </button>
                  )}
                </div>

                {/* 2. SRT Picker */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      2. Ondertitelbestand (.SRT / .VTT)
                    </span>
                    {parsedCues.length > 0 && (
                      <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> {parsedCues.length} blokken
                      </span>
                    )}
                  </div>

                  <input
                    ref={srtInputRef}
                    type="file"
                    accept=".srt,.vtt,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) processSrtFile(f);
                      e.target.value = '';
                    }}
                  />

                  {selectedSrtFileName && parsedCues.length > 0 ? (
                    <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{selectedSrtFileName}</p>
                        <p className="text-[11px] text-emerald-300">
                          {parsedCues.length} regels &bull;{' '}
                          {formatSecondsToSrt(parsedCues[0].startTime)} &rarr;{' '}
                          {formatSecondsToSrt(parsedCues[parsedCues.length - 1].endTime)} &bull;{' '}
                          {detectedLanguage === 'nl' ? 'NL' : 'EN'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => srtInputRef.current?.click()}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs font-medium shrink-0 cursor-pointer"
                      >
                        Wijzig .SRT
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => srtInputRef.current?.click()}
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-emerald-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Kies .SRT ondertitelbestand...</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Preview of parsed SRT cues */}
              {parsedCues.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Voorbeeld van geladen .SRT blokken ({parsedCues.length} regels):
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Taal:</span>
                      <button
                        type="button"
                        onClick={() => setDetectedLanguage('nl')}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          detectedLanguage === 'nl'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        NL
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetectedLanguage('en')}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          detectedLanguage === 'en'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        EN
                      </button>
                    </div>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
                    {parsedCues.slice(0, 8).map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 px-2.5 py-1 rounded bg-slate-900/80 text-slate-300"
                      >
                        <span className="text-slate-500 w-6">#{c.id}</span>
                        <span className="text-amber-300 shrink-0">
                          {formatSecondsToSrt(c.startTime)} &rarr; {formatSecondsToSrt(c.endTime)}
                        </span>
                        <span className="font-sans text-white truncate">{c.text}</span>
                      </div>
                    ))}
                    {parsedCues.length > 8 && (
                      <p className="text-[11px] text-slate-500 pl-2 pt-1 font-sans">
                        + nog {parsedCues.length - 8} volgende regels...
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Tab 2: Local @music Library Browser */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Zoek op nummer of titel (bijv. 115, Cinnamon, Leeuw)..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                <span className="text-[11px] text-slate-400 font-mono truncate">
                  Map: {libraryRootPath}
                </span>
              </div>

              {isLoadingLibrary ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span>@music bibliotheek laden...</span>
                </div>
              ) : filteredLibraryItems.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400 bg-slate-950 rounded-xl border border-slate-800">
                  Geen nummers met zowel .mp3 als .srt gevonden voor "{librarySearch}".
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                  {filteredLibraryItems.map((item) => (
                    <div
                      key={item.folder}
                      className="bg-slate-950 border border-slate-800/90 hover:border-slate-700 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{item.folder}</p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          🎵 {item.audioFiles[0]} &bull; {item.srtFiles.length} ondertitelbestand(en)
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                        {item.srtFiles.map((srt) => {
                          const key = `${item.folder}::${srt}`;
                          const isThisLoading = loadingLibraryKey === key;
                          const isNL = srt.toLowerCase().includes('_nl');
                          const isEN = srt.toLowerCase().includes('_en');
                          return (
                            <button
                              key={srt}
                              type="button"
                              disabled={Boolean(loadingLibraryKey)}
                              onClick={() => handleOpenFromLibrary(item, srt)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer ${
                                isNL
                                  ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 border border-amber-500/40'
                                  : isEN
                                  ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/40'
                                  : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/40'
                              }`}
                              title={`Open ${item.audioFiles[0]} samen met ${srt} in de Subtitle Edit Studio`}
                            >
                              {isThisLoading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                              <span>Open {srt}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Optional Auto Double-Check Toggle */}
          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/30 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={runDoubleCheck}
              onChange={(e) => setRunDoubleCheck(e.target.checked)}
              className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
            />
            <div className="text-xs">
              <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Voer direct na openen de 🔍 Dubbele Controle uit op de zang-waveform
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Laat uitgevinkt om eerst de exacte ongewijzigde tijden uit het .SRT bestand te zien. Vink aan als het .SRT bestand blokken heeft die te vroeg beginnen of te vroeg stoppen en je ze direct wilt laten rechtzetten.
              </p>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Sluiten
          </button>

          {activeTab === 'files' && (
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirmOpen}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                canConfirm
                  ? 'bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 shadow-lg shadow-amber-900/30 active:scale-95 cursor-pointer'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {isLoadingSubmit ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderOpen className="w-4 h-4" />
              )}
              <span>Open .SRT + .MP3 in Subtitle Edit Studio</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
