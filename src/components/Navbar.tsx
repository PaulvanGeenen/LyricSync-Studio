import React from 'react';
import { Music2, Download, Sparkles, RotateCcw, Video, Clock } from 'lucide-react';

interface NavbarProps {
  onExportClick: () => void;
  canExport: boolean;
  onOpenDemo: (lang: 'en' | 'nl') => void;
  activeSection: 'studio' | 'subtitle-edit' | 'editor';
  onNavigate: (section: 'studio' | 'subtitle-edit' | 'editor') => void;
  onStartNewSong: () => void;
  hasActiveProject: boolean;
  onOpenMp4Converter: () => void;
  onOpenTimestampTransfer: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onExportClick,
  canExport,
  onOpenDemo,
  activeSection,
  onNavigate,
  onStartNewSong,
  hasActiveProject,
  onOpenMp4Converter,
  onOpenTimestampTransfer,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
            <Music2 className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
            LyricSync Studio
          </span>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            onClick={() => onNavigate('studio')}
            className={`transition-colors whitespace-nowrap ${
              activeSection === 'studio' ? 'text-indigo-400 font-semibold' : 'hover:text-white'
            }`}
          >
            Audio &amp; Lyrics
          </button>
          <button
            onClick={() => onNavigate('subtitle-edit')}
            className={`transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'subtitle-edit' ? 'text-indigo-400 font-semibold' : 'hover:text-white'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span>Subtitle Edit Studio</span>
          </button>
          <button
            onClick={() => onNavigate('editor')}
            className={`transition-colors whitespace-nowrap text-xs text-slate-400 ${
              activeSection === 'editor' ? 'text-indigo-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            Tabel Editor
          </button>
          <button
            onClick={() => onOpenDemo('nl')}
            className="text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap text-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Dutch Demo
          </button>
          <button
            onClick={() => onOpenDemo('en')}
            className="text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap text-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            English Demo
          </button>
        </nav>

        {/* Zone 3: Primary Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {hasActiveProject && (
            <button
              onClick={onStartNewSong}
              className="px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 active:scale-95 whitespace-nowrap cursor-pointer"
              title="Helemaal opnieuw beginnen met een nieuw lied"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Nieuw lied</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenTimestampTransfer}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all text-emerald-200 hover:text-white bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/40 shadow-sm active:scale-95 whitespace-nowrap cursor-pointer"
            title="Kopieer Engelse tijden naar Nederlandse of andere taal .srt met automatische zinscontrole"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tijden Kopiëren (.SRT)</span>
          </button>

          <button
            type="button"
            onClick={onOpenMp4Converter}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all text-purple-200 hover:text-white bg-purple-950/60 hover:bg-purple-900/70 border border-purple-500/40 shadow-sm active:scale-95 whitespace-nowrap cursor-pointer"
            title="Zet een MP3 audiobestand en JPG cover om naar een downloadbare MP4 video"
          >
            <Video className="w-3.5 h-3.5 text-purple-400" />
            <span>MP3 naar MP4</span>
          </button>

          <button
            onClick={onExportClick}
            disabled={!canExport}
            className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition-all whitespace-nowrap ${
              canExport
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 active:scale-95 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export SRT / VTT</span>
          </button>
        </div>
      </div>
    </header>
  );
};
