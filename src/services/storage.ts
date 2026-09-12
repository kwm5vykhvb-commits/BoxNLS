import { AppSettings, DownloadItem, SniffedMedia } from '../types';

const STORAGE_KEYS = {
  SETTINGS: 'nlsbox_settings',
  DOWNLOADS: 'nlsbox_downloads',
  SNIFFED_HISTORY: 'nlsbox_sniffed_history',
  MEDIA_LIBRARY: 'nlsbox_library',
};

export const DEFAULT_SETTINGS: AppSettings = {
  threadsCount: 8,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; 1DM+ NLSbox/6.0) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
  autoSniff: true,
  detectMp4: true,
  detectM3u8: true,
  detectWebm: true,
  detectTs: true,
  speedLimitEnabled: false,
  speedLimitKBps: 0,
  soundNotification: true,
  defaultDownloadFolder: '/Internal Storage/NLSbox/Video',
  neonTheme: true,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings to localStorage', err);
  }
}

export function loadDownloads(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOWNLOADS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveDownloads(downloads: DownloadItem[]): void {
  try {
    // Avoid saving large blob URLs or huge states to localStorage
    const sanitized = downloads.map(d => ({
      ...d,
      speed: d.status === 'completed' ? 0 : d.speed,
    }));
    localStorage.setItem(STORAGE_KEYS.DOWNLOADS, JSON.stringify(sanitized));
  } catch (err) {
    console.error('Failed to save downloads to localStorage', err);
  }
}

export function loadSniffedHistory(): SniffedMedia[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SNIFFED_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveSniffedHistory(items: SniffedMedia[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SNIFFED_HISTORY, JSON.stringify(items.slice(0, 50)));
  } catch (err) {
    console.error('Failed to save sniffed history', err);
  }
}
