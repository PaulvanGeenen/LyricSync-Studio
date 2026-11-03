import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Sparkles, Music, Waves, Cpu, BookOpen } from 'lucide-react';
import { SyncProgressState, SupportedLanguage } from '../types/subtitle';

interface SyncProgressModalProps {
  progressState: SyncProgressState;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage | null;
}

export const SyncProgressModal: React.FC<SyncProgressModalProps> = ({
  progressState,
  sourceLanguage,
  targetLanguage,
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let timer: any;
    if (progressState.isSyncing) {
      setElapsed(0);
      timer = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [progressState.isSyncing]);

  if (!progressState.isSyncing) return null;

  const isTranslating = Boolean(
    targetLanguage && sourceLanguage !== targetLanguage
  );

  const steps = isTranslating
    ? [
        {
          id: 1,
          title: 'Zorgvuldige Poëtische Vertaling',
          desc: `Literair vertalen van ${sourceLanguage === 'nl' ? 'Nederlands' : 'Engels'} naar ${targetLanguage === 'nl' ? 'Nederlands' : 'Engels'} met behoud van kracht en emotie`,
          icon: BookOpen,
        },
        {
          id: 2,
          title: 'Audio Spectrum & Beat Grid',
          desc: 'Analyseren van frequentiepatronen en muzikale dynamiek',
          icon: Waves,
        },
        {
          id: 3,
          title: 'Multimodale AI-Tijduitlijning',
          desc: 'Zanginzetten en fraselabs synchroniseren met Gemini 3.8 Flash',
          icon: Cpu,
        },
        {
          id: 4,
          title: 'Ondertitelsegmentatie & Quantisatie',
          desc: `Definitieve SRT/VTT tijdstempels genereren met taalsuffix _${(targetLanguage || 'en').toUpperCase()}`,
          icon: Sparkles,
        },
      ]
    : [
        {
          id: 1,
          title: 'Audio Spectrum Ingestion',
          desc: 'Decoding audio frequency waves and rhythm beats',
          icon: Waves,
        },
        {
          id: 2,
          title: 'Phonetic & Vocal Cadence',
          desc: `Processing lyrical tokens in ${targetLanguage === 'nl' ? 'Dutch' : 'English'}`,
          icon: Music,
        },
        {
          id: 3,
          title: 'AI Temporal Alignment',
          desc: 'Synchronizing vocal onsets and phrase boundaries with Gemini 3.8 Flash',
          icon: Cpu,
        },
        {
          id: 4,
          title: 'Cue Quantization & Verification',
          desc: `Building millisecond timestamps for _${(targetLanguage || 'en').toUpperCase()} output`,
          icon: Sparkles,
        },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 md:p-8 shadow-2xl text-slate-100 relative overflow-hidden">
        {/* Subtle accent glow */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="text-center space-y-2 mb-6">
          <div className="inline-flex p-3 rounded-xl bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 mb-1">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <h3 className="text-xl font-bold tracking-tight text-white">
            {isTranslating
              ? 'Songtekst Vertalen & Synchroniseren'
              : 'Synchronizing Lyrics to Audio'}
          </h3>
          <p className="text-xs text-slate-400">
            {isTranslating
              ? 'Zorgvuldige vertaling met behoud van de essentie en timing-uitlijning'
              : 'Analyzing audio harmonics and vocal boundaries in real-time'}
          </p>
        </div>

        {/* Dynamic Progress Bar */}
        <div className="space-y-2 mb-6">
          <div className="flex justify-between items-center text-xs font-mono text-slate-400">
            <span className="truncate pr-2">{progressState.stepLabel}</span>
            <span className="tabular-nums font-semibold text-indigo-400 shrink-0">
              {progressState.progressPercent}% · {elapsed}s
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${progressState.progressPercent}%` }}
            />
          </div>
        </div>

        {/* Step-by-Step Milestones */}
        <div className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            const isCompleted = progressState.step > step.id;
            const isCurrent = progressState.step === step.id;

            return (
              <div
                key={step.id}
                className={`p-3 rounded-lg border flex items-center gap-3 transition-colors ${
                  isCurrent
                    ? 'border-indigo-500/50 bg-indigo-950/20'
                    : isCompleted
                    ? 'border-slate-800/80 bg-slate-950/40 opacity-80'
                    : 'border-slate-800/40 bg-slate-950/20 opacity-40'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                    isCompleted
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : isCurrent
                      ? 'bg-indigo-600 text-white animate-pulse'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-200">{step.title}</p>
                  <p className="text-[11px] text-slate-400 truncate">{step.desc}</p>
                </div>

                {isCurrent && (
                  <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider shrink-0">
                    Actief
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          Dit duurt doorgaans 6 tot 18 seconden afhankelijk van de liedlengte.
        </p>
      </div>
    </div>
  );
};
