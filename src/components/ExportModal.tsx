import React, { useState, useMemo, useEffect } from 'react';
import { Download, Copy, Check, X, FileText, Code2, RotateCcw, Video, Clock } from 'lucide-react';
import { SubtitleCue, SupportedLanguage } from '../types/subtitle';
import { generateSrt, generateVtt, downloadSubtitleFile, getSubtitleFilename } from '../utils/exportSubtitles';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cues: SubtitleCue[];
  songTitle: string;
  language?: SupportedLanguage | null;
  onStartNewSong: () => void;
  onOpenMp4Converter?: () => void;
  onOpenTimestampTransfer?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  cues,
  songTitle,
  language,
  onStartNewSong,
  onOpenMp4Converter,
  onOpenTimestampTransfer,
}) => {
  const [format, setFormat] = useState<'srt' | 'vtt'>('srt');
  const [copied, setCopied] = useState(false);
  const [hasDownloaded, setHasDownloaded] = useState(false);

  // Reset download state whenever modal opens or cues change
  useEffect(() => {
    if (isOpen) {
      setHasDownloaded(false);
    }
  }, [isOpen, cues]);

  const cleanTitle = songTitle.replace(/\.[^/.]+$/, '').trim() || 'subtitles';
  const targetFilename = useMemo(() => {
    return getSubtitleFilename(cleanTitle, format, language);
  }, [cleanTitle, format, language]);

  const srtContent = useMemo(() => generateSrt(cues), [cues]);
  const vttContent = useMemo(() => generateVtt(cues, cleanTitle), [cues, cleanTitle]);

  const activeContent = format === 'srt' ? srtContent : vttContent;

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  const handleDownload = () => {
    downloadSubtitleFile(cleanTitle, activeContent, format, language);
    setHasDownloaded(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                Export Subtitle File
              </h3>
              <p className="text-xs text-slate-400">
                Choose format and download or copy your synchronized cues
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selector Tabs */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setFormat('srt')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                format === 'srt'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>SubRip (.SRT)</span>
            </button>
            <button
              onClick={() => setFormat('vtt')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                format === 'vtt'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>WebVTT (.VTT)</span>
            </button>
          </div>

          {/* Language tag indication */}
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span>Taalcode:</span>
              <span className="font-mono text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800/40 font-semibold">
                {language === 'nl' ? '_NL (Nederlands)' : language === 'en' ? '_EN (English)' : 'Geen'}
              </span>
            </div>

            {onOpenTimestampTransfer && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTimestampTransfer();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-200 hover:text-white bg-emerald-950/70 hover:bg-emerald-900/90 border border-emerald-500/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Kopieer deze getimede cues naar een Nederlandse of andere taal .srt"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tijden overnemen naar taal</span>
              </button>
            )}

            {onOpenMp4Converter && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenMp4Converter();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-200 hover:text-white bg-purple-950/70 hover:bg-purple-900/90 border border-purple-500/40 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Zet MP3 en cover JPG om naar een downloadbare MP4 video"
              >
                <Video className="w-3.5 h-3.5 text-purple-400" />
                <span>MP3 naar MP4 Video</span>
              </button>
            )}
          </div>
        </div>

        {/* Raw Preview Box */}
        <div className="mt-4 flex-1 min-h-[200px] max-h-[300px] bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-y-auto relative font-mono text-xs text-slate-300">
          <div className="absolute top-3 right-3 text-[10px] text-slate-500 flex items-center gap-1 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
            <Code2 className="w-3 h-3" />
            <span>{cues.length} Cues</span>
          </div>
          <pre className="whitespace-pre font-mono leading-relaxed select-all">
            {activeContent}
          </pre>
        </div>

        {/* Post-Download Action Banner */}
        {hasDownloaded && (
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-emerald-950/90 via-slate-900 to-indigo-950/90 border border-emerald-500/50 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                  <span>Bestand succesvol gedownload!</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                    {targetFilename}
                  </span>
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Je vertaling en ondertitels zijn opgeslagen. Wil je helemaal opnieuw beginnen met een nieuw lied?
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartNewSong();
                }}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-700/30 flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Helemaal opnieuw beginnen</span>
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-500 font-mono">
            Bestandsnaam: <span className="text-white font-semibold">{targetFilename}</span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartNewSong();
              }}
              className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-700 active:scale-95"
              title="Wis alles en start met een nieuw lied"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>Nieuw lied</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 border border-slate-700 active:scale-95"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Content</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-transform active:scale-95 shadow-md shadow-indigo-600/30 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Download {targetFilename}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
