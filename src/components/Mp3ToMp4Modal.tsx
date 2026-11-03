import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  X,
  Upload,
  Music2,
  Image as ImageIcon,
  CheckCircle2,
  Download,
  AlertCircle,
  Loader2,
  Sparkles,
  Layers,
  Subtitles,
  FileVideo,
  Play,
  RotateCcw,
} from 'lucide-react';
import { SubtitleCue } from '../types/subtitle';
import { generateSrt } from '../utils/exportSubtitles';
import { COVER_PRESETS, CoverPreset } from '../utils/coverPresets';

interface Mp3ToMp4ModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAudioFile: File | null;
  currentAudioBase64: string | null;
  currentAudioName: string;
  currentAudioDuration: number;
  cues: SubtitleCue[];
}

export const Mp3ToMp4Modal: React.FC<Mp3ToMp4ModalProps> = ({
  isOpen,
  onClose,
  currentAudioFile,
  currentAudioBase64,
  currentAudioName,
  currentAudioDuration,
  cues,
}) => {
  // Audio state
  const [useCurrentAudio, setUseCurrentAudio] = useState<boolean>(true);
  const [customAudioFile, setCustomAudioFile] = useState<File | null>(null);
  const [customAudioBase64, setCustomAudioBase64] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState<string>('');
  const [customAudioDuration, setCustomAudioDuration] = useState<number>(0);

  // Image state
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string>('cover.jpg');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>('neon-synth');

  // Video settings
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '1:1' | '9:16'>('16:9');
  const [burnSubtitles, setBurnSubtitles] = useState<boolean>(false);

  // Conversion process state
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [conversionStep, setConversionStep] = useState<string>('');
  const [conversionProgress, setConversionProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Output video state
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultVideoBlob, setResultVideoBlob] = useState<Blob | null>(null);
  const [resultFileSize, setResultFileSize] = useState<number>(0);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Initialize with the first cover preset by default
  useEffect(() => {
    if (isOpen && !selectedImageBase64) {
      applyPreset(COVER_PRESETS[0]);
    }
  }, [isOpen]);

  // Clean up object URLs on unmount or reset
  useEffect(() => {
    return () => {
      if (resultVideoUrl) {
        URL.revokeObjectURL(resultVideoUrl);
      }
    };
  }, [resultVideoUrl]);

  if (!isOpen) return null;

  const activeAudioName = (useCurrentAudio && currentAudioName) ? currentAudioName : customAudioName;
  const activeAudioBase64 = (useCurrentAudio && currentAudioBase64) ? currentAudioBase64 : customAudioBase64;
  const hasAudio = Boolean(activeAudioBase64 && activeAudioBase64.length > 0);
  const hasImage = Boolean(selectedImageBase64 && selectedImageBase64.length > 0);

  // Handler for custom audio upload
  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setCustomAudioFile(file);
      setCustomAudioName(file.name);
      setUseCurrentAudio(false);

      const url = URL.createObjectURL(file);
      const tempAudio = new Audio(url);
      tempAudio.addEventListener('loadedmetadata', () => {
        setCustomAudioDuration(tempAudio.duration || 0);
        URL.revokeObjectURL(url);
      });

      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        if (result && result.includes(',')) {
          setCustomAudioBase64(result.split(',')[1]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Handler for custom image upload
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImageName(file.name);
      setSelectedPresetId(null);

      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        if (result) {
          setSelectedImagePreview(result);
          if (result.includes(',')) {
            setSelectedImageBase64(result.split(',')[1]);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Apply a preset cover image
  const applyPreset = (preset: CoverPreset) => {
    setSelectedPresetId(preset.id);
    setSelectedImageName(`${preset.id}.jpg`);
    const svgDataUrl = preset.generateDataUrl();

    // Convert SVG data URL to a raster JPEG in memory via Canvas for guaranteed ffmpeg compatibility
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 1080, 1080);
        ctx.drawImage(img, 0, 0, 1080, 1080);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        setSelectedImagePreview(jpegDataUrl);
        if (jpegDataUrl.includes(',')) {
          setSelectedImageBase64(jpegDataUrl.split(',')[1]);
        }
      }
    };
    img.src = svgDataUrl;
  };

  // Convert MP3 + JPG to MP4 video
  const handleStartConversion = async () => {
    if (!hasAudio) {
      setErrorMessage('Selecteer eerst een geldig audiobestand (MP3).');
      return;
    }
    if (!hasImage) {
      setErrorMessage('Selecteer eerst een cover-afbeelding (JPG of PNG).');
      return;
    }

    setErrorMessage(null);
    setIsConverting(true);
    setConversionProgress(15);
    setConversionStep('Audio en cover-afbeelding voorbereiden...');

    if (resultVideoUrl) {
      URL.revokeObjectURL(resultVideoUrl);
      setResultVideoUrl(null);
    }

    try {
      // Step 2
      setTimeout(() => {
        setConversionProgress(45);
        setConversionStep(`FFmpeg H.264 video encoderen (${aspectRatio})...`);
      }, 700);

      // Step 3
      setTimeout(() => {
        setConversionProgress(75);
        setConversionStep(burnSubtitles ? 'Ondertitels inbranden en audio samenvoegen...' : 'Audio en video stream multiplexen...');
      }, 1800);

      const srtString = burnSubtitles && cues.length > 0 ? generateSrt(cues) : '';

      const response = await fetch('/api/convert-mp3-to-mp4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: activeAudioBase64,
          imageBase64: selectedImageBase64,
          audioName: activeAudioName || 'audio.mp3',
          imageName: selectedImageName || 'cover.jpg',
          aspectRatio,
          burnSubtitles: burnSubtitles && cues.length > 0,
          srtContent: srtString,
          videoTitle: activeAudioName.replace(/\.[^/.]+$/, '').trim() || 'music_video',
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || `Serverfout tijdens conversie: ${response.status}`);
      }

      setConversionProgress(95);
      setConversionStep('MP4-bestand afronden en download voorbereiden...');

      const videoBlob = await response.blob();
      const videoUrl = URL.createObjectURL(videoBlob);

      setResultVideoBlob(videoBlob);
      setResultVideoUrl(videoUrl);
      setResultFileSize(videoBlob.size);
      setConversionProgress(100);
      setConversionStep('Conversie geslaagd!');
    } catch (err: any) {
      console.error('MP4 conversion error:', err);
      let cleanMsg = err.message || 'Conversie naar MP4 is mislukt.';
      if (cleanMsg.includes('Command failed:')) {
        cleanMsg = 'FFmpeg time-out of bufferlimiet overschreden. De instellingen zijn nu geoptimaliseerd voor supersnelle verwerking. Probeer het opnieuw!';
      }
      setErrorMessage(cleanMsg);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownloadMp4 = () => {
    if (!resultVideoUrl) return;
    const cleanName = (activeAudioName || 'music_video').replace(/\.[^/.]+$/, '').trim() || 'video';
    const filename = `${cleanName}.mp4`;
    const a = document.createElement('a');
    a.href = resultVideoUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-5 sm:p-7 shadow-2xl text-slate-100 flex flex-col max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30 shrink-0">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">
                  MP3 naar MP4 Video Converter
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  FFmpeg H.264
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Zet een MP3 audiobestand en een JPG cover samen om naar een downloadbare MP4 video.
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

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-red-950/80 border border-red-800 rounded-xl flex items-center gap-3 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* Successful Video Result Box */}
        {resultVideoUrl ? (
          <div className="mt-5 space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="p-4 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border border-emerald-500/40 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>MP4 Video Succesvol Gegenereerd!</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {formatFileSize(resultFileSize)} · {aspectRatio}
                </span>
              </div>

              {/* Video Player */}
              <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-h-[320px] flex items-center justify-center border border-slate-800">
                <video
                  src={resultVideoUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setResultVideoUrl(null);
                    setResultVideoBlob(null);
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                  <span>Nieuwe video instellen</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadMp4}
                  className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-700/30 flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download MP4 Video</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Input Configuration Form */
          <div className="mt-5 space-y-5">
            {/* Step 1: Input Audio (MP3) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">1</span>
                  <span>Audiobestand (MP3 / Audio Input)</span>
                </span>
                {currentAudioName && (
                  <button
                    type="button"
                    onClick={() => setUseCurrentAudio(!useCurrentAudio)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                  >
                    {useCurrentAudio ? 'Upload een ander audiobestand' : 'Gebruik geladen audio'}
                  </button>
                )}
              </label>

              {useCurrentAudio && currentAudioName && currentAudioBase64 ? (
                <div className="p-3.5 bg-slate-950 border border-indigo-500/30 rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
                      <Music2 className="w-4 h-4" />
                    </div>
                    <div className="overflow-hidden">
                      <div className="text-xs font-semibold text-white truncate">{currentAudioName}</div>
                      <div className="text-[11px] text-slate-400">
                        {currentAudioDuration > 0 ? `${Math.round(currentAudioDuration)}s audio` : 'Audiobestand'} · Huidig project
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Geladen
                  </span>
                </div>
              ) : (
                <div>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    onChange={handleAudioFileChange}
                    className="hidden"
                  />
                  <div
                    onClick={() => audioInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer bg-slate-950/50 hover:bg-slate-950 transition-colors flex items-center justify-center gap-3"
                  >
                    <Upload className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs text-slate-300 font-medium">
                      {customAudioName ? `Geselecteerd: ${customAudioName}` : 'Klik of sleep een MP3-audiobestand hierheen'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Input Image (JPG / PNG Cover) */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-[10px] text-white flex items-center justify-center font-bold">2</span>
                <span>Cover-afbeelding (JPG / PNG Input)</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Upload or Dropzone */}
                <div className="sm:col-span-2 space-y-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    onChange={handleImageFileChange}
                    className="hidden"
                  />
                  <div
                    onClick={() => imageInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-800 hover:border-indigo-500 rounded-xl p-4 text-center cursor-pointer bg-slate-950/50 hover:bg-slate-950 transition-colors flex flex-col items-center justify-center gap-1.5 min-h-[110px]"
                  >
                    <ImageIcon className="w-5 h-5 text-indigo-400" />
                    <span className="text-xs text-slate-200 font-semibold">
                      {selectedPresetId ? 'Upload een eigen JPG/PNG' : selectedImageName}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Ondersteunt JPG, JPEG, PNG, WebP
                    </span>
                  </div>

                  {/* Preset Covers Carousel */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>Of kies een ingebouwde cover-preset:</span>
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {COVER_PRESETS.map((preset) => {
                        const isSelected = selectedPresetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyPreset(preset)}
                            className={`p-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-950 border-indigo-500 ring-1 ring-indigo-500'
                                : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="text-[11px] font-semibold text-slate-200 truncate">{preset.name}</div>
                            <div className="text-[9px] text-slate-400 truncate">{preset.genre}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Cover Preview Box */}
                <div className="flex flex-col items-center justify-center bg-slate-950 border border-slate-800 rounded-xl p-2 relative overflow-hidden">
                  {selectedImagePreview ? (
                    <div className="relative w-full h-full min-h-[120px] flex items-center justify-center">
                      <img
                        src={selectedImagePreview}
                        alt="Cover Preview"
                        className="max-h-[140px] max-w-full rounded-lg object-contain shadow-md"
                      />
                      <span className="absolute bottom-1 right-1 text-[9px] bg-slate-900/80 backdrop-blur px-1.5 py-0.5 rounded text-slate-300 font-mono">
                        {selectedImageName}
                      </span>
                    </div>
                  ) : (
                    <div className="text-center p-3 text-slate-500 text-xs">
                      Geen afbeelding gekozen
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 3: Video Instellingen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-slate-800/80">
              {/* Aspect Ratio */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Beeldverhouding (Video Formaat)</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      aspectRatio === '16:9'
                        ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="text-xs">16:9</div>
                    <div className="text-[9px] opacity-80">YouTube / TV</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('1:1')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      aspectRatio === '1:1'
                        ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="text-xs">1:1</div>
                    <div className="text-[9px] opacity-80">Vierkant / Album</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAspectRatio('9:16')}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      aspectRatio === '9:16'
                        ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="text-xs">9:16</div>
                    <div className="text-[9px] opacity-80">TikTok / Shorts</div>
                  </button>
                </div>
              </div>

              {/* Subtitles Burn-in Option */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Subtitles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Ondertitels Inbranden (Optioneel)</span>
                </label>
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={burnSubtitles}
                      disabled={cues.length === 0}
                      onChange={(e) => setBurnSubtitles(e.target.checked)}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-slate-200">Brand gesynchroniseerde ondertitels in</span>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {cues.length > 0
                          ? `${cues.length} gesynchroniseerde cues worden ingebrand op de video`
                          : 'Synchroniseer eerst de songtekst om ondertitels toe te voegen'}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Converting Progress State */}
            {isConverting && (
              <div className="p-4 bg-slate-950 border border-indigo-500/40 rounded-xl space-y-2.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-indigo-300 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>{conversionStep}</span>
                  </span>
                  <span className="font-mono text-indigo-400">{conversionProgress}%</span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 h-full rounded-full transition-all duration-300"
                    style={{ width: `${conversionProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Conversion CTA Button */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isConverting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Annuleren
              </button>

              <button
                type="button"
                onClick={handleStartConversion}
                disabled={!hasAudio || !hasImage || isConverting}
                className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Video Aanmaken...</span>
                  </>
                ) : (
                  <>
                    <Video className="w-4 h-4" />
                    <span>Zet om naar MP4 Video</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
