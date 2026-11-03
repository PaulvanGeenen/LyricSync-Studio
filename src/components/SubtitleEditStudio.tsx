import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  Split,
  Combine,
  Wand2,
  Scissors,
  Pin,
  Clock,
  Music,
  ZoomIn,
  ZoomOut,
  ChevronUp,
  ChevronDown,
  FileSpreadsheet,
  Video,
  Image as ImageIcon,
  Activity,
  Zap,
} from 'lucide-react';
import { SubtitleCue } from '../types/subtitle';
import { formatTimeDisplay, formatSecondsToSrt } from '../utils/timeFormat';
import {
  findNearestAcousticOnset,
  snapCuesToAudioOnsets,
  alignCuesWithAcousticWaveform,
  findVocalPhraseEnd,
} from '../utils/audioWaveform';

interface SubtitleEditStudioProps {
  audioUrl: string | null;
  audioBlob?: Blob | null;
  audioDuration: number;
  audioName: string;
  cues: SubtitleCue[];
  waveformPeaks: number[];
  selectedCueId: number | null;
  onSelectCue: (id: number) => void;
  onUpdateCue: (updatedCue: SubtitleCue) => void;
  onUpdateAllCues?: (cues: SubtitleCue[]) => void;
  onAddCue: (afterIndex: number, specificStart?: number) => void;
  onDeleteCue: (id: number) => void;
  onSplitCue: (id: number, splitTime: number) => void;
  onMergeWithNext: (id: number) => void;
  onSnapCueToPlayhead?: (cueId: number, targetTime: number) => void;
  onInsertInstrumentalBreak?: (fromCueId: number, seconds: number) => void;
  onCutVocalAtPlayhead?: (cueId: number, cutTime: number) => void;
  onRepairMidSongGaps?: () => void;
  onDistributeCuesEvenly?: () => void;
  onOpenExportModal?: () => void;
  onOpenMp4Converter?: () => void;
  onOpenTimestampTransfer?: () => void;
  coverImageUrl?: string | null;
  onCoverImageChange?: (file: File) => void;
}

