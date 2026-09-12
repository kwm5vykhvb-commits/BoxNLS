import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav } from './components/BottomNav';
import { BrowserSniffer } from './components/BrowserSniffer';
import { DownloadsDashboard } from './components/DownloadsDashboard';
import { Navbar } from './components/Navbar';
import { QuickSniffDialog } from './components/QuickSniffDialog';
import { SettingsModal } from './components/SettingsModal';
import { SniffedMediaModal } from './components/SniffedMediaModal';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { SAMPLE_WEBSITES } from './data/sampleSites';
import { getVideoBlob } from './services/db';
import { DownloadEngine } from './services/downloadEngine';
import { 
  DEFAULT_SETTINGS, 
  loadDownloads, 
  loadSettings, 
  loadSniffedHistory, 
  saveDownloads, 
  saveSettings, 
  saveSniffedHistory 
} from './services/storage';
import { AppSettings, DownloadItem, SniffedMedia } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'browser' | 'downloads' | 'settings'>('browser');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [sniffedList, setSniffedList] = useState<SniffedMedia[]>(() => {
    const saved = loadSniffedHistory();
    return saved.length > 0 ? saved : SAMPLE_WEBSITES[0].videos;
  });

  // Active Downloads & Library (Only real user downloads, no fake items)
  const [downloads, setDownloads] = useState<DownloadItem[]>(loadDownloads);

  // Restore real video Blobs from IndexedDB for completed items
  useEffect(() => {
    const restoreBlobs = async () => {
      const items = loadDownloads();
      let hasUpdates = false;
      const updated = await Promise.all(
        items.map(async (item) => {
          if (item.status === 'completed' && !item.blobUrl) {
            const blob = await getVideoBlob(item.id);
            if (blob) {
              hasUpdates = true;
              return { ...item, blobUrl: URL.createObjectURL(blob), format: 'mp4', isHls: false };
            }
          }
          return item;
        })
      );
      if (hasUpdates) {
        setDownloads(updated);
      }
    };
    restoreBlobs();
  }, []);

  // Modal states
  const [isSniffedModalOpen, setIsSniffedModalOpen] = useState(false);
  const [isQuickSniffOpen, setIsQuickSniffOpen] = useState(false);
  const [activeVideoPlayer, setActiveVideoPlayer] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
    format: string;
    isHls: boolean;
    headers?: {
      referer?: string;
      userAgent?: string;
      cookies?: string;
    };
  }>({
    isOpen: false,
    url: '',
    title: '',
    format: 'mp4',
    isHls: false,
  });

  // Download Engine ref
  const engineRef = useRef<DownloadEngine | null>(null);

  // Initialize engine once
  useEffect(() => {
    const engine = new DownloadEngine(downloads, (updatedItems) => {
      setDownloads(updatedItems);
      saveDownloads(updatedItems);
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
    };
  }, []);

  // Save settings on change
  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // Add media detected by sniffer
  const handleMediaDetected = (media: SniffedMedia) => {
    setSniffedList((prev) => {
      if (prev.some((m) => m.url === media.url || m.id === media.id)) {
        return prev;
      }
      const updated = [media, ...prev];
      saveSniffedHistory(updated);
      return updated;
    });
  };

  // Start new download via engine
  const handleStartDownload = async (media: SniffedMedia, threadsCount?: number) => {
    if (!engineRef.current) return;
    let effectiveMedia = media;

    // If media is a pending embed or embed page, resolve it before starting download
    if (media.isPendingEmbed || media.url.includes('ansembed.net') || media.url.includes('embed') || media.url.includes('vidmoly') || media.url.includes('sibnet') || media.url.includes('voe')) {
      try {
        const res = await fetch('/api/resolve-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: media.url,
            referer: media.headers?.referer || media.sourcePageUrl,
            userAgent: media.headers?.userAgent || settings.userAgent,
          }),
        });
        const data = await res.json();
        if (data.success && data.streamUrl) {
          effectiveMedia = {
            ...media,
            url: data.streamUrl,
            format: data.format || media.format,
            quality: data.quality || media.quality,
            headers: data.headers || media.headers,
            sourcePageUrl: media.sourcePageUrl || media.url,
            isPendingEmbed: false,
          };
        }
      } catch (err) {
        console.warn('Auto resolve embed failed before download:', err);
      }
    }

    const threads = threadsCount || settings.threadsCount;
    const limit = settings.speedLimitEnabled ? settings.speedLimitKBps : 0;
    engineRef.current.createDownload(effectiveMedia, threads, limit);
    setActiveTab('downloads');
  };

  // Control handlers
  const handlePause = (id: string) => {
    engineRef.current?.pause(id);
  };

  const handleResume = (id: string) => {
    const limit = settings.speedLimitEnabled ? settings.speedLimitKBps : 0;
    engineRef.current?.resume(id, limit);
  };

  const handleCancel = (id: string) => {
    engineRef.current?.cancel(id);
  };

  const handleRetry = (id: string) => {
    const limit = settings.speedLimitEnabled ? settings.speedLimitKBps : 0;
    engineRef.current?.retry(id, limit);
  };

  const handleChangeQuality = (id: string, newQuality: string) => {
    const limit = settings.speedLimitEnabled ? settings.speedLimitKBps : 0;
    engineRef.current?.changeQuality(id, newQuality, limit);
  };

  const handleDeleteCompleted = (id: string) => {
    engineRef.current?.deleteCompleted(id);
  };

  const handleClearAllCompleted = () => {
    engineRef.current?.clearAllCompleted();
  };

  const handleResetData = () => {
    localStorage.clear();
    setSettings(DEFAULT_SETTINGS);
    setSniffedList(SAMPLE_WEBSITES[0].videos);
    window.location.reload();
  };

  // In-App Video Playback triggers
  const handlePlayDirect = async (media: SniffedMedia) => {
    let effectiveMedia = media;

    // If media is a pending embed or embed page, resolve it before playing
    if (media.isPendingEmbed || media.url.includes('ansembed.net') || media.url.includes('embed') || media.url.includes('vidmoly') || media.url.includes('sibnet') || media.url.includes('voe')) {
      try {
        const res = await fetch('/api/resolve-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: media.url,
            referer: media.headers?.referer || media.sourcePageUrl,
            userAgent: media.headers?.userAgent || settings.userAgent,
          }),
        });
        const data = await res.json();
        if (data.success && data.streamUrl) {
          effectiveMedia = {
            ...media,
            url: data.streamUrl,
            format: data.format || media.format,
            quality: data.quality || media.quality,
            headers: data.headers || media.headers,
            sourcePageUrl: media.sourcePageUrl || media.url,
            isPendingEmbed: false,
          };
        }
      } catch (err) {
        console.warn('Auto resolve embed failed before play:', err);
      }
    }

    setActiveVideoPlayer({
      isOpen: true,
      url: effectiveMedia.url,
      title: effectiveMedia.title,
      format: effectiveMedia.format,
      isHls: effectiveMedia.format === 'm3u8' || effectiveMedia.url.includes('.m3u8'),
      headers: effectiveMedia.headers,
    });
  };

  const handlePlayDownloadedVideo = async (item: DownloadItem) => {
    let playUrl = item.blobUrl;
    if (!playUrl) {
      const blob = await getVideoBlob(item.id);
      if (blob) {
        playUrl = URL.createObjectURL(blob);
      } else if (item.serverJobId) {
        playUrl = `/api/download/file/${item.serverJobId}`;
      } else {
        playUrl = item.url;
      }
    }

    const isDirectLocal = playUrl?.startsWith('blob:') || playUrl?.startsWith('/api/download/file');

    setActiveVideoPlayer({
      isOpen: true,
      url: playUrl || item.url,
      title: item.title,
      format: item.format || 'mp4',
      isHls: !isDirectLocal && (item.isHls || item.format === 'm3u8'),
      headers: item.headers,
    });
  };

  const activeDownloadsCount = downloads.filter((d) => d.status === 'downloading' || d.status === 'paused').length;
  const completedDownloadsCount = downloads.filter((d) => d.status === 'completed').length;
  const errorDownloadsCount = downloads.filter((d) => d.status === 'error').length;
  const totalSpeed = downloads
    .filter((d) => d.status === 'downloading')
    .reduce((acc, curr) => acc + (curr.speed || 0), 0);

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-[#F3F4F8] flex flex-col selection:bg-[#00F0FF]/30 selection:text-[#00F0FF]">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeDownloadsCount={activeDownloadsCount}
        totalSpeed={totalSpeed}
        onOpenQuickSniffer={() => setIsQuickSniffOpen(true)}
        sniffedCount={sniffedList.length}
        onOpenSniffedModal={() => setIsSniffedModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5">
        {activeTab === 'browser' && (
          <BrowserSniffer
            onMediaDetected={handleMediaDetected}
            onOpenSniffedModal={() => setIsSniffedModalOpen(true)}
            onStartDownload={handleStartDownload}
            onPlayDirect={handlePlayDirect}
            sniffedList={sniffedList}
            activeUserAgent={settings.userAgent}
          />
        )}

        {activeTab === 'downloads' && (
          <DownloadsDashboard
            downloads={downloads}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onChangeQuality={handleChangeQuality}
            onDeleteCompleted={handleDeleteCompleted}
            onClearAllCompleted={handleClearAllCompleted}
            onPlayDownloadedVideo={handlePlayDownloadedVideo}
            onSwitchToBrowser={() => setActiveTab('browser')}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsModal
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onResetData={handleResetData}
          />
        )}
      </main>

      {/* Floating Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeCount={activeDownloadsCount}
        completedCount={completedDownloadsCount}
        errorCount={errorDownloadsCount}
        totalSpeed={totalSpeed}
      />

      {/* Sniffed Media List Modal */}
      <SniffedMediaModal
        isOpen={isSniffedModalOpen}
        onClose={() => setIsSniffedModalOpen(false)}
        mediaList={sniffedList}
        onStartDownload={handleStartDownload}
        onPlayMedia={handlePlayDirect}
        onClearList={() => {
          setSniffedList([]);
          saveSniffedHistory([]);
        }}
        defaultThreads={settings.threadsCount}
      />

      {/* In-App Video Player */}
      <VideoPlayerModal
        isOpen={activeVideoPlayer.isOpen}
        onClose={() => setActiveVideoPlayer((prev) => ({ ...prev, isOpen: false }))}
        videoUrl={activeVideoPlayer.url}
        videoTitle={activeVideoPlayer.title}
        format={activeVideoPlayer.format}
        isHls={activeVideoPlayer.isHls}
        headers={activeVideoPlayer.headers}
      />

      {/* Quick URL Sniff Interceptor */}
      <QuickSniffDialog
        isOpen={isQuickSniffOpen}
        onClose={() => setIsQuickSniffOpen(false)}
        onStartDownload={handleStartDownload}
        onPlayDirect={handlePlayDirect}
        userAgent={settings.userAgent}
      />
    </div>
  );
}
