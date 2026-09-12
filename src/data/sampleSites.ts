import { SniffedMedia } from '../types';

export interface WebSiteCategory {
  id: string;
  name: string;
  url: string;
  badge: string;
  description: string;
  videos: SniffedMedia[];
}

export const SAMPLE_WEBSITES: WebSiteCategory[] = [
  {
    id: 'open-video',
    name: 'Vidéos Ouvertes (CDN Haute Vitesse)',
    url: 'https://vjs.zencdn.net',
    badge: 'MP4 & WebM Réels',
    description: 'Flux vidéo directs hébergés sur CDN mondiaux avec support HTTP Range complet.',
    videos: [
      {
        id: 'real-mp4-oceans',
        title: 'Oceans - Exploration Marine HD (MP4)',
        url: 'https://vjs.zencdn.net/v/oceans.mp4',
        format: 'mp4',
        quality: '1080p Full HD',
        estimatedSize: 23014356, // Exact 23.01 MB
        headers: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        },
        timestamp: Date.now() - 60000,
        thumbnail: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&auto=format&fit=crop&q=80',
        duration: '00:46',
        sourcePageUrl: 'https://vjs.zencdn.net',
      },
      {
        id: 'real-webm-bunny',
        title: 'Big Buck Bunny - Open Movie (Wikimedia WebM)',
        url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.360p.vp9.webm',
        format: 'webm',
        quality: '720p VP9',
        estimatedSize: 56976536, // Exact 56.97 MB
        headers: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
          referer: 'https://commons.wikimedia.org',
        },
        timestamp: Date.now() - 120000,
        thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
        duration: '09:56',
        sourcePageUrl: 'https://commons.wikimedia.org',
      },
      {
        id: 'real-mp4-flower',
        title: 'Nature & Flore Macro (MDN Sample MP4)',
        url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        format: 'mp4',
        quality: '720p HD',
        estimatedSize: 1128375, // Exact 1.12 MB
        headers: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        },
        timestamp: Date.now() - 180000,
        thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
        duration: '00:05',
        sourcePageUrl: 'https://developer.mozilla.org',
      },
    ],
  },
  {
    id: 'hls-streams',
    name: 'Flux Publics HLS (.m3u8)',
    url: 'https://test-streams.mux.dev',
    badge: 'Segments TS Réels',
    description: 'Playlists M3U8 avec fragments vidéo MPEG-TS réels téléchargeables en multi-thread.',
    videos: [
      {
        id: 'real-hls-mux',
        title: 'Mux Live Test Stream - Multi-Bitrate HLS',
        url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        format: 'm3u8',
        quality: 'Adaptive HLS (1080p / 720p / 480p)',
        estimatedSize: 28500000,
        headers: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
        },
        timestamp: Date.now() - 240000,
        thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
        duration: '04:30',
        sourcePageUrl: 'https://mux.com',
      },
      {
        id: 'real-hls-apple',
        title: 'Apple BiP Bop VOD Stream (Apple CDN)',
        url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
        format: 'm3u8',
        quality: 'Adaptive HLS TS',
        estimatedSize: 32000000,
        headers: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        },
        timestamp: Date.now() - 300000,
        thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80',
        duration: '30:00',
        sourcePageUrl: 'https://developer.apple.com',
      },
    ],
  },
  {
    id: 'anime-sama',
    name: 'Anime-Sama (Baskup Tony Parker)',
    url: 'https://anime-sama.to/catalogue/baskup-tony-parker/saison1/vf/',
    badge: '26 Épisodes 1080p',
    description: 'Extraction automatique d\'épisodes VidMoly / ansembed en haute résolution 1080p Full HD avec contournement 403.',
    videos: [],
  },
];
