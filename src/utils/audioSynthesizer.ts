import { DemoTrack } from '../types/subtitle';

export const DEMO_TRACKS: DemoTrack[] = [
  {
    id: 'demo-en',
    title: 'Neon Highway',
    artist: 'Luna Horizon',
    language: 'en',
    genre: 'Synthwave / Retro Pop',
    tempo: 110,
    lyrics: `Riding through the neon lights tonight
City skyline shining oh so bright
Electric rhythm in the midnight air
Leaving all our worries way back there
We accelerate into the groove
Feel the bassline start to make you move
Chasing horizons until the dawn
The road is open and the night is young`,
  },
  {
    id: 'demo-nl',
    title: 'Onder De Sterren',
    artist: 'Pieter van Dijk',
    language: 'nl',
    genre: 'Nederpop Ballad',
    tempo: 96,
    lyrics: `De avond valt zacht over de stad
De mooiste herinnering die ik had
We lopen samen langs de gracht
Verlicht door sterren in de nacht
De wind vertelt een oud verhaal
Van liefde in een eigen taal
Morgen wacht maar nu zijn wij
Voor altijd samen zij aan zij`,
  },
];

/**
 * Encodes raw audio buffer into standard 16-bit PCM WAV Blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length * blockAlign;
  const bufferArray = new ArrayBuffer(44 + length);
  const view = new DataView(bufferArray);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write interleaved channel PCM
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }

  return new Blob([bufferArray], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Synthesizes a melodic 28-second demo music track using Web Audio API
 */
export async function synthesizeDemoTrack(trackId: 'demo-en' | 'demo-nl'): Promise<{ blob: Blob; base64: string; duration: number }> {
  const sampleRate = 44100;
  const duration = 28; // 28 seconds
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });

  const numSamples = Math.floor(sampleRate * duration);
  const audioBuffer = audioContext.createBuffer(2, numSamples, sampleRate);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  const isDutch = trackId === 'demo-nl';
  // Chords progression
  // EN: Am - F - C - G (Synthwave)
  // NL: C - G - Am - F (Acoustic ballad feeling)
  const chords = isDutch
    ? [
        [261.63, 329.63, 392.00], // C
        [196.00, 246.94, 293.66], // G
        [220.00, 261.63, 329.63], // Am
        [174.61, 220.00, 261.63], // F
      ]
    : [
        [220.00, 261.63, 329.63], // Am
        [174.61, 220.00, 261.63], // F
        [261.63, 329.63, 392.00], // C
        [196.00, 246.94, 293.66], // G
      ];

  const chordDur = 3.5; // seconds per chord
  const bpm = isDutch ? 96 : 112;
  const beatInterval = 60 / bpm;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    if (t >= duration) break;

    // Chord index
    const chordIndex = Math.floor((t % (chordDur * chords.length)) / chordDur);
    const chord = chords[chordIndex];

    let sampleL = 0;
    let sampleR = 0;

    // 1. Pad Chords (smooth warmth)
    for (let f = 0; f < chord.length; f++) {
      const freq = chord[f];
      // Subtle detune for lushness
      const osc1 = Math.sin(2 * Math.PI * freq * t);
      const osc2 = Math.sin(2 * Math.PI * (freq * 1.003) * t);
      sampleL += (osc1 * 0.08) + (osc2 * 0.04);
      sampleR += (osc2 * 0.08) + (osc1 * 0.04);
    }

    // 2. Bass note (subtle 808 or sub bass)
    const rootFreq = chord[0] / 2;
    const bassEnv = Math.exp(-((t % beatInterval) * 3));
    const bass = Math.sin(2 * Math.PI * rootFreq * t) * (0.15 + 0.1 * bassEnv);
    sampleL += bass;
    sampleR += bass;

    // 3. Drum beat (Kick on beat 1 & 3, Snare on beat 2 & 4, Hi-hat on 8ths)
    const beatTime = t % beatInterval;
    const beatNumber = Math.floor(t / beatInterval) % 4;

    // Kick
    if (beatNumber === 0 || beatNumber === 2) {
      if (beatTime < 0.12) {
        const kickFreq = 120 * Math.exp(-beatTime * 35) + 40;
        const kick = Math.sin(2 * Math.PI * kickFreq * beatTime) * Math.exp(-beatTime * 20);
        sampleL += kick * 0.25;
        sampleR += kick * 0.25;
      }
    }

    // Snare / Rimshot
    if (beatNumber === 1 || beatNumber === 3) {
      if (beatTime < 0.15) {
        const noise = (Math.random() * 2 - 1) * Math.exp(-beatTime * 22);
        const tone = Math.sin(2 * Math.PI * 180 * beatTime) * Math.exp(-beatTime * 15);
        sampleL += (noise * 0.12 + tone * 0.08);
        sampleR += (noise * 0.12 + tone * 0.08);
      }
    }

    // Hi-hat tick
    const subBeatTime = t % (beatInterval / 2);
    if (subBeatTime < 0.04) {
      const hihat = (Math.random() * 2 - 1) * Math.exp(-subBeatTime * 80);
      sampleL += hihat * 0.05;
      sampleR += hihat * 0.05;
    }

    // 4. Arpeggiator melody
    const arpNotes = [chord[0], chord[1], chord[2], chord[1] * 2];
    const arpIdx = Math.floor((t / (beatInterval / 2)) % arpNotes.length);
    const arpFreq = arpNotes[arpIdx];
    const arpTime = t % (beatInterval / 2);
    const arpEnv = Math.exp(-arpTime * 10);
    const arp = Math.sin(2 * Math.PI * arpFreq * t) * arpEnv * 0.07;
    sampleL += arp * 0.7;
    sampleR += arp * 0.3;

    // Fade in at start, fade out at end
    let masterVol = 1.0;
    if (t < 0.5) masterVol = t / 0.5;
    if (t > duration - 1.5) masterVol = Math.max(0, (duration - t) / 1.5);

    left[i] = sampleL * masterVol;
    right[i] = sampleR * masterVol;
  }

  const wavBlob = audioBufferToWav(audioBuffer);

  // Convert Blob to Base64
  const arrayBuffer = await wavBlob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let j = 0; j < len; j++) {
    binary += String.fromCharCode(bytes[j]);
  }
  const base64 = window.btoa(binary);

  audioContext.close();

  return {
    blob: wavBlob,
    base64,
    duration,
  };
}