export const SubtitleEditStudio: React.FC<SubtitleEditStudioProps> = ({
  audioUrl,
  audioBlob,
  audioDuration,
  audioName,
  cues,
  waveformPeaks,
  selectedCueId,
  onSelectCue,
  onUpdateCue,
  onUpdateAllCues,
  onAddCue,
  onDeleteCue,
  onSplitCue,
  onMergeWithNext,
  onSnapCueToPlayhead,
  onInsertInstrumentalBreak,
  onCutVocalAtPlayhead,
  onRepairMidSongGaps,
  onDistributeCuesEvenly,
  onOpenExportModal,
  onOpenMp4Converter,
  onOpenTimestampTransfer,
  coverImageUrl: initialCoverImage,
  onCoverImageChange,
}) => {
  // Audio Playback & 60fps Loop
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(initialCoverImage || null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Timeline & Waveform Canvas
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(100); // 100px/s default
  const [waveformGain, setWaveformGain] = useState(1.4); // Volume peak visual gain multiplier
  const [autoScroll, setAutoScroll] = useState(true);
  const [hoverTimelineTime, setHoverTimelineTime] = useState<number | null>(null);
  const isUserDraggingRef = useRef(false);
  const wheelTimeoutRef = useRef<number | null>(null);
  const ignoreNextClickRef = useRef(false);
  const hasMovedBlockRef = useRef(false);

  // Decoded Web Audio Buffer for real volume peak waveform
  const [decodedAudioBuffer, setDecodedAudioBuffer] = useState<AudioBuffer | null>(null);

  // Dragging state for Subtitle Blocks on the Waveform
  const [dragState, setDragState] = useState<{
    cueId: number;
    mode: 'left' | 'right' | 'move';
    startX: number;
    origStartTime: number;
    origEndTime: number;
    currStartTime: number;
    currEndTime: number;
  } | null>(null);

  // Decode real audio data for authentic volume peaks (quiet valleys vs loud choruses)
  useEffect(() => {
    let isCancelled = false;

    const decodeAudioData = async () => {
      if (!audioBlob && !audioUrl) return;
      try {
        let arrayBuffer: ArrayBuffer;
        if (audioBlob) {
          arrayBuffer = await audioBlob.arrayBuffer();
        } else if (audioUrl) {
          const res = await fetch(audioUrl);
          arrayBuffer = await res.arrayBuffer();
        } else {
          return;
        }

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close();
        if (!isCancelled) {
          setDecodedAudioBuffer(decoded);
          // If cues have approximate integer cadence estimates (e.g. 25, 30, 35), immediately auto-align with waveform peaks
          const isApproxCadence = cues.length >= 2 && cues.slice(0, 4).every((c) => Math.abs(c.startTime - Math.round(c.startTime)) < 0.01);
          if (isApproxCadence && onUpdateAllCues) {
            console.log('[Waveform Aligner] Detected approximate integer cadence. Auto-aligning cues with acoustic waveform peaks...');
            const aligned = alignCuesWithAcousticWaveform(decoded, cues, cues[0]?.startTime || 0);
            onUpdateAllCues(aligned);
          }
        }
      } catch (err) {
        console.warn('Could not decode audio buffer for canvas waveform:', err);
      }
    };

    decodeAudioData();
    return () => {
      isCancelled = true;
    };
  }, [audioBlob, audioUrl]);

  // Active cue resolution
  const activeCue = useMemo(() => {
    const matching = cues.filter((c) => currentTime >= c.startTime && currentTime <= c.endTime);
    if (matching.length > 0) return matching[matching.length - 1];
    return null;
  }, [cues, currentTime]);

  // Selected cue or fallback to active cue
  const currentSelectedCue = useMemo(() => {
    if (selectedCueId !== null) {
      const found = cues.find((c) => c.id === selectedCueId);
      if (found) return found;
    }
    return activeCue || cues[0] || null;
  }, [cues, selectedCueId, activeCue]);

  // When playback is paused or scrubbing, auto-focus the active cue under the playhead so inspector matches current frame
  useEffect(() => {
    if (!isPlaying && activeCue && activeCue.id !== selectedCueId) {
      onSelectCue(activeCue.id);
    }
  }, [isPlaying, activeCue, selectedCueId, onSelectCue]);

  // =========================================================================
  // SMOOTH 60 FPS PLAYBACK & CONTINUOUS TIMELINE GLIDE (NO SHAKE, NO STUTTER)
  // =========================================================================
  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;

    const renderLoop = () => {
      if (audioRef.current && !audioRef.current.paused) {
        const t = audioRef.current.currentTime;
        setCurrentTime(t);

        // Continuous 60fps auto-scroll: Keep playhead smoothly at 30% from the left edge of the screen!
        if (autoScroll && timelineViewportRef.current && !isUserDraggingRef.current) {
          const container = timelineViewportRef.current;
          const containerWidth = container.clientWidth;
          const playheadX = t * pixelsPerSecond;
          // Target scroll position locks the playhead at 30% of the visible container
          const targetScroll = Math.max(0, playheadX - containerWidth * 0.3);
          container.scrollLeft = targetScroll;
        }
      }
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, autoScroll, pixelsPerSecond]);

  // Audio element sync
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying && audioRef.current.paused) {
      audioRef.current.play().catch(() => setIsPlaying(false));
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

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (time: number, centerTimeline: boolean = true) => {
    const clamped = Math.max(0, Math.min(audioDuration || 9999, time));
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
    setCurrentTime(clamped);

    // Center the viewport when requested (e.g. from scrubber or cue list)
    if (centerTimeline && timelineViewportRef.current) {
      const container = timelineViewportRef.current;
      const targetScroll = Math.max(0, clamped * pixelsPerSecond - container.clientWidth * 0.3);
      container.scrollLeft = targetScroll;
    }
  };

  const handleReplayCue = (cue: SubtitleCue) => {
    seekTo(cue.startTime);
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // Keyboard shortcut Spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  // =========================================================================
  // DRAW AUTHENTIC AUDIO WAVEFORM WITH TRUE VOLUME PEAKS (CANVAS)
  // =========================================================================
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(1200, Math.ceil((audioDuration || 60) * pixelsPerSecond));
    const height = 126; // Waveform canvas height
    canvas.width = width;
    canvas.height = height;

    // Dark DAW background
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const maxHalfHeight = (height / 2) * 0.92;

    // Subtle center zero-crossing line
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Subtitle Edit Gradient: Dark emerald at center, bright gold/yellow mid-range, amber peaks
    const gradient = ctx.createLinearGradient(0, centerY - maxHalfHeight, 0, centerY + maxHalfHeight);
    gradient.addColorStop(0, '#f59e0b'); // Amber peak
    gradient.addColorStop(0.22, '#eab308'); // Golden yellow
    gradient.addColorStop(0.46, '#10b981'); // Emerald
    gradient.addColorStop(0.5, '#047857'); // Dark green center
    gradient.addColorStop(0.54, '#10b981');
    gradient.addColorStop(0.78, '#eab308');
    gradient.addColorStop(1, '#f59e0b');

    ctx.fillStyle = gradient;

    if (decodedAudioBuffer) {
      // True raw audio data
      const channelData = decodedAudioBuffer.getChannelData(0);
      const sampleRate = decodedAudioBuffer.sampleRate;
      const totalSamples = channelData.length;
      const samplesPerPixel = sampleRate / pixelsPerSecond;

      for (let x = 0; x < width; x++) {
        const startSample = Math.floor(x * samplesPerPixel);
        const endSample = Math.min(totalSamples, Math.floor((x + 1) * samplesPerPixel));
        if (startSample >= totalSamples) break;

        let min = 0;
        let max = 0;
        // Step sampling across the ~440 samples in this pixel column
        const step = Math.max(1, Math.floor((endSample - startSample) / 45));
        for (let s = startSample; s < endSample; s += step) {
          const val = channelData[s];
          if (val < min) min = val;
          if (val > max) max = val;
        }

        // Apply gain to emphasize soft whisper vs loud chorus dynamics
        const boostedMax = Math.min(1.0, max * waveformGain);
        const boostedMin = Math.max(-1.0, min * waveformGain);

        const topY = Math.max(2, centerY - boostedMax * maxHalfHeight);
        const bottomY = Math.min(height - 2, centerY - boostedMin * maxHalfHeight);
        const barHeight = Math.max(2, bottomY - topY);

        ctx.fillRect(x, topY, 1, barHeight);
      }
    } else if (waveformPeaks && waveformPeaks.length > 0) {
      // Fallback while decoding
      const totalBars = width;
      const peaksLen = waveformPeaks.length;
      for (let x = 0; x < width; x++) {
        const peakIdx = Math.floor((x / width) * peaksLen);
        const rawPeak = waveformPeaks[peakIdx] || 0.15;
        const amp = Math.min(1.0, rawPeak * waveformGain);
        const barHeight = Math.max(3, amp * maxHalfHeight * 2);
        ctx.fillRect(x, centerY - barHeight / 2, 1, barHeight);
      }
    }
  }, [decodedAudioBuffer, waveformPeaks, audioDuration, pixelsPerSecond, waveformGain]);

  // =========================================================================
  // DRAG & RESIZE SUBTITLE BLOCKS ON WAVEFORM
  // =========================================================================
  const handleBlockMouseDown = (
    e: React.MouseEvent,
    cue: SubtitleCue,
    mode: 'left' | 'right' | 'move'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectCue(cue.id);
    isUserDraggingRef.current = true;
    ignoreNextClickRef.current = true;
    hasMovedBlockRef.current = false;

    setDragState({
      cueId: cue.id,
      mode,
      startX: e.clientX,
      origStartTime: cue.startTime,
      origEndTime: cue.endTime,
      currStartTime: cue.startTime,
      currEndTime: cue.endTime,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX;
      if (Math.abs(deltaX) > 2) {
        hasMovedBlockRef.current = true;
      }
      const deltaTime = deltaX / pixelsPerSecond;

      if (dragState.mode === 'left') {
        const newStart = Math.max(0, Math.min(dragState.origEndTime - 0.3, dragState.origStartTime + deltaTime));
        setDragState((prev) => prev ? { ...prev, currStartTime: Math.round(newStart * 100) / 100 } : null);
      } else if (dragState.mode === 'right') {
        const maxDur = audioDuration > 0 ? audioDuration : 9999;
        const newEnd = Math.max(dragState.origStartTime + 0.3, Math.min(maxDur, dragState.origEndTime + deltaTime));
        setDragState((prev) => prev ? { ...prev, currEndTime: Math.round(newEnd * 100) / 100 } : null);
      } else if (dragState.mode === 'move') {
        const duration = dragState.origEndTime - dragState.origStartTime;
        const maxDur = audioDuration > 0 ? audioDuration : 9999;
        let newStart = Math.max(0, dragState.origStartTime + deltaTime);
        if (newStart + duration > maxDur) {
          newStart = maxDur - duration;
        }
        const newEnd = newStart + duration;
        setDragState((prev) => prev ? {
          ...prev,
          currStartTime: Math.round(newStart * 100) / 100,
          currEndTime: Math.round(newEnd * 100) / 100,
        } : null);
      }
    };

    const handleMouseUp = () => {
      if (dragState && hasMovedBlockRef.current) {
        const targetCue = cues.find((c) => c.id === dragState.cueId);
        if (targetCue) {
          onUpdateCue({
            ...targetCue,
            startTime: dragState.currStartTime,
            endTime: dragState.currEndTime,
          });
        }
      }
      setDragState(null);
      // Keep click ignoring active for 350ms so synthetic mouseup/click doesn't jump the timeline
      setTimeout(() => {
        ignoreNextClickRef.current = false;
        isUserDraggingRef.current = false;
      }, 350);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, pixelsPerSecond, audioDuration, cues, onUpdateCue]);

  // Click on waveform track to seek playhead
  const handleTimelineTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If a block drag/resize just completed or user is dragging, do not seek
    if (ignoreNextClickRef.current || isUserDraggingRef.current) return;
    const container = timelineViewportRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    // CRITICAL: Must add container.scrollLeft so click position matches actual audio timestamp!
    const clickX = (e.clientX - rect.left) + container.scrollLeft;
    const clickTime = Math.max(0, Math.min(audioDuration, clickX / pixelsPerSecond));

    // When clicking the track directly, place playhead without jumping viewport away
    if (audioRef.current) {
      audioRef.current.currentTime = clickTime;
    }
    setCurrentTime(clickTime);

    // Auto-select cue at or nearest to clicked time so inspector displays the correct block
    const matchingCue = cues.find((c) => clickTime >= c.startTime && clickTime <= c.endTime);
    if (matchingCue) {
      onSelectCue(matchingCue.id);
    } else {
      let nearest: SubtitleCue | null = null;
      let minDist = 3.5;
      for (const c of cues) {
        const d = Math.min(Math.abs(clickTime - c.startTime), Math.abs(clickTime - c.endTime));
        if (d < minDist) {
          minDist = d;
          nearest = c;
        }
      }
      if (nearest) {
        onSelectCue(nearest.id);
      }
    }
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = timelineViewportRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // CRITICAL: Must add container.scrollLeft so hover indicator matches actual audio timestamp!
    const hoverX = (e.clientX - rect.left) + container.scrollLeft;
    const hoverTime = Math.max(0, Math.min(audioDuration, hoverX / pixelsPerSecond));
    setHoverTimelineTime(hoverTime);
  };

  // =========================================================================
  // MOUSE WHEEL TIMELINE HORIZONTAL NAVIGATION & ZOOM
  // User request:
  // "Als mijn muis over het onderste gedeelte beweegt wil ik dat de tijdlijn naar rechts gaat
  // als ik het muiswiel naar voren draai en ik in de tijdlijn terug ga als ik het muiswieltje naar achteren draai."
  // =========================================================================
  useEffect(() => {
    const container = timelineViewportRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent standard vertical browser page scrolling
      e.preventDefault();

      // Ctrl + Wheel: Zoom timeline in / out like DAW / Subtitle Edit
      if (e.ctrlKey) {
        setPixelsPerSecond((prev) => {
          const step = e.deltaY < 0 ? 15 : -15;
          return Math.max(50, Math.min(250, prev + step));
        });
        return;
      }

      // Wheel forward (e.deltaY < 0) -> move timeline to the right (+scrollLeft, advance in song)
      // Wheel backward (e.deltaY > 0) -> go back in timeline (-scrollLeft, towards 0s)
      let scrollDelta = 0;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1) {
        scrollDelta = e.deltaX * 1.2;
      } else {
        // e.deltaY < 0 (forward roll): scrollDelta > 0 (advances to right)
        // e.deltaY > 0 (backward roll): scrollDelta < 0 (goes back to left)
        scrollDelta = -e.deltaY * 1.25;
      }

      container.scrollLeft += scrollDelta;

      // Temporarily suspend auto-scroll during mouse wheel navigation
      // so it doesn't snap back immediately while the user is actively viewing/seeking
      isUserDraggingRef.current = true;
      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = window.setTimeout(() => {
        isUserDraggingRef.current = false;
      }, 1500);
    };

    // Attach non-passive wheel listener so e.preventDefault() reliably halts page vertical scroll
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, []);

  // Nudge selected cue start/duration
  const handleNudgeSelected = (field: 'start' | 'duration', delta: number) => {
    if (!currentSelectedCue) return;
    if (field === 'start') {
      const newStart = Math.max(0, Math.round((currentSelectedCue.startTime + delta) * 100) / 100);
      const newEnd = Math.max(newStart + 0.3, currentSelectedCue.endTime);
      onUpdateCue({ ...currentSelectedCue, startTime: newStart, endTime: newEnd });
    } else if (field === 'duration') {
      const curDur = currentSelectedCue.endTime - currentSelectedCue.startTime;
      const newDur = Math.max(0.3, Math.round((curDur + delta) * 100) / 100);
      onUpdateCue({ ...currentSelectedCue, endTime: Math.round((currentSelectedCue.startTime + newDur) * 100) / 100 });
    }
  };

  // Toast notification for studio quick-actions
  const [studioToast, setStudioToast] = useState<string | null>(null);
  const showStudioToast = (msg: string) => {
    setStudioToast(msg);
    setTimeout(() => setStudioToast(null), 3200);
  };

  // Acoustic transient snapping for current selected cue
  const handleSnapCurrentCueToPeak = () => {
    if (!currentSelectedCue || !decodedAudioBuffer) return;
    const onset = findNearestAcousticOnset(decodedAudioBuffer, currentSelectedCue.startTime, 3.5);
    if (onset !== null) {
      const dur = currentSelectedCue.endTime - currentSelectedCue.startTime;
      const updated: SubtitleCue = {
        ...currentSelectedCue,
        startTime: onset,
        endTime: Math.round((onset + dur) * 100) / 100,
      };
      onUpdateCue(updated);
      showStudioToast(`⚡ Regel #${currentSelectedCue.id} gesnapt naar vocale piek (${formatTimeDisplay(onset)})!`);
    } else {
      showStudioToast(`Geen duidelijke zangpiek gevonden in deze passage`);
    }
  };

  // Acoustic transient snapping for ALL cues across the entire song
  const handleSnapAllCuesToPeaks = () => {
    if (!decodedAudioBuffer || cues.length === 0) return;
    const snapped = alignCuesWithAcousticWaveform(decodedAudioBuffer, cues, cues[0]?.startTime || 0);
    if (onUpdateAllCues) {
      onUpdateAllCues(snapped);
    } else {
      snapped.forEach((c) => onUpdateCue(c));
    }
    showStudioToast(`⚡ Alle ${cues.length} cues haarscherp uitgelijnd op de zichtbare zangpieken in de waveform!`);
  };

  // Extend selected cue end to the natural vocal decay valley so it never cuts off prematurely
  const handleSnapCurrentCueEndToVocalTail = () => {
    if (!currentSelectedCue) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const curIdx = sorted.findIndex((c) => c.id === currentSelectedCue.id);
    const nextCue = sorted[curIdx + 1];
    const maxEnd = nextCue ? nextCue.startTime - 0.15 : (audioDuration || currentSelectedCue.startTime + 9.5);

    if (decodedAudioBuffer) {
      const detectedEnd = findVocalPhraseEnd(
        decodedAudioBuffer,
        currentSelectedCue.startTime,
        maxEnd,
        1.8
      );
      if (detectedEnd !== null && detectedEnd > currentSelectedCue.startTime + 1.2) {
        onUpdateCue({
          ...currentSelectedCue,
          endTime: detectedEnd,
        });
        showStudioToast(`🎵 Regel #${currentSelectedCue.id} verlengd tot zangdal (${formatTimeDisplay(detectedEnd)})!`);
        return;
      }
    }

    // Fallback: extend by 0.5s if buffer not available
    handleExtendCurrentCueEnd(0.5);
  };

  // Quick manual extension of cue end time
  const handleExtendCurrentCueEnd = (seconds: number) => {
    if (!currentSelectedCue) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const curIdx = sorted.findIndex((c) => c.id === currentSelectedCue.id);
    const nextCue = sorted[curIdx + 1];
    const maxLimit = nextCue ? nextCue.startTime - 0.12 : (audioDuration || 9999);
    const newEnd = Math.min(maxLimit, Math.round((currentSelectedCue.endTime + seconds) * 100) / 100);

    if (newEnd > currentSelectedCue.endTime + 0.05) {
      onUpdateCue({
        ...currentSelectedCue,
        endTime: newEnd,
      });
      showStudioToast(`⏱ Regel #${currentSelectedCue.id} verlengd naar ${formatTimeDisplay(newEnd)} (+${(newEnd - currentSelectedCue.endTime).toFixed(2)}s)`);
    } else {
      showStudioToast(`Kan niet verder verlengen: bereikt volgende regel of audio-einde`);
    }
  };

  // Batch add post-vocal reading/sustain padding (+0.5s) to ALL cues
  const handleAddPaddingToAllCues = (seconds = 0.5) => {
    if (cues.length === 0) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const updated = sorted.map((cue, idx) => {
      const next = sorted[idx + 1];
      const maxLimit = next ? next.startTime - 0.15 : (audioDuration || cue.startTime + 9.5);
      const newEnd = Math.min(maxLimit, Math.round((cue.endTime + seconds) * 100) / 100);
      return {
        ...cue,
        endTime: Math.max(cue.endTime, newEnd),
      };
    });
    if (onUpdateAllCues) {
      onUpdateAllCues(updated);
    } else {
      updated.forEach((c) => onUpdateCue(c));
    }
    showStudioToast(`⏱ +${seconds}s rustige leestijd en zangduur toegevoegd aan alle regels!`);
  };

  const [isDetectingIntro, setIsDetectingIntro] = useState(false);

  // Shifts ALL cues so that Cue #1 starts at the current playhead position
  const handleShiftAllCuesToPlayhead = () => {
    if (cues.length === 0) return;
    const sorted = [...cues].sort((a, b) => a.id - b.id);
    const targetStart = Math.max(0, Math.round(currentTime * 100) / 100);
    const delta = targetStart - sorted[0].startTime;

    if (Math.abs(delta) < 0.05) {
      showStudioToast(`Regel #1 begint al exact op ${formatTimeDisplay(targetStart)}`);
      return;
    }

    const shifted = sorted.map((cue) => ({
      ...cue,
      startTime: Math.max(0, Math.round((cue.startTime + delta) * 100) / 100),
      endTime: Math.max(0.5, Math.round((cue.endTime + delta) * 100) / 100),
    }));

    if (onUpdateAllCues) {
      onUpdateAllCues(shifted);
    } else {
      shifted.forEach((c) => onUpdateCue(c));
    }

    showStudioToast(
      `🚀 Alle ${cues.length} regels verschoven! Regel #1 start nu op ${formatTimeDisplay(targetStart)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s intro).`
    );
  };

  // AI-powered automatic vocal intro detection
  const handleAutoDetectVocalIntro = async () => {
    if (!audioBlob) {
      showStudioToast('Geen audiobestand geladen om intro te detecteren');
      return;
    }
    setIsDetectingIntro(true);
    showStudioToast('AI analyseert waar de zang in de muziek begint...');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const b64 = (reader.result as string)?.split(',')[1] || '';
          const res = await fetch('/api/detect-vocal-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: b64, mimeType: audioBlob.type || 'audio/mp3' }),
          });
          const data = await res.json();
          if (data.vocalStartSeconds >= 1.5) {
            const sorted = [...cues].sort((a, b) => a.id - b.id);
            const delta = data.vocalStartSeconds - sorted[0].startTime;
            const shifted = sorted.map((cue) => ({
              ...cue,
              startTime: Math.max(0, Math.round((cue.startTime + delta) * 100) / 100),
              endTime: Math.max(0.5, Math.round((cue.endTime + delta) * 100) / 100),
            }));
            if (onUpdateAllCues) {
              onUpdateAllCues(shifted);
            } else {
              shifted.forEach((c) => onUpdateCue(c));
            }
            showStudioToast(
              `✨ Zangstart gedetecteerd op ${formatTimeDisplay(data.vocalStartSeconds)} (${data.firstWords ? `"${data.firstWords}"` : ''})! Alle regels zijn automatisch meegeschoven.`
            );
          } else {
            showStudioToast('Geen duidelijk muzikaal intro gedetecteerd (zang start direct bij start)');
          }
        } catch (e: any) {
          showStudioToast('Intro detectie mislukt: ' + (e?.message || 'fout'));
        } finally {
          setIsDetectingIntro(false);
        }
      };
      reader.readAsDataURL(audioBlob);
    } catch (err: any) {
      setIsDetectingIntro(false);
      showStudioToast('Fout bij verwerken audio: ' + err.message);
    }
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setLocalCoverUrl(url);
      if (onCoverImageChange) {
        onCoverImageChange(file);
      }
    }
  };

  const totalTimelineWidth = Math.max(1200, Math.ceil((audioDuration || 60) * pixelsPerSecond));
  const integerSecondsCount = Math.ceil(audioDuration || 60);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col text-slate-200">
      {/* Hidden Native Audio Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Top Application Bar matching Subtitle Edit */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-rose-600 flex items-center justify-center text-white font-bold text-[11px] shadow-sm">
              SE
            </div>
            <span className="font-semibold text-slate-100 truncate max-w-[280px] sm:max-w-md">
              {audioName || 'Lied'}.srt &mdash; <span className="text-slate-400 font-normal">Subtitle Edit Studio</span>
            </span>
          </div>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 font-mono text-[11px]">
            Format: SubRip (.srt)
          </span>
        </div>

        {/* Studio Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {onOpenTimestampTransfer && (
            <button
              type="button"
              onClick={onOpenTimestampTransfer}
              className="px-2.5 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 hover:text-white border border-emerald-500/40 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Kopieer Engelse tijden naar Nederlandse of andere taal .srt"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tijden Kopiëren (.SRT)</span>
            </button>
          )}

          {onOpenMp4Converter && (
            <button
              type="button"
              onClick={onOpenMp4Converter}
              className="px-2.5 py-1.5 bg-purple-950/80 hover:bg-purple-900 text-purple-200 hover:text-white border border-purple-500/40 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Zet MP3 en Cover JPG om naar een MP4 video"
            >
              <Video className="w-3.5 h-3.5 text-purple-400" />
              <span>MP3 naar MP4</span>
            </button>
          )}

          {onOpenExportModal && (
            <button
              type="button"
              onClick={onOpenExportModal}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Exporteer .SRT / .VTT</span>
            </button>
          )}
        </div>
      </div>

      {/* Upper Main Workspace: Grid Table (Left) & Video Stage (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border-b border-slate-800 min-h-[380px] bg-slate-900/40">
        {/* Left Side: Subtitle List Grid & Active Cue Inspector (7 cols) */}
        <div className="lg:col-span-7 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-800">
          {/* Subtitle Cue List Grid Header */}
          <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Ondertitellijst ({cues.length} regels)</span>
            <div className="flex items-center gap-2 text-slate-400 font-normal">
              <span>Klik op een regel om te selecteren en bewerken</span>
            </div>
          </div>

          {/* Subtitle Cue Table */}
          <div className="flex-1 overflow-y-auto max-h-[260px] bg-slate-950/60 font-mono text-xs select-none">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider z-10">
                <tr>
                  <th className="py-1.5 px-3 w-10 text-center">#</th>
                  <th className="py-1.5 px-3 w-28">Start (Show)</th>
                  <th className="py-1.5 px-3 w-28">Einde (Hide)</th>
                  <th className="py-1.5 px-3 w-20">Duur</th>
                  <th className="py-1.5 px-3">Tekst</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {cues.map((cue) => {
                  const isSelected = currentSelectedCue?.id === cue.id;
                  const isCurrent = activeCue?.id === cue.id;
                  const dur = cue.endTime - cue.startTime;
                  const charsPerSec = dur > 0 ? (cue.text.length / dur) : 0;
                  const isTooFast = charsPerSec > 24;

                  return (
                    <tr
                      key={cue.id}
                      onClick={() => onSelectCue(cue.id)}
                      onDoubleClick={() => handleReplayCue(cue)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-600/30 text-white border-l-4 border-blue-500 font-medium'
                          : isCurrent
                          ? 'bg-indigo-950/40 text-indigo-200'
                          : 'hover:bg-slate-900/70 text-slate-300'
                      }`}
                    >
                      <td className="py-1.5 px-3 text-center text-slate-500">{cue.id}</td>
                      <td className="py-1.5 px-3 tabular-nums">{formatSecondsToSrt(cue.startTime)}</td>
                      <td className="py-1.5 px-3 tabular-nums">{formatSecondsToSrt(cue.endTime)}</td>
                      <td className={`py-1.5 px-3 tabular-nums ${isTooFast ? 'text-rose-400 font-bold' : 'text-slate-400'}`}>
                        {dur.toFixed(3)}s
                      </td>
                      <td className="py-1.5 px-3 truncate max-w-[260px] font-sans text-xs">
                        {cue.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Active Cue Inspector Box */}
          {currentSelectedCue && (
            <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Show Time & Duration Controls */}
                <div className="sm:col-span-4 space-y-2">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Starttijd (Show)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        readOnly
                        value={formatSecondsToSrt(currentSelectedCue.startTime)}
                        className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded font-mono text-xs text-white tabular-nums"
                      />
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => handleNudgeSelected('start', 0.1)}
                          className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-t border border-slate-700"
                          title="+0.1s later"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNudgeSelected('start', -0.1)}
                          className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-b border border-slate-700 border-t-0"
                          title="-0.1s vroeger"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Duur (Duration)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        readOnly
                        value={`${(currentSelectedCue.endTime - currentSelectedCue.startTime).toFixed(3)}s`}
                        className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded font-mono text-xs text-white tabular-nums"
                      />
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => handleNudgeSelected('duration', 0.1)}
                          className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-t border border-slate-700"
                          title="+0.1s verlengen"
                        >
                          <ChevronUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNudgeSelected('duration', -0.1)}
                          className="px-1 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-b border border-slate-700 border-t-0"
                          title="-0.1s inkorten"
                        >
                          <ChevronDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Text Editing Area & Live Stats */}
                <div className="sm:col-span-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-slate-400">
                        Ondertiteltekst (Regel #{currentSelectedCue.id})
                      </label>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Tekens/sec:{' '}
                        <strong
                          className={
                            (currentSelectedCue.text.length /
                              Math.max(0.3, currentSelectedCue.endTime - currentSelectedCue.startTime)) > 24
                              ? 'text-rose-400'
                              : 'text-emerald-400'
                          }
                        >
                          {(
                            currentSelectedCue.text.length /
                            Math.max(0.3, currentSelectedCue.endTime - currentSelectedCue.startTime)
                          ).toFixed(1)}
                        </strong>
                        {' · '}Lengte: {currentSelectedCue.text.length}
                      </span>
                    </div>
                    <textarea
                      value={currentSelectedCue.text}
                      rows={2}
                      onChange={(e) =>
                        onUpdateCue({
                          ...currentSelectedCue,
                          text: e.target.value,
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg text-xs text-white focus:outline-none transition-colors"
                      placeholder="Voer ondertitelregel in..."
                    />
                  </div>

                  {/* Quick Inspector Toolbar */}
                  <div className="pt-1.5 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleReplayCue(currentSelectedCue)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium flex items-center gap-1 cursor-pointer"
                        title="Speel deze regel af"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Afspelen</span>
                      </button>

                      {onSnapCueToPlayhead && (
                        <button
                          type="button"
                          onClick={() => onSnapCueToPlayhead(currentSelectedCue.id, currentTime)}
                          className="px-2 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/40 rounded font-medium flex items-center gap-1 cursor-pointer"
                          title="Start deze regel op de huidige playhead"
                        >
                          <Pin className="w-3 h-3 text-emerald-400" />
                          <span>Snap op {formatTimeDisplay(currentTime)}</span>
                        </button>
                      )}

                      {decodedAudioBuffer && (
                        <button
                          type="button"
                          onClick={handleSnapCurrentCueToPeak}
                          className="px-2 py-1 bg-amber-950 hover:bg-amber-900 text-amber-200 border border-amber-500/40 rounded font-medium flex items-center gap-1 cursor-pointer shadow-sm"
                          title="Lijn deze regel exact uit op de dichtstbijzijnde vocale energiepiek in de audiogolfvorm"
                        >
                          <Zap className="w-3 h-3 text-amber-400 fill-current" />
                          <span>Snap op Piek</span>
                        </button>
                      )}

                      {onCutVocalAtPlayhead && (
                        <button
                          type="button"
                          onClick={() => onCutVocalAtPlayhead(currentSelectedCue.id, currentTime)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded font-medium flex items-center gap-1 cursor-pointer"
                          title="Beëindig deze regel op de playhead (zang stopt hier)"
                        >
                          <Scissors className="w-3 h-3" />
                          <span>Kap af</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleExtendCurrentCueEnd(0.5)}
                        className="px-2 py-1 bg-blue-950 hover:bg-blue-900 text-blue-200 border border-blue-500/40 rounded font-medium flex items-center gap-1 cursor-pointer shadow-sm"
                        title="Verleng het einde met +0.5s zodat de ondertitel niet te vroeg verdwijnt tijdens het zingen"
                      >
                        <Plus className="w-3 h-3 text-blue-400" />
                        <span>+0.5s Einde</span>
                      </button>

                      {decodedAudioBuffer && (
                        <button
                          type="button"
                          onClick={handleSnapCurrentCueEndToVocalTail}
                          className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/40 rounded font-medium flex items-center gap-1 cursor-pointer shadow-sm"
                          title="Lijn het einde van dit blok automatisch uit op het punt waar de zangtoon uitdooft in het stiltedal vóór de volgende regel"
                        >
                          <Activity className="w-3 h-3 text-cyan-400" />
                          <span>Naar Zangeinde</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {onInsertInstrumentalBreak && (
                        <button
                          type="button"
                          onClick={() => onInsertInstrumentalBreak(currentSelectedCue.id, 15)}
                          className="px-2 py-1 bg-purple-950 hover:bg-purple-900 text-purple-200 border border-purple-500/40 rounded font-medium flex items-center gap-1 cursor-pointer"
                          title="Voeg +15s break/solo in vóór deze regel"
                        >
                          <Music className="w-3 h-3 text-purple-400" />
                          <span>+15s Break</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onSplitCue(currentSelectedCue.id, currentTime)}
                        className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded"
                        title="Splits regel op huidige playhead"
                      >
                        <Split className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onMergeWithNext(currentSelectedCue.id)}
                        className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded"
                        title="Voeg samen met volgende regel"
                      >
                        <Combine className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteCue(currentSelectedCue.id)}
                        className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded"
                        title="Verwijder regel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Visual Stage Video / Media Preview (5 cols) */}
        <div className="lg:col-span-5 flex flex-col p-3 bg-slate-950/70">
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center shadow-inner group">
            {/* Background Media / Cover / Visualizer */}
            {localCoverUrl ? (
              <img
                src={localCoverUrl}
                alt="Cover"
                className="absolute inset-0 w-full h-full object-cover opacity-85"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950/50 to-slate-950 flex flex-col items-center justify-center p-4 text-center">
                <Music className="w-12 h-12 text-indigo-400/30 mb-2" />
                <span className="text-xs font-semibold text-slate-300">{audioName || 'Liedje'}</span>
                <span className="text-[11px] text-slate-500">Live ondertitelsynchronisatie</span>
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

            {/* Custom Cover Picker Button */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="px-2 py-1 bg-black/60 hover:bg-black/80 backdrop-blur text-white text-[10px] rounded-md border border-white/20 flex items-center gap-1 cursor-pointer"
                title="Kies cover afbeelding (JPG/PNG)"
              >
                <ImageIcon className="w-3 h-3" />
                <span>Cover wijzigen</span>
              </button>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
              />
            </div>

            {/* Live Subtitle Overlay on Video Screen */}
            <div className="absolute bottom-4 left-4 right-4 text-center z-10 pointer-events-none px-2">
              {activeCue ? (
                <div className="inline-block px-3 py-1.5 rounded-lg bg-black/75 backdrop-blur-sm border border-white/10 shadow-lg">
                  <p className="text-base sm:text-lg font-bold text-white tracking-wide drop-shadow-md">
                    {activeCue.text}
                  </p>
                  {activeCue.originalText && (
                    <p className="text-[11px] text-slate-300 italic opacity-85 mt-0.5">
                      {activeCue.originalText}
                    </p>
                  )}
                </div>
              ) : (
                <div className="inline-block px-2.5 py-1 rounded bg-black/40 text-[11px] text-slate-400 italic">
                  {isPlaying ? '♪ Muzikaal intermezzo ♪' : 'Gepauzeerd'}
                </div>
              )}
            </div>
          </div>

          {/* Media Player Scrubber & Transport Bar underneath Video */}
          <div className="pt-3 space-y-2">
            <div className="relative flex items-center">
              <input
                type="range"
                min={0}
                max={audioDuration || 100}
                step={0.05}
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow transition-transform active:scale-95 cursor-pointer"
                  title={isPlaying ? 'Pauzeer (Spatie)' : 'Afspelen (Spatie)'}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(0)}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                  title="Naar begin"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* Time Display */}
                <div className="font-mono text-xs tabular-nums text-slate-300 ml-1">
                  <span className="font-semibold text-white">{formatSecondsToSrt(currentTime)}</span>
                  <span className="text-slate-600 mx-1">/</span>
                  <span className="text-slate-400">{formatSecondsToSrt(audioDuration)}</span>
                </div>
              </div>

              {/* Volume & Speed Controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                  {[0.75, 1.0, 1.25, 1.5].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setPlaybackRate(rate)}
                      className={`px-1 rounded ${playbackRate === rate ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(parseFloat(e.target.value));
                      setIsMuted(false);
                    }}
                    className="w-14 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* BOTTOM WORKSPACE: THE REAL AUDIO WAVEFORM TIMELINE (Subtitle Edit)   */}
      {/* ==================================================================== */}
      <div className="bg-slate-950 flex flex-col select-none">
        {/* Waveform Viewport Header */}
        <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-slate-200">
              Audio Waveform &amp; Subtitle Blocks
            </span>
            <span className="text-slate-500 hidden sm:inline">&mdash;</span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              Sleep de <strong>blauwe blokken</strong> of trek aan de uiteinden &bull; Draai <strong>muiswiel vooruit / achteruit</strong> om over de tijdlijn te navigeren (of Ctrl+Wiel voor zoom)
            </span>
          </div>

          {/* Quick status of playhead & batch duration actions */}
          <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-slate-300">
            <button
              type="button"
              onClick={() => handleAddPaddingToAllCues(0.5)}
              className="px-2 py-0.5 bg-blue-950/80 hover:bg-blue-900 text-blue-200 border border-blue-500/40 rounded font-sans font-medium flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
              title="Voeg +0.5s zang-/leestijd toe aan het einde van alle regels zodat ze niet abrupt afbreken"
            >
              <Clock className="w-3 h-3 text-blue-400" />
              <span>+0.5s Duur aan Allen</span>
            </button>

            {decodedAudioBuffer && (
              <button
                type="button"
                onClick={handleSnapAllCuesToPeaks}
                className="px-2 py-0.5 bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-500/40 rounded font-sans font-medium flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                title="Lijn alle regels automatisch uit op de vocale pieken en zangdalen van de waveform"
              >
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Auto-Lijn Zang Uit</span>
              </button>
            )}

            {cues.length > 0 && currentTime > 1.5 && (
              <button
                type="button"
                onClick={handleShiftAllCuesToPlayhead}
                className="px-2 py-0.5 bg-amber-950/90 hover:bg-amber-900 text-amber-200 border border-amber-500/40 rounded font-sans font-medium flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                title={`Verschuif alle ${cues.length} regels zodat Regel #1 start op de huidige playhead (${formatTimeDisplay(currentTime)})`}
              >
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Zet Intro op {formatTimeDisplay(currentTime)}</span>
              </button>
            )}

            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow animate-pulse ml-1" />
            <span>Playhead: <strong className="text-white">{formatSecondsToSrt(currentTime)}</strong></span>
            {dragState && (
              <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold">
                Sleep Regel #{dragState.cueId}: {formatTimeDisplay(dragState.currStartTime)} &rarr; {formatTimeDisplay(dragState.currEndTime)} ({(dragState.currEndTime - dragState.currStartTime).toFixed(2)}s)
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Waveform Viewport (Fixed height h-52, NO vertical shake, locked overflow-y) */}
        <div
          ref={timelineViewportRef}
          className="relative h-52 w-full overflow-x-auto overflow-y-hidden bg-[#0a0e17] border-b border-slate-800 cursor-crosshair select-none"
          style={{ overscrollBehavior: 'none', touchAction: 'pan-x' }}
          onClick={handleTimelineTrackClick}
          onMouseMove={handleTimelineMouseMove}
          onMouseLeave={() => setHoverTimelineTime(null)}
        >
          {/* Inner Canvas Track container */}
          <div
            className="relative h-full"
            style={{ width: `${totalTimelineWidth}px` }}
          >
            {/* 1. Real Audio Waveform Canvas with true volume peaks */}
            <canvas
              ref={waveformCanvasRef}
              className="absolute top-2 left-0 pointer-events-none"
              style={{ width: `${totalTimelineWidth}px`, height: '126px' }}
            />

            {/* Visual Intro Banner if song has an instrumental lead-in */}
            {cues[0] && cues[0].startTime >= 2.5 && (
              <div
                style={{
                  left: '4px',
                  width: `${Math.max(48, cues[0].startTime * pixelsPerSecond - 8)}px`,
                }}
                className="absolute top-8 h-16 rounded-lg bg-amber-950/40 border border-amber-500/40 border-dashed flex flex-col items-center justify-center px-2 pointer-events-none z-10 shadow-sm"
                title={`Muzikaal intro / lead-in: ${cues[0].startTime.toFixed(1)} seconden`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">♪ Muzikaal Intro ({cues[0].startTime.toFixed(1)}s)</span>
                </div>
                <span className="text-[10px] text-amber-400/80 font-mono">Geen zang tot {formatTimeDisplay(cues[0].startTime)}</span>
              </div>
            )}

            {/* Visual Instrumental Break & Solo Banners between lyrics */}
            {cues.map((cue, idx) => {
              const nextCue = cues[idx + 1];
              if (!nextCue) return null;
              const gap = nextCue.startTime - cue.endTime;
              if (gap < 6.5) return null;
              const breakLeft = cue.endTime * pixelsPerSecond;
              const breakWidth = gap * pixelsPerSecond;
              return (
                <div
                  key={`break-${cue.id}-${nextCue.id}`}
                  style={{
                    left: `${breakLeft + 4}px`,
                    width: `${Math.max(50, breakWidth - 8)}px`,
                  }}
                  className="absolute top-8 h-16 rounded-lg bg-purple-950/45 border border-purple-500/40 border-dashed flex flex-col items-center justify-center px-2 pointer-events-none z-10 shadow-sm"
                  title={`Instrumentale break / solo: ${gap.toFixed(1)} seconden`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                    <Music className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">🎸 Solo / Break ({gap.toFixed(1)}s)</span>
                  </div>
                  <span className="text-[10px] text-purple-400/80 font-mono">Zang pauzeert</span>
                </div>
              );
            })}

            {/* 2. Subtitle Cue Blocks placed directly over the Waveform */}
            {cues.map((cue) => {
              const isBeingDragged = dragState?.cueId === cue.id;
              const displayStart = isBeingDragged ? dragState.currStartTime : cue.startTime;
              const displayEnd = isBeingDragged ? dragState.currEndTime : cue.endTime;
              const left = displayStart * pixelsPerSecond;
              const width = Math.max(22, (displayEnd - displayStart) * pixelsPerSecond);
              const isSelected = currentSelectedCue?.id === cue.id;
              const isActive = activeCue?.id === cue.id;
              const dur = displayEnd - displayStart;
              const charsPerSec = dur > 0 ? (cue.text.length / dur) : 0;

              return (
                <div
                  key={cue.id}
                  style={{ left: `${left}px`, width: `${width}px` }}
                  onMouseDown={(e) => handleBlockMouseDown(e, cue, 'move')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCue(cue.id);
                  }}
                  className={`absolute top-4 h-24 rounded-lg transition-all select-none border z-20 flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing ${
                    isBeingDragged
                      ? 'bg-blue-600/80 border-white shadow-2xl ring-2 ring-white/60 z-30'
                      : isSelected
                      ? 'bg-blue-600/60 border-blue-300 shadow-xl shadow-blue-950/70 ring-1 ring-blue-400'
                      : isActive
                      ? 'bg-indigo-600/50 border-indigo-400 shadow-md'
                      : 'bg-blue-950/75 border-blue-500/60 hover:bg-blue-900/70'
                  }`}
                  title={`Regel #${cue.id}: ${cue.text} (${formatSecondsToSrt(displayStart)} - ${formatSecondsToSrt(displayEnd)})`}
                >
                  {/* Left Resize Handle */}
                  <div
                    onMouseDown={(e) => handleBlockMouseDown(e, cue, 'left')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-0 bottom-0 left-0 w-3.5 bg-blue-400/40 hover:bg-white cursor-ew-resize flex items-center justify-center group-hover:bg-blue-400/70 z-30 transition-colors"
                    title="Sleep om beginpunt aan te passen"
                  >
                    <div className="w-[2px] h-5 bg-white/80 rounded-full" />
                  </div>

                  {/* Right Resize Handle */}
                  <div
                    onMouseDown={(e) => handleBlockMouseDown(e, cue, 'right')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-0 bottom-0 right-0 w-3.5 bg-blue-400/40 hover:bg-white cursor-ew-resize flex items-center justify-center group-hover:bg-blue-400/70 z-30 transition-colors"
                    title="Sleep om eindpunt aan te passen"
                  >
                    <div className="w-[2px] h-5 bg-white/80 rounded-full" />
                  </div>

                  {/* Content inside the block */}
                  <div className="p-2 pl-4 pr-4 pointer-events-none flex flex-col h-full justify-between">
                    {/* Top: Subtitle Text */}
                    <div className="font-bold text-xs text-white leading-tight drop-shadow-md line-clamp-2">
                      {cue.text}
                    </div>

                    {/* Bottom: ID, Duration, Speed */}
                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-blue-200">
                      <span>#{cue.id} {dur.toFixed(2)}s</span>
                      <span className={charsPerSec > 22 ? 'text-rose-300 font-bold' : 'text-blue-300'}>
                        {charsPerSec.toFixed(1)} c/s
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 3. Smooth Red/White Playhead vertical marker */}
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-rose-500 z-40 pointer-events-none shadow-lg shadow-rose-500/90"
              style={{ left: `${currentTime * pixelsPerSecond}px` }}
            >
              <div className="w-4 h-4 bg-rose-500 rounded-full -ml-[7px] -top-1 absolute shadow-md border-2 border-white" />
              <div className="absolute top-0 bottom-0 w-[1px] -left-[1px] bg-white/60" />
            </div>

            {/* 4. Hover time vertical guide */}
            {hoverTimelineTime !== null && (
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-white/40 z-30 pointer-events-none"
                style={{ left: `${hoverTimelineTime * pixelsPerSecond}px` }}
              >
                <div className="absolute bottom-8 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 tabular-nums -translate-x-1/2 shadow-lg">
                  {formatSecondsToSrt(hoverTimelineTime)}
                </div>
              </div>
            )}

            {/* 5. Bottom Time Ruler Seconds Markings (Pinned to bottom: 0) */}
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-slate-950 border-t border-slate-800 flex items-center font-mono text-[11px] text-slate-400 pointer-events-none z-10">
              {Array.from({ length: integerSecondsCount }).map((_, sec) => (
                <div
                  key={sec}
                  className="shrink-0 pl-1 border-l border-slate-700 text-[10px] tabular-nums"
                  style={{ width: `${pixelsPerSecond}px` }}
                >
                  {sec}s
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline Bottom Controls Toolbar */}
        <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Quick Actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onAddCue(cues.length - 1, currentTime)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Voeg nieuwe zin in op playhead"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>+ Regel op playhead</span>
            </button>

            {currentSelectedCue && (
              <>
                <button
                  type="button"
                  onClick={() => onSplitCue(currentSelectedCue.id, currentTime)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Splits geselecteerde regel op de witte playhead"
                >
                  <Split className="w-3.5 h-3.5 text-amber-400" />
                  <span>Splitsen</span>
                </button>

                {onSnapCueToPlayhead && (
                  <button
                    type="button"
                    onClick={() => onSnapCueToPlayhead(currentSelectedCue.id, currentTime)}
                    className="px-2.5 py-1.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-200 hover:text-white border border-emerald-500/40 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Start geselecteerde regel exact op de playhead positie"
                  >
                    <Pin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Snap naar playhead</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleShiftAllCuesToPlayhead}
                  className="px-2.5 py-1.5 bg-amber-950/90 hover:bg-amber-900 text-amber-200 hover:text-white border border-amber-500/50 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm text-xs"
                  title="Schuif álle regels door zodat Regel #1 exact start op de huidige playhead (bijv. 21s voor muzikaal intro)"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Zang start op Playhead</span>
                </button>

                {onInsertInstrumentalBreak && (
                  <button
                    type="button"
                    onClick={() => onInsertInstrumentalBreak(currentSelectedCue.id, 15)}
                    className="px-2.5 py-1.5 bg-purple-950 hover:bg-purple-900 text-purple-200 hover:text-white border border-purple-500/40 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Pauzeer zang voor solo: schuif vanaf deze regel +15s door"
                  >
                    <Music className="w-3.5 h-3.5 text-purple-400" />
                    <span>🎸 +15s Solo Break</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              disabled={isDetectingIntro}
              onClick={handleAutoDetectVocalIntro}
              className="px-2.5 py-1.5 bg-indigo-950 hover:bg-indigo-900 disabled:opacity-50 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm text-xs"
              title="Laat AI automatisch beluisteren waar de zang na het intro begint en schuif alle regels automatisch mee"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isDetectingIntro ? 'Intro zoeken...' : 'Auto-Detecteer Intro'}</span>
            </button>

            {onRepairMidSongGaps && (
              <button
                type="button"
                onClick={onRepairMidSongGaps}
                className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium flex items-center gap-1 text-xs cursor-pointer"
                title="Herstel onbedoelde gaten in het midden"
              >
                <Wand2 className="w-3 h-3 text-slate-400" />
                <span>Gat herstellen</span>
              </button>
            )}

            {decodedAudioBuffer && cues.length > 0 && (
              <button
                type="button"
                onClick={handleSnapAllCuesToPeaks}
                className="px-2.5 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-lg flex items-center gap-1.5 shadow-md shadow-amber-900/40 transition-all active:scale-95 cursor-pointer text-xs"
                title="Lijn alle regels haarscherp uit op de werkelijke audio-pieken van de zangstem"
              >
                <Zap className="w-3.5 h-3.5 fill-current text-slate-950" />
                <span>⚡ Snap Cues naar Pieken</span>
              </button>
            )}
          </div>

          {/* Right: Waveform Gain (Volume Amplification) & Zoom */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Auto-scroll toggle */}
            <label className="flex items-center gap-1.5 text-slate-400 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
              />
              <span className="font-medium text-slate-300">Auto-scroll</span>
            </label>

            {/* Waveform Peak Gain Slider (To see quiet vs loud parts clearly) */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-xs">
              <span className="text-amber-400 font-semibold text-[11px] flex items-center gap-1">
                <Activity className="w-3 h-3" />
                <span>Pieken (Gain):</span>
              </span>
              <input
                type="range"
                min={0.5}
                max={3.0}
                step={0.1}
                value={waveformGain}
                onChange={(e) => setWaveformGain(parseFloat(e.target.value))}
                className="w-16 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-500"
                title="Versterk de visualisatie van zachte en harde muziekpassages"
              />
              <span className="font-mono text-[10px] text-amber-300 w-8">
                {waveformGain.toFixed(1)}x
              </span>
            </div>

            {/* Timeline Horizontal Zoom Slider */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg">
              <button
                type="button"
                onClick={() => setPixelsPerSecond((p) => Math.max(50, p - 20))}
                className="p-1 text-slate-400 hover:text-white rounded"
                title="Zoom uit"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <input
                type="range"
                min={50}
                max={250}
                step={10}
                value={pixelsPerSecond}
                onChange={(e) => setPixelsPerSecond(parseInt(e.target.value, 10))}
                className="w-20 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
              />

              <button
                type="button"
                onClick={() => setPixelsPerSecond((p) => Math.min(250, p + 20))}
                className="p-1 text-slate-400 hover:text-white rounded"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <span className="font-mono text-[11px] text-slate-300 w-10 text-right">
                {Math.round((pixelsPerSecond / 100) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Studio Floating Feedback Toast */}
      {studioToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-amber-200 border border-amber-500/50 px-4 py-2 rounded-xl shadow-2xl text-xs font-semibold backdrop-blur-md flex items-center gap-2 animate-in fade-in duration-150">
          <Zap className="w-4 h-4 text-amber-400 fill-current" />
          <span>{studioToast}</span>
        </div>
      )}
    </div>
  );
};
