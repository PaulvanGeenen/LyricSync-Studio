export interface CoverPreset {
  id: string;
  name: string;
  genre: string;
  generateDataUrl: () => string;
}

/**
 * Generates an SVG data URL for a stylish album cover preset
 */
export const COVER_PRESETS: CoverPreset[] = [
  {
    id: 'neon-synth',
    name: 'Neon Horizon',
    genre: 'Synthwave & Pop',
    generateDataUrl: () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
        <defs>
          <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0b001a" />
            <stop offset="60%" stop-color="#2d0b5a" />
            <stop offset="100%" stop-color="#fd297b" />
          </linearGradient>
          <linearGradient id="sun" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffef78" />
            <stop offset="50%" stop-color="#ff3864" />
            <stop offset="100%" stop-color="#7b00ff" />
          </linearGradient>
          <linearGradient id="grid" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ff3864" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#050014" stop-opacity="0.95" />
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#sky)" />
        <circle cx="540" cy="560" r="260" fill="url(#sun)" />
        <rect y="640" width="1080" height="440" fill="url(#grid)" />
        <g stroke="#00f6ff" stroke-width="2" opacity="0.6">
          <line x1="540" y1="640" x2="540" y2="1080" stroke-width="3" />
          <line x1="540" y1="640" x2="100" y2="1080" stroke-width="2.5" />
          <line x1="540" y1="640" x2="980" y2="1080" stroke-width="2.5" />
          <line x1="540" y1="640" x2="-200" y2="1080" />
          <line x1="540" y1="640" x2="1280" y2="1080" />
          <line x1="0" y1="680" x2="1080" y2="680" />
          <line x1="0" y1="730" x2="1080" y2="730" />
          <line x1="0" y1="800" x2="1080" y2="800" />
          <line x1="0" y1="900" x2="1080" y2="900" stroke-width="3" />
          <line x1="0" y1="1020" x2="1080" y2="1020" stroke-width="3" />
        </g>
        <text x="540" y="240" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="8">LYRICSYNC STUDIO</text>
        <text x="540" y="300" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#00f6ff" text-anchor="middle" letter-spacing="4">ORIGINAL SOUNDTRACK</text>
      </svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  },
  {
    id: 'golden-hour',
    name: 'Gouden Uur Ballad',
    genre: 'Akoestisch & Ballad',
    generateDataUrl: () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
        <defs>
          <linearGradient id="warmSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#141e30" />
            <stop offset="45%" stop-color="#e65c00" />
            <stop offset="75%" stop-color="#f9d423" />
            <stop offset="100%" stop-color="#f8b195" />
          </linearGradient>
          <linearGradient id="mountains" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#1f1c2c" />
            <stop offset="100%" stop-color="#0b0914" />
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#warmSky)" />
        <circle cx="540" cy="520" r="140" fill="#fff9e6" opacity="0.9" />
        <polygon points="0,780 320,520 640,820" fill="url(#mountains)" opacity="0.85" />
        <polygon points="360,840 760,460 1080,820" fill="url(#mountains)" opacity="0.95" />
        <polygon points="120,920 540,600 960,940" fill="url(#mountains)" />
        <rect y="840" width="1080" height="240" fill="#0b0914" />
        <text x="540" y="210" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="6">ONDER DE STERREN</text>
        <text x="540" y="270" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="500" fill="#ffd59e" text-anchor="middle" letter-spacing="4">NEDERPOP & BALLADS</text>
      </svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  },
  {
    id: 'classic-vinyl',
    name: 'Classic Vinyl',
    genre: 'Retro & Rock',
    generateDataUrl: () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
        <defs>
          <radialGradient id="disc" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#f5d061" />
            <stop offset="28%" stop-color="#e08f24" />
            <stop offset="30%" stop-color="#111111" />
            <stop offset="42%" stop-color="#1a1a1a" />
            <stop offset="50%" stop-color="#111111" />
            <stop offset="65%" stop-color="#242424" />
            <stop offset="75%" stop-color="#111111" />
            <stop offset="85%" stop-color="#1e1e1e" />
            <stop offset="96%" stop-color="#0a0a0a" />
            <stop offset="100%" stop-color="#000000" />
          </radialGradient>
        </defs>
        <rect width="1080" height="1080" fill="#0c0d11" />
        <circle cx="540" cy="540" r="480" fill="url(#disc)" stroke="#262833" stroke-width="6" />
        <circle cx="540" cy="540" r="160" fill="#b93b2a" stroke="#ffffff" stroke-width="4" />
        <circle cx="540" cy="540" r="30" fill="#0c0d11" />
        <circle cx="540" cy="540" r="320" fill="none" stroke="#333333" stroke-width="1.5" opacity="0.6" />
        <circle cx="540" cy="540" r="380" fill="none" stroke="#333333" stroke-width="1.5" opacity="0.6" />
        <circle cx="540" cy="540" r="440" fill="none" stroke="#333333" stroke-width="1.5" opacity="0.6" />
        <text x="540" y="525" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="2">SIDE A</text>
        <text x="540" y="565" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="700" fill="#ffdfba" text-anchor="middle" letter-spacing="3">45 RPM STEREO</text>
        <text x="540" y="140" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="800" fill="#f5d061" text-anchor="middle" letter-spacing="8">CLASSIC SESSIONS</text>
      </svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  },
  {
    id: 'cosmic-galaxy',
    name: 'Cosmic Galaxy',
    genre: 'Ambient & Electronic',
    generateDataUrl: () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
        <defs>
          <linearGradient id="deepSpace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#020024" />
            <stop offset="40%" stop-color="#090979" />
            <stop offset="70%" stop-color="#4a0e4e" />
            <stop offset="100%" stop-color="#ff007f" />
          </linearGradient>
        </defs>
        <rect width="1080" height="1080" fill="url(#deepSpace)" />
        <circle cx="180" cy="240" r="2" fill="#fff" />
        <circle cx="340" cy="180" r="3" fill="#fff" opacity="0.9" />
        <circle cx="520" cy="310" r="1.5" fill="#fff" />
        <circle cx="780" cy="220" r="2.5" fill="#fff" />
        <circle cx="920" cy="380" r="3" fill="#fff" opacity="0.8" />
        <circle cx="140" cy="740" r="2" fill="#fff" />
        <circle cx="280" cy="880" r="3" fill="#fff" />
        <circle cx="720" cy="820" r="2" fill="#fff" />
        <circle cx="890" cy="710" r="3.5" fill="#fff" />
        <circle cx="540" cy="540" r="220" fill="none" stroke="#00f2fe" stroke-width="4" opacity="0.8" />
        <circle cx="540" cy="540" r="290" fill="none" stroke="#4facfe" stroke-width="2" opacity="0.6" stroke-dasharray="10 15" />
        <polygon points="540,360 680,630 400,630" fill="none" stroke="#ff0844" stroke-width="4" opacity="0.9" />
        <text x="540" y="780" font-family="system-ui, -apple-system, sans-serif" font-size="46" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="8">NEBULA SOUNDS</text>
        <text x="540" y="835" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#00f2fe" text-anchor="middle" letter-spacing="6">AUDIO EXPERIENCE</text>
      </svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  },
];
