import React, { useState } from 'react';
import { 
  Check, 
  Copy, 
  Download, 
  ExternalLink, 
  Film, 
  Layers, 
  Play, 
  ShieldCheck, 
  SlidersHorizontal, 
  Trash2, 
  X 
} from 'lucide-react';
import { MediaFormat, SniffedMedia } from '../types';
import { formatBytes } from '../utils/formatters';

interface SniffedMediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaList: SniffedMedia[];
  onStartDownload: (media: SniffedMedia, threadsCount?: number) => void;
  onPlayMedia: (media: SniffedMedia) => void;
  onClearList: () => void;
  defaultThreads: number;
}

export const SniffedMediaModal: React.FC<SniffedMediaModalProps> = ({
  isOpen,
  onClose,
  mediaList,
  onStartDownload,
  onPlayMedia,
  onClearList,
  defaultThreads,
}) => {
  const [selectedThreads, setSelectedThreads] = useState<number>(defaultThreads);
  const [expandedHeadersId, setExpandedHeadersId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedQualityMap, setSelectedQualityMap] = useState<Record<string, string>>({});
  const [selectedFormatMap, setSelectedFormatMap] = useState<Record<string, MediaFormat>>({});

  const getEffectiveFormat = (media: SniffedMedia): MediaFormat => {
    return selectedFormatMap[media.id] || (media.format === 'm3u8' ? 'mp4' : media.format);
  };

  const getEffectiveQuality = (media: SniffedMedia) => selectedQualityMap[media.id] || media.quality || '720p';

  const getEffectiveSize = (media: SniffedMedia, format: MediaFormat, quality: string) => {
    if (format === 'mp3' || format === 'm4a') {
      return Math.max(3500000, Math.round(media.estimatedSize * 0.08) || 6000000);
    }
    if (quality.toLowerCase().includes('480')) return Math.round(media.estimatedSize * 0.3) || 120000000;
    if (quality.toLowerCase().includes('720')) return Math.round(media.estimatedSize * 0.55) || 280000000;
    if (quality.toLowerCase().includes('360')) return Math.round(media.estimatedSize * 0.18) || 60000000;
    return media.estimatedSize || 500000000;
  };

  if (!isOpen) return null;

  const handleCopyUrl = async (id: string, url: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      // Safe fallback using temporary textarea
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        // Silently ignore if completely disallowed in iframe
      }
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl max-h-[88vh] bg-[#16161E] border border-[#232332] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#F3F4F8]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#232332] bg-[#111118]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00F0FF]/15 border border-[#00F0FF]/30 flex items-center justify-center text-lg">
              🎬
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">Flux Vidéo Détectés</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/30">
                  {mediaList.length} flux
                </span>
              </div>
              <p className="text-xs text-[#9496A1]">
                Sniffer réseau 1DM avec capture anti-403 (Referer & Cookies)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mediaList.length > 0 && (
              <button
                onClick={onClearList}
                className="p-1.5 rounded-lg text-[#9496A1] hover:text-rose-400 hover:bg-[#232332] transition-colors"
                title="Vider la liste"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#9496A1] hover:text-white hover:bg-[#232332] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Thread configuration bar */}
        <div className="px-6 py-2.5 bg-[#0D0D12] border-b border-[#232332] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-[#9496A1]">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>Accélération Range :</span>
            <span className="text-[#00F0FF] font-bold">{selectedThreads} threads</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[4, 8, 16, 32].map((threads) => (
              <button
                key={threads}
                onClick={() => setSelectedThreads(threads)}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-all ${
                  selectedThreads === threads
                    ? 'bg-[#00F0FF] text-[#0B0B0E] font-bold shadow-sm shadow-[#00F0FF]/30'
                    : 'bg-[#16161E] text-[#9496A1] hover:text-white border border-[#232332]'
                }`}
              >
                {threads}T
              </button>
            ))}
          </div>
        </div>

        {/* Media List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {mediaList.length === 0 ? (
            <div className="py-12 text-center text-[#9496A1] space-y-2">
              <Film className="w-10 h-10 mx-auto text-[#232332]" />
              <p className="text-sm font-medium">Aucun flux média intercepté sur cette page.</p>
              <p className="text-xs text-[#6B6E7D]">
                Naviguez vers une vidéo dans le navigateur ou lancez un aperçu pour sniffer automatiquement.
              </p>
            </div>
          ) : (
            mediaList.map((media) => {
              const isHls = media.format === 'm3u8';
              const isExpanded = expandedHeadersId === media.id;

              return (
                <div
                  key={media.id}
                  className="bg-[#111118] border border-[#232332] hover:border-[#00F0FF]/40 rounded-xl p-4 transition-all hover:shadow-lg hover:shadow-[#00F0FF]/5 group"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Thumbnail */}
                    <div className="relative w-full sm:w-36 h-24 bg-[#0B0B0E] rounded-lg overflow-hidden shrink-0 border border-[#232332]">
                      {media.thumbnail ? (
                        <img
                          src={media.thumbnail}
                          alt={media.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#16161E] to-[#0B0B0E]">
                          <Film className="w-8 h-8 text-[#00F0FF]/50" />
                        </div>
                      )}
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-black/80 backdrop-blur-sm border border-white/10 text-[#00F0FF]">
                        {media.format}
                      </span>
                      {media.duration && (
                        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/80 text-white">
                          {media.duration}
                        </span>
                      )}
                    </div>

                    {/* Metadata */}
                    {(() => {
                      const effFormat = getEffectiveFormat(media);
                      const effQuality = getEffectiveQuality(media);
                      const isAudioFormat = effFormat === 'mp3' || effFormat === 'm4a';
                      const effSize = getEffectiveSize(media, effFormat, effQuality);
                      return (
                        <div className="flex-1 flex flex-col justify-between min-w-0">
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-semibold text-sm text-white line-clamp-2 leading-snug">
                                {media.title}
                              </h4>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-[#00FF9D]/20 text-[#00FF9D] border border-[#00FF9D]/30">
                                  {effFormat.toUpperCase()}
                                </span>
                                {!isAudioFormat && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#7000FF]/20 text-[#00F0FF] border border-[#7000FF]/30">
                                    {effQuality}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-[#9496A1]">
                              <span className="font-mono text-[#F3F4F8] font-semibold">
                                ≈ {formatBytes(effSize)}
                              </span>
                              <span className="text-[#323247]">•</span>
                              <span className="flex items-center gap-1 text-[#00FF9D]">
                                <ShieldCheck className="w-3 h-3" />
                                Anti-403 Prêt
                              </span>
                              {isHls && (
                                <>
                                  <span className="text-[#323247]">•</span>
                                  <span className="flex items-center gap-1 text-[#7000FF]">
                                    <Layers className="w-3 h-3" />
                                    HLS Segments
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#00FF9D]/20 border border-[#00FF9D] text-[#00FF9D] shadow-sm">
                                🎬 Format Original Automatique (Privilégié: 720p)
                              </span>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#232332]/60">
                            {/* Download button */}
                            <button
                              onClick={() => {
                                const configuredMedia: SniffedMedia = {
                                  ...media,
                                  format: effFormat,
                                  quality: isAudioFormat ? '192k Audio HQ' : effQuality,
                                  estimatedSize: effSize,
                                  isAudio: isAudioFormat,
                                };
                                onStartDownload(configuredMedia, selectedThreads);
                                onClose();
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#00F0FF] to-[#0099FF] hover:from-[#33F3FF] hover:to-[#1AA3FF] text-[#0B0B0E] font-bold text-xs shadow-md shadow-[#00F0FF]/20 transition-all hover:scale-[1.02]"
                            >
                              <Download className="w-3.5 h-3.5 stroke-[2.5px]" />
                              <span>
                                Télécharger {effFormat.toUpperCase()} ({isAudioFormat ? 'Audio' : effQuality})
                              </span>
                            </button>

                            {/* Stream direct in In-App Player */}
                            <button
                              onClick={() => {
                                const configuredMedia: SniffedMedia = {
                                  ...media,
                                  format: effFormat,
                                  quality: isAudioFormat ? '192k Audio HQ' : effQuality,
                                  isAudio: isAudioFormat,
                                };
                                onPlayMedia(configuredMedia);
                                onClose();
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#232332] hover:bg-[#2C2C3E] text-white text-xs font-medium transition-colors"
                            >
                              <Play className="w-3.5 h-3.5 fill-current text-[#00F0FF]" />
                              <span>Lire direct</span>
                            </button>

                            {/* Copy link */}
                            <button
                              onClick={() => handleCopyUrl(media.id, media.url)}
                              className="p-1.5 rounded-lg bg-[#16161E] hover:bg-[#232332] text-[#9496A1] hover:text-white border border-[#232332] transition-colors"
                              title="Copier l'URL du flux"
                            >
                              {copiedId === media.id ? (
                                <Check className="w-3.5 h-3.5 text-[#00FF9D]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Toggle captured headers */}
                            <button
                              onClick={() => setExpandedHeadersId(isExpanded ? null : media.id)}
                              className="ml-auto text-[11px] text-[#9496A1] hover:text-[#00F0FF] underline decoration-dotted underline-offset-2"
                            >
                              {isExpanded ? 'Masquer en-têtes' : 'En-têtes capturés'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Captured Headers Panel (Referer, User-Agent, Cookies) */}
                  {isExpanded && (
                    <div className="mt-3 p-3 bg-[#0B0B0E] rounded-lg border border-[#232332] text-xs font-mono space-y-1.5">
                      <div className="flex items-center justify-between text-[#00F0FF] font-semibold text-[11px] border-b border-[#232332] pb-1">
                        <span>EN-TÊTES RÉSEAU CAPTURÉS (ANTI-403)</span>
                        <span className="text-[#00FF9D] text-[10px]">1DM BYPASS ACTIF</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1 text-[11px]">
                        <div>
                          <span className="text-[#9496A1]">User-Agent: </span>
                          <span className="text-white break-all">{media.headers.userAgent || 'Default'}</span>
                        </div>
                        <div>
                          <span className="text-[#9496A1]">Referer: </span>
                          <span className="text-[#00F0FF] break-all">{media.headers.referer || 'None'}</span>
                        </div>
                        <div>
                          <span className="text-[#9496A1]">Cookies: </span>
                          <span className="text-[#7000FF] break-all">{media.headers.cookies || 'None (Public session)'}</span>
                        </div>
                        <div>
                          <span className="text-[#9496A1]">Flux URL: </span>
                          <span className="text-emerald-400 break-all">{media.url}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#111118] border-t border-[#232332] flex items-center justify-between text-xs text-[#9496A1]">
          <span>Moteur NLSbox v6.2 • Range Requests & HLS M3U8</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#232332] hover:bg-[#2F2F44] text-white font-medium transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
