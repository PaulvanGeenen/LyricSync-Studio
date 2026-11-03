import React, { useState } from 'react';
import {
  Play,
  Plus,
  Trash2,
  Clock,
  ArrowRight,
  Split,
  Combine,
  Wand2,
  Search,
  Pin,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  Music,
  Scissors,
} from 'lucide-react';
import { SubtitleCue, RephraseOption } from '../types/subtitle';
import { formatTimeDisplay, parseTimeToSeconds } from '../utils/timeFormat';

interface CueEditorProps {
  cues: SubtitleCue[];
  currentTime: number;
  selectedCueId: number | null;
  onSelectCue: (id: number) => void;
  onUpdateCue: (updatedCue: SubtitleCue) => void;
  onAddCue: (afterIndex: number) => void;
  onDeleteCue: (id: number) => void;
  onSplitCue: (id: number, splitTime: number) => void;
  onMergeWithNext: (id: number) => void;
  onJumpToTime: (time: number) => void;
  onGlobalShift: (offsetSeconds: number) => void;
  onAutoFixOverlaps: () => void;
  onOpenTimestampTransfer?: () => void;
  vocalStartTime?: number;
  onShiftToVocalStartTime?: (newStartTime: number) => void;
  onDistributeCuesEvenly?: () => void;
  onSnapCueToPlayhead?: (cueId: number, targetTime: number) => void;
  onRepairMidSongGaps?: () => void;
  onInsertInstrumentalBreak?: (fromCueId: number, seconds: number) => void;
  onCutVocalAtPlayhead?: (cueId: number, cutTime: number) => void;
}

