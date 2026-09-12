export type MediaFormat = 'mp4' | 'mp3' | 'm4a' | 'webm' | 'm3u8' | 'ts' | 'mkv';

export interface StreamVariant {
  qualityName: string; // e.g. '1080p', '720p', '480p', '360p'
  resolution: string; // e.g. '1920x1080', '1280x720'
  bandwidth: number;
  estimatedBytes?: number;
  url: string;
  label?: string;
}

export interface SniffedMedia {
  id: string;
  url: string;
  title: string;
  format: MediaFormat;
  quality: string; // e.g. '1080p Full HD', '720p HD', '480p SD', 'Adaptive HLS', 'MP3 Audio'
  estimatedSize: number; // in bytes
  headers: {
    referer?: string;
    userAgent?: string;
    cookies?: string;
    origin?: string;
    authorization?: string;
  };
  timestamp: number;
  thumbnail?: string;
  duration?: string;
  sourcePageUrl: string;
  isPendingEmbed?: boolean;
  isAudio?: boolean;
  variants?: StreamVariant[];
}

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  status: 'downloading' | 'paused' | 'completed' | 'pending' | 'error';
  speed: number; // bytes/sec
}

export interface DownloadItem {
  id: string;
  title: string;
  url: string;
  format: MediaFormat;
  quality: string;
  totalSize: number; // in bytes
  downloadedSize: number; // in bytes
  status: 'downloading' | 'paused' | 'completed' | 'canceled' | 'error';
  speed: number; // current speed in bytes/sec
  peakSpeed: number; // max speed recorded
  threadsCount: number;
  segments: DownloadSegment[];
  startedAt: number;
  completedAt?: number;
  blobUrl?: string;
  serverJobId?: string;
  isAudio?: boolean;
  headers: {
    referer?: string;
    userAgent?: string;
    cookies?: string;
  };
  thumbnail?: string;
  duration?: string;
  sourcePageUrl?: string;
  isHls?: boolean;
  hlsSegmentsTotal?: number;
  hlsSegmentsDone?: number;
  error?: string;
  availableVariants?: StreamVariant[];
}

export interface AppSettings {
  threadsCount: number; // 1 to 32
  userAgent: string;
  autoSniff: boolean;
  detectMp4: boolean;
  detectM3u8: boolean;
  detectWebm: boolean;
  detectTs: boolean;
  speedLimitEnabled: boolean;
  speedLimitKBps: number;
  soundNotification: boolean;
  defaultDownloadFolder: string;
  neonTheme: boolean;
  preferredQuality?: '480p' | '720p' | '1080p' | 'auto';
}
