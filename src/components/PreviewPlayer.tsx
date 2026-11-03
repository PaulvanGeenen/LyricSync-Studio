import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  FastForward,
  Rewind,
  Maximize2,
  Minimize2,
  Type,
  Music,
  Pin,
  Sparkles,
  Scissors,
} from 'lucide-react';
import { SubtitleCue } from '../types/subtitle';
import { formatTimeDisplay } from '../utils/timeFormat';

interface PreviewPlayerProps {
  audioUrl: string | null;
  audioDuration: number;
  cues: SubtitleCue[];
  waveformPeaks: number[];
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onPlayPauseToggle: () => void;
  onSeek: (time: number) => void;
  selectedCueId: number | null;
  onSelectCue: (id: number) => void;
  onSnapCueToPlayhead?: (cueId: number, targetTime: number) => void;
  onRepairMidSongGaps?: () => void;
  onInsertInstrumentalBreak?: (fromCueId: number, seconds: number) => void;
  onCutVocalAtPlayhead?: (cueId: number, cutTime: number) => void;
}

export const PreviewPlayer: React.FC<PreviewPlayerProps> = ({
  audioUrl,
  audioDuration,
  cues,
  waveformPeaks,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onPlayPauseToggle,
  onSeek,
  selectedCueId,
  onSelectCue,
  onSnapCueToPlayhead,
  onRepairMidSongGaps,
  onInsertInstrumentalBreak,
  onCutVocalAtPlayhead,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xl'>('large');
  const [theme, setTheme] = useState<'dark' | 'stage' | 'minimal'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Sync internal audio element with external control
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    } else if (!isPlaying && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Find currently active cue based on currentTime
  const activeCue = useMemo(() => {
    // If multiple cues overlap, choose the most recently started cue to avoid older cues lingering
    const matching = cues.filter((c) => currentTime >= c.startTime && currentTime <= c.endTime);
    if (matching.length === 0) return null;
    return matching[matching.length - 1];
  }, [cues, currentTime]);

  // Find previous and next cues for contextual preview (works both inside cues AND during intermezzo gaps!)
  const activeCueIndex = useMemo(() => {
    if (!activeCue) return -1;
    return cues.findIndex((c) => c.id === activeCue.id);
  }, [cues, activeCue]);

  const prevCue = useMemo(() => {
    if (activeCueIndex > 0) return cues[activeCueIndex - 1];
    if (activeCueIndex === 0) return null;
    for (let i = cues.length - 1; i >= 0; i--) {
      if (cues[i].endTime < currentTime) {
        return cues[i];
      }
    }
    return null;
  }, [cues, activeCueIndex, currentTime]);

  const nextCue = useMemo(() => {
    if (activeCueIndex >= 0) {
      return activeCueIndex < cues.length - 1 ? cues[activeCueIndex + 1] : null;
    }
    return cues.find((c) => c.startTime > currentTime) || null;
  }, [cues, activeCueIndex, currentTime]);

  // Handle timeline seeking on click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || audioDuration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = percentage * audioDuration;
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
    onSeek(targetTime);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || audioDuration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const hoverX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, hoverX / rect.width));
    setHoverTime(percentage * audioDuration);
  };

  const handleTimelineMouseLeave = () => {
    setHoverTime(null);
  };

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      onTimeUpdate(audioRef.current.currentTime);
    }
  };

  const handleSkip = (seconds: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(audioDuration, audioRef.current.currentTime + seconds));
    audioRef.current.currentTime = newTime;
    onSeek(newTime);
  };

  const handleResetToStart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    onSeek(0);
  };

  const progressPercent = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
      {/* Hidden Native Audio Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={() => onPlayPauseToggle()}
        />
      )}

      {/* Top Header of Preview Player */}
      <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-950 text-indigo-400 flex items-center justify-center border border-indigo-800/40">
            <Music className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Subtitle Preview Player</h3>
            <p className="text-xs text-slate-400">
              Listen to synchronized playback with real-time subtitle overlay
            </p>
          </div>
        </div>

        {/* View & Style Options */}
        <div className="flex items-center gap-2">
          {/* Subtitle font size */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-500 px-1.5 flex items-center">
              <Type className="w-3.5 h-3.5" />
            </span>
            <button
              onClick={() => setFontSize('normal')}
              className={`px-2 py-0.5 rounded transition-colors ${
                fontSize === 'normal' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sm
            </button>
            <button
              onClick={() => setFontSize('large')}
              className={`px-2 py-0.5 rounded transition-colors ${
                fontSize === 'large' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Md
            </button>
            <button
              onClick={() => setFontSize('xl')}
              className={`px-2 py-0.5 rounded transition-colors ${
                fontSize === 'xl' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Lg
            </button>
          </div>

          {/* Theme switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setTheme('dark')}
              className={`px-2 py-0.5 rounded transition-colors ${
                theme === 'dark' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cinema
            </button>
            <button
              onClick={() => setTheme('stage')}
              className={`px-2 py-0.5 rounded transition-colors ${
                theme === 'stage' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stage
            </button>
          </div>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Player'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Screen / Video Subtitle Overlay Area */}
      <div
        className={`relative w-full flex flex-col items-center justify-center p-8 transition-all overflow-hidden ${
          isFullscreen ? 'fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between' : 'h-72 sm:h-80'
        } ${
          theme === 'dark'
            ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950'
            : theme === 'stage'
            ? 'bg-gradient-to-tr from-indigo-950 via-purple-950 to-slate-950'
            : 'bg-slate-950'
        }`}
      >
        {/* Subtle acoustic ambience ring when playing */}
        {isPlaying && (
          <div className="absolute w-96 h-96 rounded-full bg-indigo-500/5 blur-3xl animate-pulse pointer-events-none" />
        )}

        {/* Exit fullscreen button if in fullscreen */}
        {isFullscreen && (
          <div className="w-full flex justify-end p-4">
            <button
              onClick={() => setIsFullscreen(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-200 hover:bg-slate-700 rounded-lg text-xs font-medium"
            >
              Close Fullscreen
            </button>
          </div>
        )}

        {/* Dynamic Subtitle Content Container */}
        <div className="w-full max-w-3xl text-center space-y-4 px-4 z-10 my-auto">
          {/* Previous Subtitle Line (Faded) */}
          {prevCue && (
            <p className="text-xs sm:text-sm text-slate-500/70 font-medium transition-opacity duration-300">
              {prevCue.text}
            </p>
          )}

          {/* Active Subtitle Line (Prominent) */}
          {activeCue ? (
            <div className="space-y-2 py-2">
              <h2
                className={`font-bold tracking-tight text-white drop-shadow-md transition-all duration-150 ${
                  fontSize === 'normal'
                    ? 'text-lg sm:text-xl'
                    : fontSize === 'large'
                    ? 'text-2xl sm:text-3xl'
                    : 'text-3xl sm:text-4xl'
                }`}
              >
                <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-200 bg-clip-text text-transparent">
                  {activeCue.text}
                </span>
              </h2>

              {activeCue.originalText && (
                <p className="text-xs sm:text-sm text-slate-400/90 italic">
                  Origineel: &ldquo;{activeCue.originalText}&rdquo;
                </p>
              )}

              <div className="inline-flex items-center gap-2 text-xs font-mono text-indigo-400 tabular-nums bg-indigo-950/40 px-3 py-1 rounded-full border border-indigo-800/40">
                <span>Cue #{activeCue.id}</span>
                <span>·</span>
                <span>
                  {formatTimeDisplay(activeCue.startTime)} → {formatTimeDisplay(activeCue.endTime)}
                </span>
              </div>

              {/* Direct In-Player Action Controls for active cue */}
              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                {onSnapCueToPlayhead && (
                  <button
                    type="button"
                    onClick={() => onSnapCueToPlayhead(activeCue.id, currentTime)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md border border-emerald-400/40 flex items-center gap-1.5 transition-all cursor-pointer"
                    title={`Start Regel #${activeCue.id} exact op het witte lijntje (${formatTimeDisplay(currentTime)}) en schuif alle volgende regels mee`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                    <span>Zet Regel #{activeCue.id} op witte lijn ({formatTimeDisplay(currentTime)})</span>
                  </button>
                )}

                {onCutVocalAtPlayhead && (
                  <button
                    type="button"
                    onClick={() => onCutVocalAtPlayhead(activeCue.id, currentTime)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 hover:text-white font-semibold text-xs rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                    title={`Zang stopt hier voor een pauze/solo: beëindig deze regel op ${formatTimeDisplay(currentTime)} zodat het scherm leeg blijft tijdens de solo`}
                  >
                    <Scissors className="w-3.5 h-3.5 text-amber-400" />
                    <span>Zang stopt hier (kap af op {formatTimeDisplay(currentTime)})</span>
                  </button>
                )}

                {onInsertInstrumentalBreak && (
                  <button
                    type="button"
                    onClick={() => onInsertInstrumentalBreak(activeCue.id, 15)}
                    className="px-3 py-1.5 bg-purple-950 hover:bg-purple-900 active:scale-95 text-purple-200 hover:text-white font-semibold text-xs rounded-xl border border-purple-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
                    title={`Is er nu een instrumentale solo of break? Schuif Regel #${activeCue.id} én alle volgende regels +15 seconden door zodat hier geen tekst staat tijdens de solo`}
                  >
                    <Music className="w-3.5 h-3.5 text-purple-400" />
                    <span>🎸 Solo/Break hier: schuif +15s door</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-4 space-y-3 text-center">
              {currentTime > 0 ? (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-amber-400 font-mono">
                    <span>♪ Intermezzo / Solo Break ({formatTimeDisplay(currentTime)}) ♪</span>
                  </div>
                  {nextCue ? (
                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <p className="text-xs text-slate-400 font-medium">
                          Volgende regel (#{nextCue.id}) staat nu op <span className="text-amber-300 font-mono font-semibold">{formatTimeDisplay(nextCue.startTime)}</span> (over {Math.max(0, Math.round((nextCue.startTime - currentTime) * 10) / 10)}s):
                        </p>
                        <p className="text-base sm:text-lg font-semibold text-slate-100">
                          &ldquo;{nextCue.text}&rdquo;
                        </p>
                      </div>
                      <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
                        {onSnapCueToPlayhead && (
                          <button
                            type="button"
                            onClick={() => onSnapCueToPlayhead(nextCue.id, currentTime)}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/60 border border-emerald-400/40 flex items-center gap-2 transition-all cursor-pointer"
                            title="Trek deze regel én alle daaropvolgende regels naar het witte lijntje waar de zang nu begint"
                          >
                            <Pin className="w-3.5 h-3.5" />
                            <span>
                              Hier begint de zang weer: Zet Regel #{nextCue.id} op witte lijn ({formatTimeDisplay(currentTime)})
                            </span>
                          </button>
                        )}

                        {onInsertInstrumentalBreak && (
                          <button
                            type="button"
                            onClick={() => onInsertInstrumentalBreak(nextCue.id, 15)}
                            className="px-3.5 py-2 bg-purple-950 hover:bg-purple-900 active:scale-95 text-purple-200 hover:text-white font-semibold text-xs rounded-xl border border-purple-500/40 flex items-center gap-2 transition-all cursor-pointer"
                            title="Instrumentale solo duurt nog langer: schuif Regel #{nextCue.id} én alle volgende regels nog eens +15s op"
                          >
                            <Music className="w-3.5 h-3.5 text-purple-400" />
                            <span>🎸 Verleng solo/break (+15s)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {isPlaying ? 'Muzikaal outro / einde van songtekst' : 'Einde van de tekst bereikt'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm sm:text-base font-medium text-slate-500 italic">
                    {isPlaying ? '♪ Muzikaal intro ♪' : 'Klaar om af te spelen'}
                  </p>
                  <p className="text-xs text-slate-600">
                    {isPlaying ? 'Eerste regel verschijnt zodra de zang begint' : 'Druk op Play om de gesynchroniseerde tekst te bekijken'}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Next Subtitle Line (Faded) - only show when activeCue is present to avoid duplicate display */}
          {activeCue && nextCue && (
            <p className="text-xs sm:text-sm text-slate-500/70 font-medium transition-opacity duration-300">
              {nextCue.text}
            </p>
          )}
        </div>
      </div>

      {/* Interactive Waveform & Timeline Scrub Bar */}
      <div className="p-4 sm:p-6 bg-slate-950 border-t border-slate-800 space-y-3">
        {/* Waveform Canvas / Bar Visualization */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          onMouseMove={handleTimelineMouseMove}
          onMouseLeave={handleTimelineMouseLeave}
          className="relative h-16 w-full bg-slate-900/90 rounded-lg cursor-pointer overflow-hidden border border-slate-800 flex items-center"
        >
          {/* Waveform Bars */}
          <div className="absolute inset-0 flex items-center justify-between px-1 gap-[2px]">
            {waveformPeaks.map((peak, idx) => {
              const barPercent = (idx / waveformPeaks.length) * 100;
              const isPast = barPercent <= progressPercent;
              const heightPercent = Math.max(15, peak * 100);

              return (
                <div
                  key={idx}
                  className={`w-full rounded-full transition-colors duration-75 ${
                    isPast ? 'bg-indigo-500' : 'bg-slate-700/80 hover:bg-slate-600'
                  }`}
                  style={{ height: `${heightPercent}%` }}
                />
              );
            })}
          </div>

          {/* Cue Region Indicators on Waveform */}
          {cues.map((cue) => {
            if (audioDuration <= 0) return null;
            const left = (cue.startTime / audioDuration) * 100;
            const width = Math.max(1, ((cue.endTime - cue.startTime) / audioDuration) * 100);
            const isSelected = selectedCueId === cue.id;
            const isActive = activeCue?.id === cue.id;

            return (
              <div
                key={cue.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCue(cue.id);
                  if (audioRef.current) {
                    audioRef.current.currentTime = cue.startTime;
                  }
                  onSeek(cue.startTime);
                }}
                className={`absolute top-0 bottom-0 pointer-events-auto cursor-pointer border-t-2 transition-all ${
                  isActive
                    ? 'border-indigo-400 bg-indigo-500/25'
                    : isSelected
                    ? 'border-amber-400 bg-amber-500/20'
                    : 'border-slate-500/40 bg-slate-400/5 hover:bg-slate-400/15'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`Cue #${cue.id}: ${cue.text} (${formatTimeDisplay(cue.startTime)} - ${formatTimeDisplay(cue.endTime)})`}
              />
            );
          })}

          {/* Playhead Marker */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-white shadow-lg pointer-events-none z-20"
            style={{ left: `${progressPercent}%` }}
          >
            <div className="w-3 h-3 bg-white rounded-full -ml-[5px] -top-1 absolute shadow-md" />
          </div>

          {/* Hover Time Tooltip */}
          {hoverTime !== null && (
            <div
              className="absolute bottom-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 pointer-events-none tabular-nums z-30"
              style={{
                left: `${(hoverTime / audioDuration) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {formatTimeDisplay(hoverTime)}
            </div>
          )}
        </div>

        {/* White Playhead Line Quick-Snap & Mid-Song Break Controls */}
        {cues.length > 0 && (
          (() => {
            const targetCue = activeCue || nextCue || (selectedCueId ? cues.find((c) => c.id === selectedCueId) : null) || cues[0];
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-white shadow-sm shrink-0" />
                  <span>
                    Witte lijn staat op <strong className="font-mono text-white">{formatTimeDisplay(currentTime)}</strong>
                    {activeCue ? (
                      <span className="text-slate-400 ml-1.5">
                        · Nu actief: <strong className="text-indigo-300">Regel #{activeCue.id}</strong> (&ldquo;{activeCue.text.slice(0, 30)}{activeCue.text.length > 30 ? '…' : ''}&rdquo;)
                      </span>
                    ) : nextCue ? (
                      <span className="text-slate-400 ml-1.5">
                        · Eerstvolgende zang: <strong className="text-indigo-300">Regel #{nextCue.id}</strong> (&ldquo;{nextCue.text.slice(0, 30)}{nextCue.text.length > 30 ? '…' : ''}&rdquo; op {formatTimeDisplay(nextCue.startTime)})
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onSnapCueToPlayhead && targetCue && (
                    <button
                      type="button"
                      onClick={() => onSnapCueToPlayhead(targetCue.id, currentTime)}
                      className="px-2.5 py-1 bg-emerald-600/90 hover:bg-emerald-500 text-white font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm active:scale-95"
                      title={`Zet Regel #${targetCue.id} én alle daaropvolgende regels op de positie van het witte lijntje (${formatTimeDisplay(currentTime)})`}
                    >
                      <Pin className="w-3 h-3" />
                      <span>
                        Trek Regel #{targetCue.id} naar witte lijn ({formatTimeDisplay(currentTime)})
                      </span>
                    </button>
                  )}

                  {onInsertInstrumentalBreak && targetCue && (
                    <button
                      type="button"
                      onClick={() => onInsertInstrumentalBreak(targetCue.id, 15)}
                      className="px-2.5 py-1 bg-purple-950 hover:bg-purple-900 text-purple-200 hover:text-white border border-purple-500/40 font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm active:scale-95"
                      title={`Schuif Regel #${targetCue.id} én alle volgende regels +15 seconden op voor een solo/instrumentaal stuk`}
                    >
                      <Music className="w-3 h-3 text-purple-400" />
                      <span>🎸 +15s Solo Break</span>
                    </button>
                  )}

                  {activeCue && onCutVocalAtPlayhead && (
                    <button
                      type="button"
                      onClick={() => onCutVocalAtPlayhead(activeCue.id, currentTime)}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md flex items-center gap-1 transition-colors cursor-pointer text-xs"
                      title={`Kap actieve Regel #${activeCue.id} af op de witte lijn`}
                    >
                      <Scissors className="w-3 h-3 text-amber-400" />
                      <span>Kap af</span>
                    </button>
                  )}

                  {onRepairMidSongGaps && (
                    <button
                      type="button"
                      onClick={onRepairMidSongGaps}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md flex items-center gap-1 transition-colors cursor-pointer text-xs"
                      title="Herstel onbedoelde gaten in het midden"
                    >
                      <Sparkles className="w-3 h-3 text-slate-400" />
                      <span>Gat herstellen</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()
        )}

        {/* Audio Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          {/* Left: Playback Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetToStart}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Jump to Start"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleSkip(-5)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Rewind 5s"
            >
              <Rewind className="w-4 h-4" />
            </button>

            <button
              onClick={onPlayPauseToggle}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-md shadow-indigo-600/30 transition-transform active:scale-95"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button
              onClick={() => handleSkip(5)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Forward 5s"
            >
              <FastForward className="w-4 h-4" />
            </button>

            {/* Time Stamp Display */}
            <div className="text-xs font-mono tabular-nums text-slate-300 ml-2">
              <span className="font-semibold text-white">{formatTimeDisplay(currentTime)}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-slate-400">{formatTimeDisplay(audioDuration, false)}</span>
            </div>
          </div>

          {/* Right: Speed & Volume */}
          <div className="flex items-center gap-4">
            {/* Playback Speed selector */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg text-xs">
              {[0.75, 1, 1.25, 1.5].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={`px-2 py-0.5 rounded transition-colors font-mono tabular-nums ${
                    playbackRate === rate
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-400 hover:text-slate-200"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  if (isMuted) setIsMuted(false);
                }}
                className="w-20 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