export const CueEditor: React.FC<CueEditorProps> = ({
  cues,
  currentTime,
  selectedCueId,
  onSelectCue,
  onUpdateCue,
  onAddCue,
  onDeleteCue,
  onSplitCue,
  onMergeWithNext,
  onJumpToTime,
  onGlobalShift,
  onAutoFixOverlaps,
  onOpenTimestampTransfer,
  vocalStartTime = 0,
  onShiftToVocalStartTime,
  onDistributeCuesEvenly,
  onSnapCueToPlayhead,
  onRepairMidSongGaps,
  onInsertInstrumentalBreak,
  onCutVocalAtPlayhead,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTimeCueId, setEditingTimeCueId] = useState<{ id: number; field: 'start' | 'end' } | null>(null);
  const [tempTimeInput, setTempTimeInput] = useState('');
  const [rephraseCueId, setRephraseCueId] = useState<number | null>(null);
  const [targetVocalStartInput, setTargetVocalStartInput] = useState<string>(
    vocalStartTime > 0 ? String(vocalStartTime) : '23'
  );
  const [cueOptions, setCueOptions] = useState<{ [id: number]: RephraseOption[] }>({});
  const [loadingCueId, setLoadingCueId] = useState<number | null>(null);

  const handleRequestCueRephrase = async (cue: SubtitleCue) => {
    if (loadingCueId !== null) return;
    if (rephraseCueId === cue.id) {
      setRephraseCueId(null);
      return;
    }
    setLoadingCueId(cue.id);
    try {
      const res = await fetch('/api/rephrase-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalLine: cue.originalText || cue.text,
          currentTranslation: cue.text,
          sourceLanguage: 'nl',
          targetLanguage: 'nl',
          songContext: cues.map((c) => c.text).join('\n'),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.options && Array.isArray(data.options)) {
          setCueOptions((prev) => ({ ...prev, [cue.id]: data.options }));
          setRephraseCueId(cue.id);
        }
      }
    } catch (e) {
      console.error('Rephrase cue failed:', e);
    } finally {
      setLoadingCueId(null);
    }
  };

  // Nudge timestamp by seconds delta
  const handleNudge = (cue: SubtitleCue, field: 'start' | 'end', delta: number) => {
    let newStart = cue.startTime;
    let newEnd = cue.endTime;

    if (field === 'start') {
      newStart = Math.max(0, Math.round((cue.startTime + delta) * 100) / 100);
      if (newStart >= newEnd) newEnd = newStart + 0.5;
    } else {
      newEnd = Math.max(newStart + 0.1, Math.round((cue.endTime + delta) * 100) / 100);
    }

    onUpdateCue({
      ...cue,
      startTime: newStart,
      endTime: newEnd,
    });
  };

  // Pin current playhead to start or end time
  const handlePinPlayhead = (cue: SubtitleCue, field: 'start' | 'end') => {
    const playhead = Math.round(currentTime * 100) / 100;
    if (field === 'start') {
      const newEnd = Math.max(playhead + 0.5, cue.endTime);
      onUpdateCue({
        ...cue,
        startTime: playhead,
        endTime: newEnd,
      });
    } else {
      const newStart = Math.min(cue.startTime, Math.max(0, playhead - 0.5));
      onUpdateCue({
        ...cue,
        startTime: newStart,
        endTime: playhead,
      });
    }
  };

  const handleStartEditingTime = (cue: SubtitleCue, field: 'start' | 'end') => {
    setEditingTimeCueId({ id: cue.id, field });
    setTempTimeInput(formatTimeDisplay(field === 'start' ? cue.startTime : cue.endTime));
  };

  const handleSaveEditingTime = (cue: SubtitleCue) => {
    if (!editingTimeCueId) return;
    const parsed = parseTimeToSeconds(tempTimeInput);
    if (parsed !== null) {
      if (editingTimeCueId.field === 'start') {
        const newStart = parsed;
        const newEnd = Math.max(newStart + 0.2, cue.endTime);
        onUpdateCue({ ...cue, startTime: newStart, endTime: newEnd });
      } else {
        const newEnd = Math.max(cue.startTime + 0.1, parsed);
        onUpdateCue({ ...cue, endTime: newEnd });
      }
    }
    setEditingTimeCueId(null);
  };

  const filteredCues = cues.filter((c) =>
    c.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col space-y-4 p-6">
      {/* Header and Global Tools */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white tracking-tight">
              2. Manual Timestamp & Lyric Editor
            </h2>
            <span className="text-xs font-mono tabular-nums text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800/40">
              {cues.length} Cues
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fine-tune cue start and end times, adjust text, or pin current audio playhead to timestamps.
          </p>
        </div>

        {/* Global Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search lyric line..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 w-40 sm:w-48"
            />
          </div>

          {/* Global Shifts */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs gap-1">
            <span className="text-slate-500 text-[11px] px-1 font-mono">Shift all:</span>
            <button
              onClick={() => onGlobalShift(-1.0)}
              className="px-1.5 py-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 font-mono tabular-nums"
              title="Shift all cues 1.0s earlier"
            >
              -1s
            </button>
            <button
              onClick={() => onGlobalShift(-0.2)}
              className="px-1.5 py-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 font-mono tabular-nums"
              title="Shift all cues 0.2s earlier"
            >
              -0.2s
            </button>
            <button
              onClick={() => onGlobalShift(0.2)}
              className="px-1.5 py-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 font-mono tabular-nums"
              title="Shift all cues 0.2s later"
            >
              +0.2s
            </button>
            <button
              onClick={() => onGlobalShift(1.0)}
              className="px-1.5 py-0.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 font-mono tabular-nums"
              title="Shift all cues 1.0s later"
            >
              +1s
            </button>
          </div>

          {/* Insert Instrumental Break / Solo Pause */}
          {onInsertInstrumentalBreak && (
            <div className="flex items-center bg-purple-950/40 border border-purple-500/40 rounded-lg p-1 text-xs gap-1">
              <span className="text-purple-300 text-[11px] px-1 font-medium flex items-center gap-1">
                <Music className="w-3 h-3 text-purple-400" />
                <span>Solo/Break:</span>
              </span>
              <button
                type="button"
                onClick={() => onInsertInstrumentalBreak(selectedCueId || cues[0]?.id || 1, 10)}
                className="px-1.5 py-0.5 text-purple-200 hover:text-white rounded hover:bg-purple-900/60 font-mono"
                title="Schuif geselecteerde regel en alle vervolgregels +10s op voor een break"
              >
                +10s
              </button>
              <button
                type="button"
                onClick={() => onInsertInstrumentalBreak(selectedCueId || cues[0]?.id || 1, 15)}
                className="px-1.5 py-0.5 text-purple-200 hover:text-white rounded hover:bg-purple-900/60 font-mono font-bold"
                title="Schuif geselecteerde regel en alle vervolgregels +15s op voor een solo/break"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={() => onInsertInstrumentalBreak(selectedCueId || cues[0]?.id || 1, 20)}
                className="px-1.5 py-0.5 text-purple-200 hover:text-white rounded hover:bg-purple-900/60 font-mono"
                title="Schuif geselecteerde regel en alle vervolgregels +20s op voor een solo"
              >
                +20s
              </button>
            </div>
          )}

          {/* Auto Fix Overlaps */}
          <button
            onClick={onAutoFixOverlaps}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-700"
            title="Automatically resolve timing overlaps between consecutive cues"
          >
            <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
            Fix Overlaps
          </button>

          {/* Repair Mid-Song Gaps */}
          {onRepairMidSongGaps && (
            <button
              type="button"
              onClick={onRepairMidSongGaps}
              className="px-3 py-1.5 bg-amber-950/70 hover:bg-amber-900 text-amber-200 hover:text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border border-amber-500/40 cursor-pointer shadow-sm"
              title="Herstel direct onnatuurlijke gaten in het midden van het nummer (zoals 01:11 dat op 01:51 stond)"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Sluit gaten in midden</span>
            </button>
          )}

          {/* Distribute Evenly Across Song */}
          {onDistributeCuesEvenly && (
            <button
              type="button"
              onClick={onDistributeCuesEvenly}
              className="px-3 py-1.5 bg-indigo-950/70 hover:bg-indigo-900 text-indigo-200 hover:text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border border-indigo-500/40 cursor-pointer shadow-sm"
              title="Spreid alle tekstregels evenredig over het hele nummer uit vanaf het startpunt tot het einde. Dit vult direct het midden van het nummer!"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Verdeel over nummer</span>
            </button>
          )}

          {onOpenTimestampTransfer && (
            <button
              type="button"
              onClick={onOpenTimestampTransfer}
              className="px-3 py-1.5 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-200 hover:text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 border border-emerald-500/40 cursor-pointer shadow-sm"
              title="Kopieer de tijden van deze cues naar een Nederlandse (of andere taal) .srt met controle op het aantal zinnen"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tijden kopiëren naar taal</span>
            </button>
          )}
        </div>
      </div>

      {/* Vocal Start Lead-in Adjustment & Proportional Shift Banner */}
      {cues.length > 0 && (
        <div className="bg-gradient-to-r from-amber-950/50 via-slate-900 to-amber-950/20 border border-amber-500/40 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shadow-md">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-300 tracking-wide uppercase">
                <Clock className="w-4 h-4 text-amber-400" />
                Startpunt Zang (Intro / Lead-in)
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950/80 border border-amber-500/30 text-slate-200">
                Regel #1 begint nu op: <strong className="text-amber-300 font-semibold">{formatTimeDisplay(cues[0]?.startTime || 0)}</strong> ({(cues[0]?.startTime || 0).toFixed(2)}s)
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Begint de zang pas na het instrumentale intro (bijv. op <strong>23 seconden</strong>)? Vul hier de gewenste starttijd in. <strong>Alle {cues.length} regels schuiven exact evenredig op</strong> met behoud van de juiste cue-duur en pauzes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Input box */}
            <div className="flex items-center bg-slate-950 border border-amber-500/40 rounded-lg p-1 shadow-inner">
              <span className="text-[11px] text-slate-400 pl-2 pr-1 font-medium">Zang start:</span>
              <input
                type="text"
                value={targetVocalStartInput}
                onChange={(e) => setTargetVocalStartInput(e.target.value)}
                placeholder="23"
                className="w-16 px-2 py-1 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded text-xs font-mono text-amber-300 font-bold text-center focus:outline-none"
              />
              <span className="text-[11px] text-slate-500 pr-1.5 pl-1">sec</span>
            </div>

            {/* Quick preset 23s */}
            <button
              type="button"
              onClick={() => {
                setTargetVocalStartInput('23');
                if (onShiftToVocalStartTime) {
                  onShiftToVocalStartTime(23);
                } else {
                  const delta = Math.round((23 - (cues[0]?.startTime || 0)) * 100) / 100;
                  onGlobalShift(delta);
                }
              }}
              className="px-2.5 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/50 rounded-lg text-xs font-mono font-bold transition-all active:scale-95 cursor-pointer shadow-sm"
              title="Zet regel #1 direct op 23.00 seconden en schuif alle cues evenredig op"
            >
              23s Intro
            </button>

            {/* Playhead button */}
            {currentTime > 0 && (
              <button
                type="button"
                onClick={() => {
                  const sec = Math.round(currentTime * 10) / 10;
                  setTargetVocalStartInput(String(sec));
                  if (onShiftToVocalStartTime) {
                    onShiftToVocalStartTime(sec);
                  } else {
                    const delta = Math.round((sec - (cues[0]?.startTime || 0)) * 100) / 100;
                    onGlobalShift(delta);
                  }
                }}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-medium transition-colors border border-slate-700 cursor-pointer"
                title={`Zet starttijd op de huidige audiospeler afspeelkop (${formatTimeDisplay(currentTime)})`}
              >
                <span>Huidige audiotijd ({formatTimeDisplay(currentTime)})</span>
              </button>
            )}

            {/* Execute Shift Button */}
            <button
              type="button"
              onClick={() => {
                const parsed = parseTimeToSeconds(targetVocalStartInput);
                if (parsed !== null) {
                  if (onShiftToVocalStartTime) {
                    onShiftToVocalStartTime(parsed);
                  } else {
                    const delta = Math.round((parsed - (cues[0]?.startTime || 0)) * 100) / 100;
                    onGlobalShift(delta);
                  }
                }
              }}
              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              title="Schuif alle cues op zodat regel #1 op deze starttijd begint"
            >
              <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Schuif alles op</span>
            </button>

            {/* Distribute evenly button in banner */}
            {onDistributeCuesEvenly && (
              <button
                type="button"
                onClick={onDistributeCuesEvenly}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs rounded-lg transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                title="Spreid alle tekstregels evenredig over het nummer uit (vult direct het midden en einde van het lied)"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                <span>Verdeel over hele nummer</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cues List */}
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-medium bg-slate-950/60 sticky top-0 z-10">
              <th className="py-2.5 px-3 w-12 text-center">#</th>
              <th className="py-2.5 px-3 w-28">Start Time</th>
              <th className="py-2.5 px-3 w-28">End Time</th>
              <th className="py-2.5 px-3 w-20">Duration</th>
              <th className="py-2.5 px-3">Lyric Line Content</th>
              <th className="py-2.5 px-3 w-40 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {filteredCues.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  {cues.length === 0
                    ? 'No subtitle cues generated yet. Upload audio and lyrics above to begin!'
                    : 'No cues matched your search term.'}
                </td>
              </tr>
            ) : (
              filteredCues.map((cue, index) => {
                const isActive = currentTime >= cue.startTime && currentTime <= cue.endTime;
                const isSelected = selectedCueId === cue.id;
                const duration = Math.max(0, cue.endTime - cue.startTime);

                return (
                  <tr
                    key={cue.id}
                    onClick={() => onSelectCue(cue.id)}
                    className={`transition-colors group ${
                      isActive
                        ? 'bg-indigo-950/40 text-white'
                        : isSelected
                        ? 'bg-slate-800/50 text-slate-100'
                        : 'hover:bg-slate-950/50 text-slate-300'
                    }`}
                  >
                    {/* Index & Jump */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToTime(cue.startTime);
                        }}
                        className={`w-7 h-7 rounded flex items-center justify-center transition-colors mx-auto ${
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                        }`}
                        title="Jump audio to this cue"
                      >
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </button>
                    </td>

                    {/* Start Time with Precision Controls */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {editingTimeCueId?.id === cue.id && editingTimeCueId?.field === 'start' ? (
                          <input
                            type="text"
                            value={tempTimeInput}
                            autoFocus
                            onChange={(e) => setTempTimeInput(e.target.value)}
                            onBlur={() => handleSaveEditingTime(cue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEditingTime(cue);
                              if (e.key === 'Escape') setEditingTimeCueId(null);
                            }}
                            className="w-20 px-1.5 py-0.5 bg-slate-950 border border-indigo-500 rounded font-mono text-xs text-white tabular-nums"
                          />
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditingTime(cue, 'start');
                            }}
                            className="font-mono tabular-nums text-slate-200 hover:text-indigo-400 hover:underline text-xs"
                            title="Click to edit timestamp manually"
                          >
                            {formatTimeDisplay(cue.startTime)}
                          </button>
                        )}

                        {/* Nudge buttons */}
                        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNudge(cue, 'start', -0.1);
                            }}
                            className="p-0.5 hover:text-white text-slate-400 rounded hover:bg-slate-800"
                            title="Nudge 0.1s earlier"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNudge(cue, 'start', 0.1);
                            }}
                            className="p-0.5 hover:text-white text-slate-400 rounded hover:bg-slate-800"
                            title="Nudge 0.1s later"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSnapCueToPlayhead) {
                                onSnapCueToPlayhead(cue.id, currentTime);
                              } else {
                                handlePinPlayhead(cue, 'start');
                              }
                            }}
                            className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-slate-800 ml-0.5 flex items-center gap-0.5"
                            title={`Zet deze regel (#${cue.id}) én vervolg op het witte lijntje (${formatTimeDisplay(currentTime)})`}
                          >
                            <Pin className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* End Time with Precision Controls */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {editingTimeCueId?.id === cue.id && editingTimeCueId?.field === 'end' ? (
                          <input
                            type="text"
                            value={tempTimeInput}
                            autoFocus
                            onChange={(e) => setTempTimeInput(e.target.value)}
                            onBlur={() => handleSaveEditingTime(cue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEditingTime(cue);
                              if (e.key === 'Escape') setEditingTimeCueId(null);
                            }}
                            className="w-20 px-1.5 py-0.5 bg-slate-950 border border-indigo-500 rounded font-mono text-xs text-white tabular-nums"
                          />
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditingTime(cue, 'end');
                            }}
                            className="font-mono tabular-nums text-slate-200 hover:text-indigo-400 hover:underline text-xs"
                            title="Click to edit timestamp manually"
                          >
                            {formatTimeDisplay(cue.endTime)}
                          </button>
                        )}

                        {/* Nudge buttons */}
                        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNudge(cue, 'end', -0.1);
                            }}
                            className="p-0.5 hover:text-white text-slate-400 rounded hover:bg-slate-800"
                            title="Nudge 0.1s earlier"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNudge(cue, 'end', 0.1);
                            }}
                            className="p-0.5 hover:text-white text-slate-400 rounded hover:bg-slate-800"
                            title="Nudge 0.1s later"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePinPlayhead(cue, 'end');
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-400 rounded hover:bg-slate-800 ml-0.5"
                            title={`Pin current playhead (${formatTimeDisplay(currentTime)}) as End`}
                          >
                            <Pin className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Duration */}
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {duration.toFixed(2)}s
                    </td>

                    {/* Inline Lyric Text Editing */}
                    <td className="py-2.5 px-3 min-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={cue.text}
                          onChange={(e) => onUpdateCue({ ...cue, text: e.target.value })}
                          className="flex-1 bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:bg-slate-950 px-2 py-1 rounded text-slate-200 focus:text-white focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRequestCueRephrase(cue);
                          }}
                          disabled={loadingCueId === cue.id}
                          className="p-1 text-slate-500 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors shrink-0"
                          title="Bedenk 3 alternatieve vertalingen voor deze regel"
                        >
                          {loadingCueId === cue.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      {cue.originalText && (
                        <span className="text-[10px] text-slate-500 italic block mt-0.5 px-2 truncate" title={`Originele tekst: ${cue.originalText}`}>
                          Origineel: {cue.originalText}
                        </span>
                      )}

                      {/* Dropdown / alternative suggestions */}
                      {rephraseCueId === cue.id && (cueOptions[cue.id] || []).length > 0 && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 p-2 bg-slate-950 border border-amber-500/40 rounded-lg space-y-1 shadow-xl z-20"
                        >
                          <span className="text-[10px] text-amber-300 font-medium block">
                            Klik op een alternatief om deze regel direct te vervangen:
                          </span>
                          <div className="space-y-1">
                            {cueOptions[cue.id].map((opt, oIdx) => (
                              <button
                                key={oIdx}
                                type="button"
                                onClick={() => {
                                  onUpdateCue({ ...cue, text: opt.text });
                                  setRephraseCueId(null);
                                }}
                                className="w-full text-left px-2 py-1 rounded bg-slate-900 hover:bg-amber-500/20 text-slate-200 hover:text-amber-200 border border-slate-800 hover:border-amber-500/40 text-[11px] transition-colors flex items-center justify-between gap-2"
                              >
                                <span>{opt.text}</span>
                                <span className="text-[9px] uppercase tracking-wider text-slate-500 shrink-0 font-mono">
                                  {opt.style === 'natural' ? 'Natuurlijk' : opt.style === 'singable' ? 'Zingbaar' : 'Poëtisch'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {onInsertInstrumentalBreak && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInsertInstrumentalBreak(cue.id, 15);
                            }}
                            className="p-1.5 text-purple-400 hover:text-purple-200 hover:bg-purple-950/60 rounded transition-colors"
                            title={`Voeg +15s instrumentale solo/break vóór Regel #${cue.id} in (schuift deze en alle volgende regels +15s op)`}
                          >
                            <Music className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddCue(index);
                          }}
                          className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors"
                          title="Insert new cue below"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSplitCue(cue.id, currentTime);
                          }}
                          className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors"
                          title={`Split cue at current audio position (${formatTimeDisplay(currentTime)})`}
                        >
                          <Split className="w-3.5 h-3.5" />
                        </button>

                        {index < cues.length - 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMergeWithNext(cue.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors"
                            title="Merge with next line"
                          >
                            <Combine className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteCue(cue.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                          title="Delete this cue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Helper */}
      <div className="border-t border-slate-800 pt-3 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <div className="flex items-center gap-3">
          <span>Tip: Click any timestamp to edit directly</span>
          <span>·</span>
          <span>Use <Pin className="w-3 h-3 inline mx-0.5 text-slate-400" /> to sync with current audio playback</span>
        </div>
        <button
          onClick={() => onAddCue(cues.length - 1)}
          className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Cue at End
        </button>
      </div>
    </div>
  );
};
