import React, { useState } from 'react';
import { 
  AlertCircle, 
  Check, 
  CheckCircle2, 
  Clock, 
  Download, 
  Eye, 
  Film, 
  FolderDown, 
  HelpCircle,
  Layers, 
  Maximize2, 
  MoreVertical, 
  Pause, 
  Play, 
  Plus, 
  RefreshCw, 
  RotateCcw, 
  Share2,
  ShieldCheck, 
  Smartphone,
  Sparkles, 
  Trash2, 
  X, 
  Zap 
} from 'lucide-react';
import { DownloadItem } from '../types';
import { formatDate, formatBytes, formatEta, formatSpeed } from '../utils/formatters';
import { getVideoBlob } from '../services/db';

interface DownloadsDashboardProps {
  downloads: DownloadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onChangeQuality?: (id: string, newQuality: string) => void;
  onDeleteCompleted: (id: string) => void;
  onClearAllCompleted: () => void;
  onPlayDownloadedVideo: (item: DownloadItem) => void;
  onSwitchToBrowser: () => void;
}

export const DownloadsDashboard: React.FC<DownloadsDashboardProps> = ({
  downloads,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onChangeQuality,
  onDeleteCompleted,
  onClearAllCompleted,
  onPlayDownloadedVideo,
  onSwitchToBrowser,
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'errors' | 'completed'>('active');
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const activeDownloads = downloads.filter((d) => d.status === 'downloading' || d.status === 'paused');
  const completedDownloads = downloads.filter((d) => d.status === 'completed');
  const errorDownloads = downloads.filter((d) => d.status === 'error');

  const totalActiveSpeed = activeDownloads.reduce((acc, curr) => acc + (curr.speed || 0), 0);
  const totalDownloadedBytes = downloads.reduce((acc, curr) => acc + curr.downloadedSize, 0);

  // Universal export tailored for iOS iPhone / iPad (Photos app via Web Share) and desktop
  const handleSaveToDisk = async (item: DownloadItem) => {
    setExportingId(item.id);
    try {
      const cleanName = (item.title || 'media')
        .replace(/[^\w\s\u00C0-\u017F-]/gi, '')
        .trim()
        .replace(/\s+/g, '_') || 'media';
      const isAudio = item.isAudio || item.format === 'mp3' || item.format === 'm4a';
      const ext = item.format === 'mp3' ? 'mp3' : item.format === 'm4a' ? 'm4a' : item.format === 'webm' ? 'webm' : 'mp4';
      const fileName = `${cleanName}.${ext}`;
      const mimeType = item.format === 'mp3' ? 'audio/mpeg' : item.format === 'm4a' ? 'audio/mp4' : item.format === 'webm' ? 'video/webm' : 'video/mp4';

      // 1. Instant local export if file is already on the device (OPFS/RAM)
      if (item.blobUrl) {
        try {
          // Native Share Sheet (Save to Photos on iOS)
          if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
            const res = await fetch(item.blobUrl);
            const blob = await res.blob();
            const file = new File([blob], fileName, { type: mimeType });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: item.title,
                text: `Enregistrer ${item.title}`,
              });
              setExportNotice(`Partage iOS ouvert ! Touchez « Enregistrer la vidéo » pour l'ajouter à vos Photos.`);
              setTimeout(() => setExportNotice(null), 8000);
              setExportingId(null);
              return;
            }
          }
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
             setExportingId(null);
             return;
          }
          console.warn('Native share sheet cancelled or unsupported, fallback to file download:', shareErr);
        }

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        if (!isIOS) {
          const a = document.createElement('a');
          a.href = item.blobUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 100);
          
          setExportNotice(`Fichier exporté vers vos Fichiers !`);
          setTimeout(() => setExportNotice(null), 5000);
          setExportingId(null);
          return;
        } else {
          console.warn('iOS detecté: évitement du bug .html sur Blob URL. Basculement vers le serveur.');
          // Ne retourne pas, laisse l'exécution continuer vers le directUrl (téléchargement serveur)
        }
      }

      // 2. Fallback to Safari native download from server
      const directUrl = item.serverJobId
        ? `/api/download/file/${item.serverJobId}?export=1`
        : `/api/export-direct-mp4?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(cleanName)}&referer=${encodeURIComponent(item.headers.referer || '')}&sourcePageUrl=${encodeURIComponent(item.sourcePageUrl || '')}`;
      
      // Prevent white page: Ensure the file still exists on the server
      if (item.serverJobId) {
        try {
          const headRes = await fetch(directUrl, { method: 'HEAD' });
          if (!headRes.ok) {
             alert("⚠️ Le fichier a expiré sur le serveur. Veuillez relancer le téléchargement.");
             setExportingId(null);
             return;
          }
        } catch {}
      }

      // Safely trigger download without changing window location (no white page)
      const a = document.createElement('a');
      a.href = directUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 100);
      
      setExportNotice(`Téléchargement Safari lancé ! Regardez la flèche bleue dans Safari.`);
      setTimeout(() => setExportNotice(null), 5000);
      
    } catch (err) {
      console.warn('Could not trigger disk save automatically:', err);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Top Telemetry Header & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Total Speed */}
        <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-4 flex items-center justify-between shadow-lg">
          <div>
            <div className="text-xs text-[#9496A1] font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>Vitesse Globale (1DM)</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-[#00F0FF] mt-1">
              {formatSpeed(totalActiveSpeed)}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center">
            <Zap className={`w-5 h-5 text-[#00F0FF] ${totalActiveSpeed > 0 ? 'animate-pulse' : ''}`} />
          </div>
        </div>

        {/* Card 2: Active Threads & Downloads */}
        <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-4 flex items-center justify-between shadow-lg">
          <div>
            <div className="text-xs text-[#9496A1] font-medium flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#7000FF]" />
              <span>Téléchargements en cours</span>
            </div>
            <div className="text-xl font-extrabold text-white mt-1">
              {activeDownloads.length}{' '}
              <span className="text-xs font-normal text-[#9496A1]">
                ({activeDownloads.reduce((a, b) => a + b.threadsCount, 0)} threads actifs)
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#7000FF]/10 border border-[#7000FF]/30 flex items-center justify-center">
            <Download className="w-5 h-5 text-[#7000FF]" />
          </div>
        </div>

        {/* Card 3: Storage & Library */}
        <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-4 flex items-center justify-between shadow-lg">
          <div>
            <div className="text-xs text-[#9496A1] font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF9D]" />
              <span>Bibliothèque Terminée</span>
            </div>
            <div className="text-xl font-extrabold text-white mt-1">
              {completedDownloads.length}{' '}
              <span className="text-xs font-normal text-[#9496A1]">
                ({formatBytes(totalDownloadedBytes)})
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#00FF9D]/10 border border-[#00FF9D]/30 flex items-center justify-center">
            <FolderDown className="w-5 h-5 text-[#00FF9D]" />
          </div>
        </div>
      </div>

      {/* Alert Banner if any download failed */}
      {errorDownloads.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h5 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{errorDownloads.length} téléchargement{errorDownloads.length > 1 ? 's ont' : ' a'} échoué</span>
              </h5>
              <p className="text-xs text-[#9496A1] mt-0.5">
                Le lien ou le jeton de la vidéo a peut-être expiré sur l hébergeur. Cliquez sur « Tout relancer » pour rafraîchir automatiquement le flux.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              onClick={() => {
                errorDownloads.forEach((d) => onRetry(d.id));
              }}
              className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tout relancer</span>
            </button>
            <button
              onClick={() => setActiveTab('errors')}
              className="px-3.5 py-1.5 rounded-xl bg-[#232332] hover:bg-[#2C2C3E] text-[#F3F4F8] font-medium text-xs transition-colors"
            >
              Voir les détails
            </button>
          </div>
        </div>
      )}

      {/* Tabs Switcher: [ En cours ] vs [ Erreurs ] vs [ Terminés ] */}
      <div className="flex items-center justify-between bg-[#16161E] border border-[#232332] rounded-2xl p-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setActiveTab('active')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'active'
                ? 'bg-gradient-to-r from-[#7000FF]/40 to-[#00F0FF]/30 text-[#00F0FF] border border-[#00F0FF]/40 shadow-sm'
                : 'text-[#9496A1] hover:text-white'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>En cours ({activeDownloads.length})</span>
          </button>

          {errorDownloads.length > 0 && (
            <button
              onClick={() => setActiveTab('errors')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'errors'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-sm'
                  : 'text-rose-400/80 hover:text-rose-300'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Erreurs ({errorDownloads.length})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('completed')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'completed'
                ? 'bg-gradient-to-r from-[#7000FF]/40 to-[#00F0FF]/30 text-[#00F0FF] border border-[#00F0FF]/40 shadow-sm'
                : 'text-[#9496A1] hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Terminés ({completedDownloads.length})</span>
          </button>
        </div>

        {activeTab === 'completed' && completedDownloads.length > 0 && (
          <button
            onClick={onClearAllCompleted}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#9496A1] hover:text-rose-400 hover:bg-[#232332] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tout effacer</span>
          </button>
        )}
      </div>

      {/* TAB 1: En cours */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {activeDownloads.length === 0 ? (
            <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-12 text-center text-[#9496A1] space-y-4">
              <Download className="w-12 h-12 mx-auto text-[#232332]" />
              <div>
                <h4 className="font-bold text-base text-white">Aucun téléchargement en cours</h4>
                <p className="text-xs text-[#9496A1] mt-1 max-w-md mx-auto">
                  Utilisez le navigateur pour intercepter des flux vidéo (.mp4, .m3u8 HLS) ou collez directement un lien vidéo.
                </p>
              </div>
              <button
                onClick={onSwitchToBrowser}
                className="px-4 py-2 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#0B0B0E] font-bold text-xs shadow-lg shadow-[#00F0FF]/20 transition-all inline-flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                <span>Ouvrir le Sniffer Média</span>
              </button>
            </div>
          ) : (
            activeDownloads.map((item) => {
              const progress = item.isHls && item.hlsSegmentsTotal && item.hlsSegmentsTotal > 0
                ? Math.min(100, Math.round(((item.hlsSegmentsDone || 0) / item.hlsSegmentsTotal) * 100))
                : Math.min(100, Math.round((item.downloadedSize / (item.totalSize || 1)) * 100)) || 0;
              const isPaused = item.status === 'paused';
              const isExpanded = expandedDetailsId === item.id;

              return (
                <div
                  key={item.id}
                  className="bg-[#16161E] border border-[#232332] hover:border-[#00F0FF]/40 rounded-2xl p-4 sm:p-5 shadow-xl transition-all space-y-4"
                >
                  {/* Card Top Row: Thumbnail, Title, Controls */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-16 h-12 bg-[#0B0B0E] rounded-xl overflow-hidden shrink-0 border border-[#232332]">
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film className="w-5 h-5 text-[#00F0FF]" />
                          </div>
                        )}
                        <span className="absolute bottom-0.5 right-0.5 px-1 rounded text-[8px] font-bold uppercase bg-black/80 text-[#00F0FF]">
                          {item.format}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-white truncate max-w-md">{item.title}</h4>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[#7000FF]/30 text-[#00F0FF] border border-[#7000FF]/40 shrink-0">
                            {item.quality}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#9496A1] mt-1 font-mono">
                          <span>
                            {formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}
                          </span>
                          <span>•</span>
                          <span className="text-[#00F0FF] font-bold">
                            {item.serverJobId
                              ? '⚡ Moteur Turbo FFmpeg'
                              : item.isHls
                              ? 'HLS Multi-Segments'
                              : `${item.threadsCount} Threads Range`}
                          </span>
                          {item.isHls && !item.serverJobId && (
                            <>
                              <span>•</span>
                              <span className="text-amber-400 font-semibold">
                                {item.hlsSegmentsDone || 0}/{item.hlsSegmentsTotal || 0} Chunks
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {!isPaused && (
                        <button
                          onClick={() => onRetry(item.id)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-xs border border-amber-500/30 transition-all shadow-sm"
                          title="Relancer en mode Turbo direct (~30s sans transcodage)"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400 fill-current" />
                          <span>Relancer Turbo</span>
                        </button>
                      )}

                      {isPaused ? (
                        <button
                          onClick={() => onResume(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#00FF9D] hover:bg-[#26FFAA] text-[#0B0B0E] font-bold text-xs shadow-md transition-all"
                          title="Reprendre le téléchargement"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Reprendre</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => onPause(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#232332] hover:bg-[#2C2C3E] text-white font-medium text-xs transition-colors"
                          title="Mettre en pause"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </button>
                      )}

                      <button
                        onClick={() => onCancel(item.id)}
                        className="p-1.5 rounded-xl bg-[#16161E] hover:bg-rose-500/20 text-[#9496A1] hover:text-rose-400 border border-[#232332] transition-colors"
                        title="Annuler le téléchargement"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar & Telemetry Details */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className={`font-extrabold ${isPaused ? 'text-[#9496A1]' : 'text-[#00F0FF]'}`}>
                          {progress}%
                        </span>
                        <span className="text-[#9496A1]">
                          {isPaused ? 'En pause' : `Vitesse: ${formatSpeed(item.speed)}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[#9496A1]">
                        <Clock className="w-3 h-3" />
                        <span>ETA: {isPaused ? '--:--' : formatEta(item.totalSize, item.downloadedSize, item.speed)}</span>
                      </div>
                    </div>

                    {/* Main Progress track */}
                    <div className="relative w-full h-2.5 bg-[#0B0B0E] rounded-full overflow-hidden border border-[#232332]">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isPaused
                            ? 'bg-[#9496A1]'
                            : 'bg-gradient-to-r from-[#7000FF] via-[#00F0FF] to-[#00FF9D]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Format & Quality Selector Bar (Lighter Options) */}
                  <div className="bg-[#111118] border border-[#232332] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#00F0FF] shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">Changer de Format / Qualité :</span>
                          {item.totalSize > 400000000 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Fichier lourd ({formatBytes(item.totalSize)})
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#9496A1]">
                          Passez en 480p ou 720p pour un fichier 2x à 4x plus léger
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* 480p SD - Éco Data */}
                      <button
                        onClick={() => onChangeQuality?.(item.id, '480p')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          item.quality.toLowerCase().includes('480')
                            ? 'bg-[#00FF9D] text-[#0B0B0E] font-bold shadow-md shadow-[#00FF9D]/20'
                            : 'bg-[#16161E] text-[#9496A1] hover:text-white hover:border-[#00FF9D]/40 border border-[#232332]'
                        }`}
                        title="Télécharger en 480p SD (~150 Mo - Très léger)"
                      >
                        <span>🍃 480p SD</span>
                        <span className="text-[10px] opacity-80 font-mono">
                          ({formatBytes(item.availableVariants?.find((v) => v.qualityName === '480p')?.estimatedBytes || Math.round(item.totalSize * 0.25))})
                        </span>
                      </button>

                      {/* 720p HD - Équilibré */}
                      <button
                        onClick={() => onChangeQuality?.(item.id, '720p')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          item.quality.toLowerCase().includes('720')
                            ? 'bg-[#00F0FF] text-[#0B0B0E] font-bold shadow-md shadow-[#00F0FF]/20'
                            : 'bg-[#16161E] text-[#9496A1] hover:text-white hover:border-[#00F0FF]/40 border border-[#232332]'
                        }`}
                        title="Télécharger en 720p HD (~350 Mo - Équilibré)"
                      >
                        <span>⚡ 720p HD</span>
                        <span className="text-[10px] opacity-80 font-mono">
                          ({formatBytes(item.availableVariants?.find((v) => v.qualityName === '720p')?.estimatedBytes || Math.round(item.totalSize * 0.5))})
                        </span>
                      </button>

                      {/* 1080p FHD - Max */}
                      <button
                        onClick={() => onChangeQuality?.(item.id, '1080p')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          item.quality.toLowerCase().includes('1080')
                            ? 'bg-[#7000FF] text-white font-bold shadow-md shadow-[#7000FF]/20'
                            : 'bg-[#16161E] text-[#9496A1] hover:text-white hover:border-[#7000FF]/40 border border-[#232332]'
                        }`}
                        title="Télécharger en 1080p Full HD (~700 Mo - Haute fidélité)"
                      >
                        <span>💎 1080p Max</span>
                        <span className="text-[10px] opacity-80 font-mono">
                          ({formatBytes(item.availableVariants?.find((v) => v.qualityName === '1080p')?.estimatedBytes || item.totalSize)})
                        </span>
                      </button>

                      {/* 360p Mobile */}
                      <button
                        onClick={() => onChangeQuality?.(item.id, '360p')}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          item.quality.toLowerCase().includes('360')
                            ? 'bg-amber-400 text-[#0B0B0E] font-bold shadow-md shadow-amber-400/20'
                            : 'bg-[#16161E] text-[#9496A1] hover:text-white hover:border-amber-400/40 border border-[#232332]'
                        }`}
                        title="Télécharger en 360p (~95 Mo - Ultra léger)"
                      >
                        <span>📱 360p</span>
                        <span className="text-[10px] opacity-80 font-mono">
                          ({formatBytes(item.availableVariants?.find((v) => v.qualityName === '360p')?.estimatedBytes || Math.round(item.totalSize * 0.15))})
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 1DM Multi-Segment Visualization Strip */}
                  <div className="bg-[#0B0B0E] rounded-xl p-3 border border-[#232332] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-[#9496A1]">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#00F0FF]" />
                        <span>
                          {item.serverJobId
                            ? `Moteur Turbo FFmpeg Actif (${progress}% • Stream Copy sans perte)`
                            : item.isHls
                            ? `Téléchargement Parallèle (${item.hlsSegmentsDone || 0}/${item.hlsSegmentsTotal || 0} chunks)`
                            : `Segmentation Multi-Thread IDM (${item.segments.length} segments actifs)`}
                        </span>
                      </span>
                      <button
                        onClick={() => setExpandedDetailsId(isExpanded ? null : item.id)}
                        className="text-[#00F0FF] hover:underline"
                      >
                        {isExpanded ? 'Masquer détails' : 'Détails des threads'}
                      </button>
                    </div>

                    {/* Visual Segment Strip */}
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                      {item.segments.map((seg) => {
                        const segTotal = Math.max(1, seg.endByte - seg.startByte);
                        const segDone = Math.max(0, seg.currentByte - seg.startByte);
                        const segPct = Math.min(100, Math.round((segDone / segTotal) * 100)) || 0;
                        const isDone = seg.status === 'completed' || segPct >= 100;

                        return (
                          <div
                            key={seg.id}
                            className="bg-[#16161E] rounded-md p-1 border border-[#232332] flex flex-col justify-between h-9"
                            title={`Thread #${seg.id}: ${segPct}%`}
                          >
                            <div className="flex items-center justify-between text-[8px] font-mono leading-none">
                              <span className="text-[#9496A1]">T{seg.id}</span>
                              <span className={isDone ? 'text-[#00FF9D]' : 'text-[#00F0FF]'}>{segPct}%</span>
                            </div>
                            <div className="w-full h-1 bg-[#0B0B0E] rounded-full overflow-hidden mt-1">
                              <div
                                className={`h-full transition-all ${
                                  isDone ? 'bg-[#00FF9D]' : 'bg-[#00F0FF]'
                                }`}
                                style={{ width: `${segPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Detailed Segment breakdown on expand */}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-[#232332] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                        {item.segments.map((s) => (
                          <div key={s.id} className="flex items-center justify-between px-2 py-1 bg-[#16161E] rounded">
                            <span className="text-white font-bold">Thread #{s.id}</span>
                            <span className="text-[#9496A1]">
                              {item.isHls ? `Worker #${s.id} actif` : `Range: [${formatBytes(s.startByte)} - ${formatBytes(s.endByte)}]`}
                            </span>
                            <span className="text-[#00F0FF]">{formatSpeed(s.speed)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB: Erreurs */}
      {activeTab === 'errors' && (
        <div className="space-y-4">
          {errorDownloads.length === 0 ? (
            <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-12 text-center text-[#9496A1] space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-[#00FF9D]" />
              <h4 className="font-bold text-base text-white">Aucune erreur détectée</h4>
              <p className="text-xs text-[#9496A1]">
                Tous vos téléchargements s exécutent normalement sans interruption de flux.
              </p>
            </div>
          ) : (
            errorDownloads.map((item) => (
              <div
                key={item.id}
                className="bg-[#16161E] border border-rose-500/40 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative w-16 h-12 bg-[#0B0B0E] rounded-xl overflow-hidden shrink-0 border border-rose-500/30">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-5 h-5 text-rose-400" />
                        </div>
                      )}
                      <span className="absolute bottom-0.5 right-0.5 px-1 rounded text-[8px] font-bold uppercase bg-black/80 text-rose-400">
                        {item.format}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-white truncate max-w-md">{item.title}</h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0">
                          Échec
                        </span>
                      </div>
                      <div className="text-xs text-rose-300/90 mt-1 flex items-center gap-1.5 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        <span>{item.error || 'Erreur réseau ou lien source expiré'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => onRetry(item.id)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-[#7000FF] hover:from-rose-600 hover:to-[#6000DF] text-white font-bold text-xs shadow-md transition-all"
                      title="Actualise le flux et relance le téléchargement"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Réessayer (Auto-refresh)</span>
                    </button>
                    <button
                      onClick={() => onCancel(item.id)}
                      className="p-1.5 rounded-xl bg-[#16161E] hover:bg-rose-500/20 text-[#9496A1] hover:text-rose-400 border border-[#232332] transition-colors"
                      title="Supprimer cette tâche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {item.sourcePageUrl && (
                  <div className="text-[11px] text-[#9496A1] bg-[#0B0B0E] p-2.5 rounded-xl border border-[#232332] flex items-center justify-between gap-2">
                    <span className="truncate">Source : {item.sourcePageUrl}</span>
                    <span className="text-[#00F0FF] shrink-0 font-medium">Auto-token refresh prêt</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: Terminés (Bibliothèque de fichiers) */}
      {activeTab === 'completed' && (
        <div className="space-y-4">
          {completedDownloads.length === 0 ? (
            <div className="bg-[#16161E] border border-[#232332] rounded-2xl p-12 text-center text-[#9496A1] space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-[#232332]" />
              <h4 className="font-bold text-base text-white">Aucun fichier téléchargé</h4>
              <p className="text-xs text-[#9496A1]">
                Vos vidéos téléchargées apparaîtront ici avec possibilité de lecture in-app et export direct.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {completedDownloads.map((item) => (
                <div
                  key={item.id}
                  className="bg-[#16161E] border border-[#232332] hover:border-[#00FF9D]/40 rounded-2xl p-4 shadow-xl flex flex-col justify-between space-y-3 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    {/* Thumbnail with Play Icon */}
                    <div 
                      onClick={() => onPlayDownloadedVideo(item)}
                      className="relative w-24 h-20 bg-[#0B0B0E] rounded-xl overflow-hidden shrink-0 border border-[#232332] cursor-pointer group/thumb"
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-8 h-8 text-[#00FF9D]" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                        <Play className="w-6 h-6 fill-current text-[#00FF9D]" />
                      </div>
                      <span className="absolute bottom-1 right-1 px-1 rounded text-[9px] font-bold uppercase bg-black/80 text-[#00FF9D]">
                        {item.format}
                      </span>
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <h4 className="font-semibold text-xs sm:text-sm text-white line-clamp-2 leading-snug">
                          {item.title}
                        </h4>
                        <button
                          onClick={() => onDeleteCompleted(item.id)}
                          className="p-1 text-[#9496A1] hover:text-rose-400 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-[#9496A1]">
                        <span className="font-mono text-white font-medium">{formatBytes(item.totalSize)}</span>
                        <span>•</span>
                        <span className="text-[#00F0FF] font-medium">{item.quality}</span>
                        {item.completedAt && (
                          <>
                            <span>•</span>
                            <span>{formatDate(item.completedAt)}</span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1 mt-1 text-[10px] text-[#00FF9D]">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Téléchargement complet intègre</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-[#232332]">
                    <button
                      onClick={() => onPlayDownloadedVideo(item)}
                      className="flex-1 py-2 px-3 rounded-xl bg-[#00FF9D] hover:bg-[#26FFAA] text-[#0B0B0E] font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Lire hors-ligne</span>
                    </button>
                    
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <button
                        onClick={() => handleSaveToDisk(item)}
                        disabled={exportingId === item.id}
                        className="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#0090FF] hover:from-[#20FFFF] hover:to-[#00B0FF] text-black text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
                      >
                        <FolderDown className="w-4 h-4" />
                        <span>{exportingId === item.id ? 'Préparation...' : 'Exporter'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating Export Notice Toast */}
      {exportNotice && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md bg-[#16161E] border border-[#00FF9D] rounded-2xl p-4 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#00FF9D]/20 text-[#00FF9D] flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="flex-1 text-xs">
              <p className="text-white font-bold leading-tight">Exportation Vidéo Réussie</p>
              <p className="text-[#9496A1] mt-1">{exportNotice}</p>
              <button 
                onClick={() => setShowIosGuide(true)}
                className="text-[#00F0FF] hover:underline font-semibold mt-1.5 flex items-center gap-1"
              >
                <HelpCircle className="w-3 h-3" />
                <span>Voir comment l'ajouter à vos Photos iPhone</span>
              </button>
            </div>
            <button 
              onClick={() => setExportNotice(null)}
              className="text-[#9496A1] hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* iOS iPhone Guide Modal */}
      {showIosGuide && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#16161E] border border-[#232332] rounded-3xl max-w-md w-full p-6 shadow-2xl relative space-y-5">
            <button
              onClick={() => setShowIosGuide(false)}
              className="absolute top-5 right-5 p-2 rounded-xl bg-[#0B0B0E] text-[#9496A1] hover:text-white border border-[#232332] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#00F0FF]/10 border border-[#00F0FF]/30 flex items-center justify-center text-[#00F0FF]">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Guide iPhone & iPad</h3>
                <p className="text-xs text-[#9496A1]">Lecture hors-ligne & sauvegarde Photos</p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-[#0B0B0E] rounded-2xl border border-[#232332] flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#00F0FF]/20 text-[#00F0FF] font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                <div>
                  <p className="font-semibold text-white">Exportation en vrai fichier MP4</p>
                  <p className="text-[#9496A1] mt-0.5">
                    NLSbox convertit et nomme automatiquement votre vidéo avec l'extension <strong className="text-[#00FF9D]">.mp4</strong> universelle (jamais de playlist .m3u8).
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-[#0B0B0E] rounded-2xl border border-[#232332] flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#00FF9D]/20 text-[#00FF9D] font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                <div>
                  <p className="font-semibold text-white">Application Fichiers iOS</p>
                  <p className="text-[#9496A1] mt-0.5">
                    Sur votre iPhone, ouvrez l'application <strong>Fichiers</strong> &rarr; <strong>Téléchargements</strong>. Votre vidéo MP4 complète y est stockée.
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-[#0B0B0E] rounded-2xl border border-[#232332] flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[#7000FF]/20 text-[#7000FF] font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                <div>
                  <p className="font-semibold text-white">Ajouter à la pellicule Photos</p>
                  <p className="text-[#9496A1] mt-0.5">
                    Ouvrez la vidéo dans Fichiers, touchez l'icône de partage <Share2 className="w-3 h-3 inline text-[#00F0FF] mx-0.5" /> puis sélectionnez <strong>« Enregistrer la vidéo »</strong>.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#7000FF] text-white font-bold text-xs shadow-lg transition-all"
            >
              Compris, fermer le guide
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
