import React, { useState } from 'react';
import { Download, Film, Layers, Loader2, Music, Play, Radio, Search, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { MediaFormat, SniffedMedia } from '../types';

interface QuickSniffDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStartDownload: (media: SniffedMedia) => void;
  onPlayDirect: (media: SniffedMedia) => void;
  userAgent: string;
}

export const QuickSniffDialog: React.FC<QuickSniffDialogProps> = ({
  isOpen,
  onClose,
  onStartDownload,
  onPlayDirect,
  userAgent,
}) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [customReferer, setCustomReferer] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Analysis & extraction state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [detectedMedias, setDetectedMedias] = useState<SniffedMedia[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pageInfo, setPageInfo] = useState<{ title: string; thumbnail?: string; url: string } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<MediaFormat>('mp4');
  const [selectedQuality, setSelectedQuality] = useState<'360p' | '480p' | '720p' | '1080p'>('720p');

  if (!isOpen) return null;

  const isWebpageUrl = (u: string) => {
    const trimmed = u.trim().toLowerCase();
    return (
      trimmed.startsWith('http') &&
      !trimmed.endsWith('.mp4') &&
      !trimmed.endsWith('.m3u8') &&
      !trimmed.endsWith('.webm') &&
      !trimmed.endsWith('.ts') &&
      !trimmed.endsWith('.mkv')
    );
  };

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setDetectedMedias([]);
    setPageInfo(null);

    try {
      const res = await fetch('/api/sniff-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          userAgent,
          referer: customReferer.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Échec de l analyse de la page');
      }

      if (data.medias && data.medias.length > 0) {
        setDetectedMedias(data.medias);
        setSelectedIdx(0);
        setPageInfo({
          title: data.pageTitle || 'Catalogue détecté',
          thumbnail: data.medias[0]?.thumbnail,
          url: data.finalUrl,
        });
      } else {
        setAnalysisError('Aucun flux vidéo détecté sur cette page. Assurez-vous que l URL pointe vers un épisode ou un lecteur vidéo.');
      }
    } catch (err: any) {
      setAnalysisError(err.message || 'Erreur lors de la connexion au serveur d analyse');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Helper to resolve pending embed if needed
  const ensureResolved = async (media: SniffedMedia): Promise<SniffedMedia> => {
    if ((media as any).isPendingEmbed) {
      try {
        const res = await fetch('/api/resolve-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: media.url,
            referer: media.sourcePageUrl || url.trim(),
            userAgent,
          }),
        });
        const d = await res.json();
        if (d.success && d.streamUrl) {
          return {
            ...media,
            url: d.streamUrl,
            format: d.format || 'm3u8',
            quality: d.quality || '1080p Full HD',
            headers: d.headers || media.headers,
            thumbnail: d.thumbnail || media.thumbnail,
          };
        }
      } catch {
        // use original
      }
    }
    return media;
  };

  const handleActionOnDetected = async (action: 'download' | 'play') => {
    if (detectedMedias.length === 0) return;
    const current = detectedMedias[selectedIdx];
    const resolved = await ensureResolved(current);
    const isAudio = selectedFormat === 'mp3' || selectedFormat === 'm4a';
    resolved.format = selectedFormat;
    resolved.quality = isAudio ? '192k Audio HQ' : selectedQuality;
    resolved.isAudio = isAudio;

    if (action === 'download') {
      onStartDownload(resolved);
    } else {
      onPlayDirect(resolved);
    }
    onClose();
  };

  const handleDownloadAll = async () => {
    if (detectedMedias.length === 0) return;
    const isAudio = selectedFormat === 'mp3' || selectedFormat === 'm4a';
    for (const item of detectedMedias) {
      const resolved = await ensureResolved(item);
      resolved.format = selectedFormat;
      resolved.quality = isAudio ? '192k Audio HQ' : selectedQuality;
      resolved.isAudio = isAudio;
      onStartDownload(resolved);
    }
    onClose();
  };

  const handleDirectSubmit = (action: 'download' | 'play') => {
    if (!url.trim()) return;

    // If it's a webpage, recommend analysis
    if (isWebpageUrl(url) && detectedMedias.length === 0) {
      handleAnalyze();
      return;
    }

    const streamUrl = url.trim();
    const isM3u8 = streamUrl.includes('.m3u8');
    const isAudio = selectedFormat === 'mp3' || selectedFormat === 'm4a';
    const finalFormat = selectedFormat;
    const finalQuality = isAudio ? '192k Audio HQ' : selectedQuality;

    const media: SniffedMedia = {
      id: 'quick-' + Date.now(),
      title: title.trim() || `Flux direct (${finalFormat.toUpperCase()})`,
      url: streamUrl,
      format: finalFormat,
      quality: finalQuality,
      isAudio: isAudio,
      estimatedSize: isAudio ? 8000000 : 250000000,
      headers: {
        referer: customReferer.trim() || undefined,
        userAgent: userAgent,
      },
      timestamp: Date.now(),
      thumbnail: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&auto=format&fit=crop&q=80',
      duration: isM3u8 ? 'Stream' : 'Direct',
      sourcePageUrl: customReferer.trim() || streamUrl,
    };

    if (action === 'download') {
      onStartDownload(media);
    } else {
      onPlayDirect(media);
    }
    onClose();
    setUrl('');
    setTitle('');
  };

  const activeDetected = detectedMedias[selectedIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-[#16161E] border border-[#232332] rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232332] pb-3">
          <div className="flex items-center gap-2 text-white">
            <Radio className="w-5 h-5 text-[#00F0FF]" />
            <h3 className="font-bold text-base">Interception & Analyse de Flux</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#232332] text-[#9496A1] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input URL */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-[#9496A1] mb-1 font-medium">
              URL de la page web ou du flux vidéo (.m3u8, .mp4, Anime-Sama, etc.) :
            </label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setDetectedMedias([]);
                  setPageInfo(null);
                  setAnalysisError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isWebpageUrl(url)) {
                      handleAnalyze();
                    } else {
                      handleDirectSubmit('download');
                    }
                  }
                }}
                placeholder="https://anime-sama.to/... ou stream/playlist.m3u8"
                className="flex-1 px-3 py-2 bg-[#0B0B0E] border border-[#232332] focus:border-[#00F0FF] rounded-xl text-white font-mono outline-none"
              />
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!url.trim() || isAnalyzing}
                className="px-3 py-2 rounded-xl bg-[#232332] hover:bg-[#2C2C3E] text-[#00F0FF] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#00F0FF]" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Analyser</span>
              </button>
            </div>
          </div>

          {/* Loading Indicator */}
          {isAnalyzing && (
            <div className="p-3 bg-[#00F0FF]/10 border border-[#00F0FF]/30 rounded-xl flex items-center gap-2.5 text-[#00F0FF] animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <div className="text-xs">
                <span className="font-semibold">Analyse approfondie en cours...</span>
                <p className="text-[11px] text-[#9496A1]">Inspection des lecteurs VidMoly, Sibnet, HLS et extraction des épisodes.</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {analysisError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
              {analysisError}
            </div>
          )}

          {/* Detected Episodes / Media Preview Card */}
          {detectedMedias.length > 0 && pageInfo && (
            <div className="p-3.5 bg-[#0B0B0E] border border-[#00F0FF]/30 rounded-xl space-y-3 animate-in fade-in">
              <div className="flex items-center gap-3">
                {pageInfo.thumbnail && (
                  <img
                    src={pageInfo.thumbnail}
                    alt="Affiche"
                    className="w-14 h-20 object-cover rounded-lg border border-[#232332] shrink-0"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="px-2 py-0.5 rounded-md bg-[#00F0FF]/20 text-[#00F0FF] font-bold text-[10px] uppercase tracking-wider">
                      {detectedMedias.length} Épisode{detectedMedias.length > 1 ? 's' : ''} Détecté{detectedMedias.length > 1 ? 's' : ''}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                      1080p Full HD
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white truncate">{pageInfo.title}</h4>
                  <p className="text-[11px] text-[#9496A1] mt-0.5">
                    Flux HLS prêt au téléchargement accéléré multi-segments.
                  </p>
                </div>
              </div>

              {/* Episode Dropdown */}
              <div>
                <label className="block text-[#9496A1] mb-1 font-medium text-[11px]">
                  Sélectionner l'épisode à traiter :
                </label>
                <select
                  value={selectedIdx}
                  onChange={(e) => setSelectedIdx(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-[#16161E] border border-[#232332] focus:border-[#00F0FF] rounded-lg text-white font-medium outline-none"
                >
                  {detectedMedias.map((m, idx) => (
                    <option key={m.id || idx} value={idx}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quality & Format Selection Pills */}
              <div className="bg-[#16161E] p-2.5 rounded-xl border border-[#232332] space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#00F0FF]" />
                    <span>Format & Encodage réel :</span>
                  </span>
                  <span className="text-[#9496A1]">
                    {selectedFormat === 'mp3' || selectedFormat === 'm4a'
                      ? 'Audio pur (~6-10 Mo)'
                      : selectedQuality === '360p'
                      ? '~60 Mo (Mobile)'
                      : selectedQuality === '480p'
                      ? '~150 Mo (Éco)'
                      : selectedQuality === '720p'
                      ? '~350 Mo (HD standard)'
                      : '~700 Mo (Full HD)'}
                  </span>
                </div>

                {/* Format buttons */}
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'mp4' as MediaFormat, label: '🎬 MP4 Vidéo', desc: 'Universel iOS' },
                    { id: 'mp3' as MediaFormat, label: '🎵 MP3 Audio', desc: '192 kbps HQ' },
                    { id: 'm4a' as MediaFormat, label: '🎧 M4A Apple', desc: 'AAC pur' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFormat(f.id)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all border text-center ${
                        selectedFormat === f.id
                          ? 'bg-[#00FF9D]/20 border-[#00FF9D] text-[#00FF9D] font-bold shadow-sm'
                          : 'bg-[#0B0B0E] border-[#232332] text-[#9496A1] hover:text-white'
                      }`}
                    >
                      <div>{f.label}</div>
                      <div className="text-[9px] opacity-70">{f.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Quality buttons (only if video) */}
                {selectedFormat === 'mp4' && (
                  <div className="grid grid-cols-4 gap-1 pt-1">
                    {[
                      { id: '360p', label: '360p' },
                      { id: '480p', label: '480p SD' },
                      { id: '720p', label: '720p HD' },
                      { id: '1080p', label: '1080p FHD' },
                    ].map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setSelectedQuality(q.id as any)}
                        className={`py-1 px-1.5 rounded-lg text-xs font-semibold transition-all border text-center ${
                          selectedQuality === q.id
                            ? 'bg-[#00F0FF]/20 border-[#00F0FF] text-[#00F0FF] font-bold shadow-sm'
                            : 'bg-[#0B0B0E] border-[#232332] text-[#9496A1] hover:text-white'
                        }`}
                      >
                        <div>{q.label}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons for detected catalog */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleActionOnDetected('download')}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#0099FF] hover:opacity-95 text-[#0B0B0E] font-bold text-xs shadow-lg flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Download className="w-4 h-4 stroke-[2.5px]" />
                    <span>Télécharger cet épisode</span>
                  </button>
                  <button
                    onClick={() => handleActionOnDetected('play')}
                    className="px-4 py-2.5 rounded-xl bg-[#232332] hover:bg-[#2C2C3E] text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current text-[#00F0FF]" />
                    <span>Lire</span>
                  </button>
                </div>

                {detectedMedias.length > 1 && (
                  <button
                    onClick={handleDownloadAll}
                    className="w-full py-2 rounded-xl bg-[#232332] hover:bg-[#2C2C3E] border border-[#3A3A4E] text-[#00F0FF] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Télécharger tous les {detectedMedias.length} épisodes en lot</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Optional Title input for direct URLs */}
          {detectedMedias.length === 0 && (
            <>
              <div>
                <label className="block text-[#9496A1] mb-1 font-medium">
                  Titre personnalisé (Optionnel) :
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Épisode 1 - Baskup Tony Parker"
                  className="w-full px-3 py-2 bg-[#0B0B0E] border border-[#232332] focus:border-[#00F0FF] rounded-xl text-white outline-none"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[#00F0FF] hover:underline flex items-center gap-1 font-medium text-[11px]"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{showAdvanced ? 'Masquer en-têtes avancés' : 'Configurer Referer / Anti-403'}</span>
                </button>
              </div>

              {showAdvanced && (
                <div className="p-3 bg-[#0B0B0E] rounded-xl border border-[#232332] space-y-2 animate-in fade-in">
                  <div>
                    <label className="block text-[#9496A1] mb-1">Referer HTTP (pour contourner le blocage 403) :</label>
                    <input
                      type="text"
                      value={customReferer}
                      onChange={(e) => setCustomReferer(e.target.value)}
                      placeholder="https://anime-sama.to/"
                      className="w-full px-3 py-1.5 bg-[#16161E] border border-[#232332] rounded-lg text-white font-mono outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Direct Action buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#232332]">
                <button
                  onClick={() => handleDirectSubmit('download')}
                  disabled={!url.trim()}
                  className="flex-1 py-2 rounded-xl bg-gradient-to-r from-[#00F0FF] to-[#0099FF] disabled:opacity-40 hover:opacity-95 text-[#0B0B0E] font-bold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download className="w-4 h-4 stroke-[2.5px]" />
                  <span>Télécharger en Multi-Thread</span>
                </button>
                <button
                  onClick={() => handleDirectSubmit('play')}
                  disabled={!url.trim()}
                  className="px-4 py-2 rounded-xl bg-[#232332] disabled:opacity-40 hover:bg-[#2C2C3E] text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Play className="w-4 h-4 fill-current text-[#00F0FF]" />
                  <span>Lire en direct</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
