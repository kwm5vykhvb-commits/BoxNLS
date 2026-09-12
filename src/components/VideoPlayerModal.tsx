import React, { useEffect, useRef, useState } from 'react';
import { 
  Check, 
  Maximize, 
  Minimize, 
  Pause, 
  Pipette, 
  PictureInPicture, 
  Play, 
  RotateCcw, 
  RotateCw, 
  Settings2, 
  Volume2, 
  VolumeX, 
  X 
} from 'lucide-react';
import Hls from 'hls.js';
import { formatTime } from '../utils/formatters';

interface VendorDocument extends Document {
  webkitFullscreenElement?: Element;
  mozFullScreenElement?: Element;
  msFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

interface VendorElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface VendorVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

const isNativeFullscreenActive = (): boolean => {
  if (typeof document === 'undefined') return false;
  const doc = document as VendorDocument;
  return Boolean(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  );
};

const enterNativeFullscreen = async (element: HTMLElement, videoEl?: HTMLVideoElement | null): Promise<boolean> => {
  const el = element as VendorElement;

  if (typeof el.requestFullscreen === 'function') {
    try {
      await el.requestFullscreen();
      return true;
    } catch (err) {
      console.warn('requestFullscreen call rejected', err);
    }
  }

  if (typeof el.webkitRequestFullscreen === 'function') {
    try {
      await el.webkitRequestFullscreen();
      return true;
    } catch (err) {
      console.warn('webkitRequestFullscreen call rejected', err);
    }
  }

  if (typeof el.webkitRequestFullScreen === 'function') {
    try {
      await el.webkitRequestFullScreen();
      return true;
    } catch (err) {
      console.warn('webkitRequestFullScreen call rejected', err);
    }
  }

  if (typeof el.mozRequestFullScreen === 'function') {
    try {
      await el.mozRequestFullScreen();
      return true;
    } catch (err) {
      console.warn('mozRequestFullScreen call rejected', err);
    }
  }

  if (typeof el.msRequestFullscreen === 'function') {
    try {
      await el.msRequestFullscreen();
      return true;
    } catch (err) {
      console.warn('msRequestFullscreen call rejected', err);
    }
  }

  // iOS Safari video element fallback
  if (videoEl) {
    const vEl = videoEl as VendorVideoElement;
    if (typeof vEl.webkitEnterFullscreen === 'function') {
      try {
        vEl.webkitEnterFullscreen();
        return true;
      } catch (err) {
        console.warn('webkitEnterFullscreen call rejected', err);
      }
    }
  }

  return false;
};

const exitNativeFullscreen = async (videoEl?: HTMLVideoElement | null): Promise<void> => {
  if (typeof document === 'undefined') return;
  if (!isNativeFullscreenActive()) return;
  const doc = document as VendorDocument;

  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
      return;
    }
  } catch {}

  try {
    if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
      return;
    }
  } catch {}

  try {
    if (typeof doc.mozCancelFullScreen === 'function') {
      await doc.mozCancelFullScreen();
      return;
    }
  } catch {}

  try {
    if (typeof doc.msExitFullscreen === 'function') {
      await doc.msExitFullscreen();
      return;
    }
  } catch {}

  if (videoEl) {
    const vEl = videoEl as VendorVideoElement;
    try {
      if (typeof vEl.webkitExitFullscreen === 'function') {
        vEl.webkitExitFullscreen();
      }
    } catch {}
  }
};

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  videoTitle: string;
  format?: string;
  isHls?: boolean;
  headers?: {
    referer?: string;
    userAgent?: string;
    cookies?: string;
  };
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  isOpen,
  onClose,
  videoUrl,
  videoTitle,
  format = 'mp4',
  isHls = false,
  headers,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const fallbackAttemptedRef = useRef<boolean>(false);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [hlsQualities, setHlsQualities] = useState<{ id: number; name: string }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1); // -1 = Auto
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Video & HLS
  useEffect(() => {
    if (!isOpen || !videoUrl || !videoRef.current) return;

    fallbackAttemptedRef.current = false;
    const video = videoRef.current;
    const isBlob = videoUrl.startsWith('blob:');
    const isLocalApi = videoUrl.startsWith('/api/');
    const isMpegTs = format === 'ts' || videoUrl.endsWith('.ts');
    // If it's a downloaded offline blob with MP4 format, it is a native video file - NOT a live HLS stream
    const isStreamHls = !isBlob && (isHls || videoUrl.includes('.m3u8') || format === 'm3u8' || isMpegTs);

    const getProxyUrl = (targetUrl: string) => {
      return `/api/stream-proxy?url=${encodeURIComponent(targetUrl)}${
        headers?.referer ? `&referer=${encodeURIComponent(headers.referer)}` : ''
      }`;
    };

    // For any external web stream (non-blob, non-local), route directly through proxy to ensure CORS and headers work
    const effectiveSourceUrl = isBlob || isLocalApi ? videoUrl : getProxyUrl(videoUrl);

    let virtualManifestUrl: string | null = null;
    if (isBlob && isMpegTs) {
      // Chrome and Firefox cannot play raw MPEG-TS blobs natively in <video>.
      // We create a virtual M3U8 manifest so Hls.js demuxes it seamlessly.
      const virtualM3u8 = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:7200\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:7200.0,\n${videoUrl}\n#EXT-X-ENDLIST`;
      const m3u8Blob = new Blob([virtualM3u8], { type: 'application/vnd.apple.mpegurl' });
      virtualManifestUrl = URL.createObjectURL(m3u8Blob);
    }

    const hlsSource = virtualManifestUrl || effectiveSourceUrl;

    if (isStreamHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsSource);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setIsBuffering(false);
          video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
          
          if (data.levels && data.levels.length > 0) {
            const list = data.levels.map((lvl, index) => ({
              id: index,
              name: `${lvl.height || 'Auto'}p (${Math.round(lvl.bitrate / 1000)}k)`,
            }));
            setHlsQualities(list);
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            // If direct HLS failed, switch to stream-proxy
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !fallbackAttemptedRef.current && !effectiveSourceUrl.includes('/api/stream-proxy')) {
              fallbackAttemptedRef.current = true;
              console.info('Direct HLS blocked by CORS or network, switching to backend stream-proxy...');
              const proxyUrl = getProxyUrl(videoUrl);
              hls.loadSource(proxyUrl);
              hls.startLoad();
              return;
            }

            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = effectiveSourceUrl;
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      }
    } else {
      video.src = effectiveSourceUrl;
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }

    const handleVideoError = () => {
      if (!video.src.includes('/api/stream-proxy') && !videoUrl.startsWith('/api/') && !videoUrl.startsWith('blob:') && !fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        video.src = getProxyUrl(videoUrl);
        video.load();
        video.play().catch(() => {});
      }
    };
    video.addEventListener('error', handleVideoError);

    return () => {
      video.removeEventListener('error', handleVideoError);
      if (virtualManifestUrl) {
        URL.revokeObjectURL(virtualManifestUrl);
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [isOpen, videoUrl, isHls, format, headers]);

  // Video Events
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
      setIsBuffering(false);
    }
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.warn('Playback could not start:', err);
          setIsPlaying(false);
        });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const handleSkip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const newMute = !isMuted;
    setIsMuted(newMute);
    videoRef.current.muted = newMute;
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
  };

  const handleQualityChange = (qualityId: number) => {
    setSelectedQuality(qualityId);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = qualityId;
    }
    setShowQualityMenu(false);
  };

  const isPseudoFullscreenRef = useRef<boolean>(false);

  // Sync fullscreen state with native browser events and keyboard Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleFullscreenChange = () => {
      const active = isNativeFullscreenActive();
      if (!active && !isPseudoFullscreenRef.current) {
        setIsFullscreen(false);
      } else if (active) {
        setIsFullscreen(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        handleToggleFullscreen();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);

    const video = videoRef.current as VendorVideoElement | null;
    const handleVideoFullscreenBegin = () => setIsFullscreen(true);
    const handleVideoFullscreenEnd = () => setIsFullscreen(false);

    if (video) {
      video.addEventListener('webkitbeginfullscreen', handleVideoFullscreenBegin);
      video.addEventListener('webkitendfullscreen', handleVideoFullscreenEnd);
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      if (video) {
        video.removeEventListener('webkitbeginfullscreen', handleVideoFullscreenBegin);
        video.removeEventListener('webkitendfullscreen', handleVideoFullscreenEnd);
      }
    };
  }, [isOpen, isFullscreen]);

  const handleToggleFullscreen = async () => {
    if (isFullscreen) {
      isPseudoFullscreenRef.current = false;
      setIsFullscreen(false);
      await exitNativeFullscreen(videoRef.current);
    } else {
      if (!containerRef.current) return;
      const nativeOk = await enterNativeFullscreen(containerRef.current, videoRef.current);
      if (!nativeOk) {
        // Fallback to CSS full-window mode (handles iOS Safari div limitations & iframe restrictions)
        isPseudoFullscreenRef.current = true;
      }
      setIsFullscreen(true);
    }
  };

  const handleTogglePiP = async () => {
    if (!videoRef.current) return;
    try {
      const doc = document as any;
      if (doc.pictureInPictureElement) {
        if (typeof doc.exitPictureInPicture === 'function') {
          await doc.exitPictureInPicture();
        }
      } else if (doc.pictureInPictureEnabled && typeof videoRef.current.requestPictureInPicture === 'function') {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not supported or failed', err);
    }
  };

  const handleClose = async () => {
    if (isFullscreen) {
      isPseudoFullscreenRef.current = false;
      setIsFullscreen(false);
      await exitNativeFullscreen(videoRef.current);
    }
    onClose();
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setShowQualityMenu(false);
        setShowSpeedMenu(false);
      }
    }, 3500);
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200 ${
        isFullscreen ? 'p-0' : 'p-2 sm:p-4'
      }`}
    >
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className={
          isFullscreen
            ? 'relative w-full h-full bg-black flex flex-col group select-none overflow-hidden'
            : 'relative w-full max-w-5xl h-[80vh] max-h-[720px] bg-black rounded-2xl overflow-hidden shadow-2xl border border-[#232332] flex flex-col group select-none'
        }
      >
        {/* Top Floating Bar */}
        <div 
          className={`absolute top-0 left-0 right-0 z-30 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/40">
              {isHls || videoUrl.includes('.m3u8') ? 'HLS LIVE' : format.toUpperCase()}
            </span>
            <h3 className="font-semibold text-sm text-white max-w-md truncate drop-shadow-md">
              {videoTitle}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-full bg-black/60 hover:bg-white/20 text-white transition-colors"
            title="Fermer le lecteur"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Canvas */}
        <div className="relative flex-1 flex items-center justify-center bg-black cursor-pointer" onClick={handleTogglePlay}>
          <video
            ref={videoRef}
            playsInline
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => { setIsBuffering(false); setIsPlaying(true); }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />

          {/* Buffering Spinner */}
          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
              <div className="w-12 h-12 border-4 border-[#00F0FF]/20 border-t-[#00F0FF] rounded-full animate-spin" />
            </div>
          )}

          {/* Big Center Play/Pause indicator on pause */}
          {!isPlaying && !isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-[#00F0FF]/20 border border-[#00F0FF] flex items-center justify-center text-[#00F0FF] shadow-lg shadow-[#00F0FF]/30">
                <Play className="w-8 h-8 fill-current translate-x-0.5" />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Custom Controls Bar */}
        <div 
          className={`absolute bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progress / Scrub Timeline */}
          <div className="relative mb-3 flex items-center group/slider">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-[#232332] rounded-lg appearance-none cursor-pointer accent-[#00F0FF] hover:h-2.5 transition-all"
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-white">
            {/* Left controls: Play, Skip, Time */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePlay}
                className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                title={isPlaying ? 'Pause' : 'Lecture'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              </button>

              <button
                onClick={() => handleSkip(-10)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Reculer de 10s"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleSkip(10)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Avancer de 10s"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 ml-2 group/vol">
                <button
                  onClick={handleToggleMute}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-[#323247] rounded-lg appearance-none cursor-pointer accent-[#00F0FF]"
                />
              </div>

              {/* Time Code */}
              <div className="text-xs font-mono text-[#9496A1] ml-2">
                <span className="text-white">{formatTime(currentTime)}</span> / {formatTime(duration)}
              </div>
            </div>

            {/* Right controls: Speed, Quality, PiP, Fullscreen */}
            <div className="flex items-center gap-1.5">
              {/* Playback speed menu */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className="px-2 py-1 rounded text-xs font-mono bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="Vitesse de lecture"
                >
                  {playbackRate}x
                </button>
                {showSpeedMenu && (
                  <div className="absolute bottom-full right-0 mb-2 py-1 w-24 bg-[#16161E] border border-[#232332] rounded-lg shadow-xl text-xs flex flex-col z-40">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => handleRateChange(rate)}
                        className={`px-3 py-1 text-left flex items-center justify-between hover:bg-[#232332] ${
                          playbackRate === rate ? 'text-[#00F0FF] font-bold' : 'text-[#F3F4F8]'
                        }`}
                      >
                        <span>{rate}x</span>
                        {playbackRate === rate && <Check className="w-3 h-3 text-[#00F0FF]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* HLS Quality Selector */}
              {hlsQualities.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[#7000FF]/30 hover:bg-[#7000FF]/50 text-[#00F0FF] border border-[#7000FF]/50 transition-colors"
                    title="Qualité vidéo HLS"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>{selectedQuality === -1 ? 'Auto' : hlsQualities[selectedQuality]?.name.split(' ')[0]}</span>
                  </button>
                  {showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 py-1 w-32 bg-[#16161E] border border-[#232332] rounded-lg shadow-xl text-xs flex flex-col z-40">
                      <button
                        onClick={() => handleQualityChange(-1)}
                        className={`px-3 py-1.5 text-left flex items-center justify-between hover:bg-[#232332] ${
                          selectedQuality === -1 ? 'text-[#00F0FF] font-bold' : 'text-[#F3F4F8]'
                        }`}
                      >
                        <span>Auto (Bitrate adaptatif)</span>
                        {selectedQuality === -1 && <Check className="w-3 h-3 text-[#00F0FF]" />}
                      </button>
                      {hlsQualities.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => handleQualityChange(q.id)}
                          className={`px-3 py-1.5 text-left flex items-center justify-between hover:bg-[#232332] ${
                            selectedQuality === q.id ? 'text-[#00F0FF] font-bold' : 'text-[#F3F4F8]'
                          }`}
                        >
                          <span>{q.name}</span>
                          {selectedQuality === q.id && <Check className="w-3 h-3 text-[#00F0FF]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Picture-in-Picture */}
              <button
                onClick={handleTogglePiP}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Mode Picture-in-Picture"
              >
                <PictureInPicture className="w-4 h-4" />
              </button>

              {/* Fullscreen */}
              <button
                onClick={handleToggleFullscreen}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title={isFullscreen ? 'Quitter plein écran' : 'Plein écran'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
