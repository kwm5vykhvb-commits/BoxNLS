import { DownloadItem, DownloadSegment, SniffedMedia } from '../types';
import { saveVideoBlob } from './db';

interface ActiveThread {
  controller: AbortController;
  buffer: Uint8Array[];
}

interface ActiveDownloadSession {
  threads: Map<number, ActiveThread>;
  hlsBuffers: Map<number, Uint8Array>;
  hlsControllers: Map<number, AbortController>;
  speedTimer?: NodeJS.Timeout;
  serverAbortController?: AbortController;
  serverPollingTimer?: NodeJS.Timeout;
  lastDownloadedBytes: number;
  lastSpeedCheckTime: number;
}

export class DownloadEngine {
  private sessions: Map<string, ActiveDownloadSession> = new Map();
  private onUpdateCallback?: (items: DownloadItem[]) => void;
  private downloads: DownloadItem[] = [];

  constructor(initialDownloads: DownloadItem[], onUpdate?: (items: DownloadItem[]) => void) {
    this.downloads = [...initialDownloads];
    this.onUpdateCallback = onUpdate;
  }

  public setUpdateListener(callback: (items: DownloadItem[]) => void) {
    this.onUpdateCallback = callback;
  }

  public getDownloads(): DownloadItem[] {
    return this.downloads;
  }

  public async createDownload(
    media: SniffedMedia,
    threadsCount: number = 8,
    speedLimitKBps: number = 0
  ): Promise<DownloadItem> {
    const isHls = media.format === 'm3u8' || media.url.includes('.m3u8');
    let totalSize = media.estimatedSize || 0;

    // If totalSize is unknown, perform a real probe first
    if (!isHls && (!totalSize || totalSize <= 0)) {
      try {
        const probeRes = await fetch('/api/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: media.url,
            referer: media.headers?.referer,
            userAgent: media.headers?.userAgent,
          }),
        });
        const probeData = await probeRes.json();
        if (probeData.success && probeData.contentLength > 0) {
          totalSize = probeData.contentLength;
        }
      } catch (err) {
        console.warn('Real probe fallback error:', err);
      }
    }

    if (!totalSize || totalSize <= 0) {
      totalSize = isHls ? 35000000 : 50000000;
    }

    const actualThreads = isHls ? Math.min(threadsCount, 8) : Math.max(1, threadsCount);
    const segmentSize = Math.floor(totalSize / actualThreads);
    const segments: DownloadSegment[] = [];

    for (let i = 0; i < actualThreads; i++) {
      const startByte = i * segmentSize;
      const endByte = i === actualThreads - 1 ? totalSize - 1 : (i + 1) * segmentSize - 1;
      segments.push({
        id: i + 1,
        startByte,
        endByte,
        currentByte: startByte,
        status: 'downloading',
        speed: 0,
      });
    }

    const newItem: DownloadItem = {
      id: 'dl-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      title: media.title || 'Vidéo téléchargee',
      url: media.url,
      format: media.format,
      quality: media.quality,
      totalSize,
      downloadedSize: 0,
      status: 'downloading',
      speed: 0,
      peakSpeed: 0,
      threadsCount: actualThreads,
      segments,
      startedAt: Date.now(),
      headers: {
        referer: media.headers?.referer,
        userAgent: media.headers?.userAgent,
        cookies: media.headers?.cookies,
      },
      thumbnail: media.thumbnail,
      duration: media.duration,
      sourcePageUrl: media.sourcePageUrl,
      isHls,
    };

    this.downloads = [newItem, ...this.downloads];
    this.emitUpdate();

    // Use ultra-stable server-side engine powered by native FFmpeg
    this.startServerDownload(newItem, speedLimitKBps);

    return newItem;
  }

  // Ultra-stable server-side job engine with live progress & faststart remuxing
  private async startServerDownload(item: DownloadItem, speedLimitKBps: number = 0) {
    const session: ActiveDownloadSession = {
      threads: new Map(),
      hlsBuffers: new Map(),
      hlsControllers: new Map(),
      serverAbortController: new AbortController(),
      lastDownloadedBytes: item.downloadedSize,
      lastSpeedCheckTime: Date.now(),
    };
    this.sessions.set(item.id, session);

    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: session.serverAbortController.signal,
        body: JSON.stringify({
          url: item.url,
          title: item.title,
          format: item.format,
          quality: item.quality,
          referer: item.headers.referer,
          userAgent: item.headers.userAgent,
          sourcePageUrl: item.sourcePageUrl,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !data.jobId) {
        throw new Error(data.error || 'Impossible d initialiser le téléchargement');
      }

      item.serverJobId = data.jobId;
      if (data.format) item.format = data.format;
      this.emitUpdate();

      // Poll server job
      const poll = async () => {
        if (item.status !== 'downloading') return;
        try {
          const sRes = await fetch(`/api/download/status/${item.serverJobId}`, {
            signal: session.serverAbortController?.signal,
          });
          if (!sRes.ok) {
            session.serverPollingTimer = setTimeout(poll, 1000);
            return;
          }

          const sData = await sRes.json();
          if (item.status !== 'downloading') return;

          if (sData.format && sData.format !== item.format) {
            item.format = sData.format;
          }

          if (sData.status === 'downloading' || sData.status === 'starting') {
            item.downloadedSize = sData.downloadedBytes || 0;
            if (sData.totalBytes && sData.totalBytes > 0) {
              item.totalSize = sData.totalBytes;
            }

            const now = Date.now();
            const elapsed = (now - session.lastSpeedCheckTime) / 1000;
            if (sData.speed && sData.speed > 0) {
              item.speed = sData.speed;
            } else if (elapsed >= 0.5 && item.downloadedSize > session.lastDownloadedBytes) {
              item.speed = Math.max(0, Math.round((item.downloadedSize - session.lastDownloadedBytes) / elapsed));
              session.lastDownloadedBytes = item.downloadedSize;
              session.lastSpeedCheckTime = now;
            }
            if (item.speed > item.peakSpeed) item.peakSpeed = item.speed;

            const serverPct = Math.round(sData.progress || 0);
            const calculatedPct = (item.totalSize > 0 && item.downloadedSize > 0)
              ? Math.round((item.downloadedSize / item.totalSize) * 100)
              : 0;
            const pct = Math.min(99, Math.max(serverPct, calculatedPct));

            for (let i = 0; i < item.segments.length; i++) {
              const seg = item.segments[i];
              const segSpan = seg.endByte - seg.startByte;
              seg.currentByte = Math.min(seg.endByte, Math.round(seg.startByte + (pct / 100) * segSpan));
              seg.status = pct >= 100 ? 'completed' : 'downloading';
              seg.speed = Math.round(item.speed / Math.max(1, item.segments.length));
            }

            this.emitUpdate();
            session.serverPollingTimer = setTimeout(poll, 2500);
          } else if (sData.status === 'completed') {
            item.downloadedSize = sData.totalBytes || item.totalSize || item.downloadedSize;
            item.totalSize = sData.totalBytes || item.totalSize;
            item.speed = 0;

            // Client fetch phase (to make it available offline safely without crashing iOS Safari RAM)
            try {
              item.status = 'downloading';
              this.emitUpdate();
              
              const res = await fetch(`/api/download/file/${item.serverJobId}`, {
                signal: session.serverAbortController?.signal,
              });
              
              if (!res.ok) throw new Error(`Fetch to device failed: ${res.status} ${res.statusText}`);
              
              const contentLength = +(res.headers.get('Content-Length') || item.totalSize || 0);
              const reader = res.body?.getReader();
              
              if (reader) {
                let fileBlob: Blob | null = null;
                let opfsWritable: any = null;
                let opfsFileHandle: any = null;
                
                // Try OPFS (Origin Private File System) first - Supported in iOS 16.4+
                // This writes directly to disk and prevents the 500MB RAM crash on iPhones
                if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
                  try {
                    const root = await navigator.storage.getDirectory();
                    opfsFileHandle = await root.getFileHandle(`${item.id}.${item.format}`, { create: true });
                    if (opfsFileHandle.createWritable) {
                      opfsWritable = await opfsFileHandle.createWritable();
                    }
                  } catch (e) {
                    console.warn('OPFS not available, falling back to memory chunks:', e);
                  }
                }

                let chunks: Uint8Array[] = [];
                let receivedLength = 0;
                let lastPUpdate = Date.now();
                let lastReceivedBytes = 0;

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  if (opfsWritable) {
                    await opfsWritable.write(value);
                  } else {
                    chunks.push(value); // Fallback to RAM (risky for >400MB)
                  }
                  
                  receivedLength += value.length;
                  
                  const now = Date.now();
                  if (now - lastPUpdate > 500) {
                    const elapsed = (now - lastPUpdate) / 1000;
                    item.speed = Math.max(0, Math.round((receivedLength - lastReceivedBytes) / elapsed));
                    lastPUpdate = now;
                    lastReceivedBytes = receivedLength;
                    
                    if (contentLength > 0) {
                      const pct = Math.round((receivedLength / contentLength) * 100);
                      for (const seg of item.segments) {
                        seg.currentByte = Math.min(seg.endByte, Math.round(seg.startByte + (pct / 100) * (seg.endByte - seg.startByte)));
                        seg.status = pct >= 100 ? 'completed' : 'downloading';
                        seg.speed = Math.round(item.speed / Math.max(1, item.segments.length));
                      }
                      this.emitUpdate();
                    }
                  }
                }

                if (opfsWritable) {
                  await opfsWritable.close();
                  const file = await opfsFileHandle.getFile();
                  item.blobUrl = URL.createObjectURL(file);
                } else {
                  fileBlob = new Blob(chunks, { type: item.format === 'mp3' ? 'audio/mpeg' : item.format === 'm4a' ? 'audio/mp4' : item.format === 'webm' ? 'video/webm' : 'video/mp4' });
                  chunks.length = 0; // Free memory immediately
                  item.blobUrl = URL.createObjectURL(fileBlob);
                }
              }
            } catch (fetchErr: any) {
              if (fetchErr.name === 'AbortError') return;
              console.error('Device download error:', fetchErr);
            }

            for (const seg of item.segments) {
              seg.currentByte = seg.endByte;
              seg.status = 'completed';
            }

            item.status = 'completed';
            item.completedAt = Date.now();
            this.emitUpdate();
          } else if (sData.status === 'error') {
            item.status = 'error';
            item.error = sData.error || 'Erreur serveur de téléchargement';
            this.emitUpdate();
            return; // Stop polling on unrecoverable error
          } else if (sData.status === 'canceled') {
            item.status = 'canceled';
            this.emitUpdate();
            return; // Stop polling
          }
        } catch (pollErr: any) {
          if (pollErr.name === 'AbortError') return;
          console.warn('Poll error:', pollErr);
          session.serverPollingTimer = setTimeout(poll, 2500);
        }
      };

      session.serverPollingTimer = setTimeout(poll, 2500);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('Server download start failed:', err);
      
      // We no longer fallback to client-side HLS / Range downloads here!
      // Client-side downloads aggressively consume users' mobile data plans by routing GBs
      // of video chunks through the browser, and uploading them back for remuxing.
      // Now, everything relies solely on the stable Server Turbo FFmpeg engine.
      if (item.status === 'downloading') {
        item.status = 'error';
        item.error = err.message || 'Impossible de démarrer le téléchargement serveur.';
        this.emitUpdate();
      }
    }
  }

  // REAL Range Request multi-thread worker
  private async startRangeDownload(item: DownloadItem, speedLimitKBps: number = 0) {
    const session: ActiveDownloadSession = {
      threads: new Map(),
      hlsBuffers: new Map(),
      hlsControllers: new Map(),
      lastDownloadedBytes: item.downloadedSize,
      lastSpeedCheckTime: Date.now(),
    };
    this.sessions.set(item.id, session);

    // Setup speed telemetry ticker
    session.speedTimer = setInterval(() => {
      const now = Date.now();
      const elapsedSec = (now - session.lastSpeedCheckTime) / 1000;
      if (elapsedSec > 0) {
        const deltaBytes = item.downloadedSize - session.lastDownloadedBytes;
        const currentSpeed = Math.max(0, Math.floor(deltaBytes / elapsedSec));
        item.speed = currentSpeed;
        if (currentSpeed > item.peakSpeed) {
          item.peakSpeed = currentSpeed;
        }
        session.lastDownloadedBytes = item.downloadedSize;
        session.lastSpeedCheckTime = now;
        this.emitUpdate();
      }
    }, 500);

    const threadPromises = item.segments.map(async (seg) => {
      if (seg.currentByte >= seg.endByte) {
        seg.status = 'completed';
        return;
      }

      const controller = new AbortController();
      const threadBuffer: Uint8Array[] = [];
      session.threads.set(seg.id, { controller, buffer: threadBuffer });

      seg.status = 'downloading';

      try {
        const chunkUrl = `/api/chunk?url=${encodeURIComponent(item.url)}&start=${seg.currentByte}&end=${seg.endByte}${
          item.headers.referer ? `&referer=${encodeURIComponent(item.headers.referer)}` : ''
        }${item.sourcePageUrl ? `&sourcePageUrl=${encodeURIComponent(item.sourcePageUrl)}` : ''}${
          item.headers.userAgent ? `&userAgent=${encodeURIComponent(item.headers.userAgent)}` : ''
        }`;

        let response: Response | null = null;
        let lastErr: any = null;

        // Up to 3 retries per thread
        for (let attempt = 0; attempt < 3; attempt++) {
          if (controller.signal.aborted || item.status !== 'downloading') break;
          try {
            const res = await fetch(chunkUrl, {
              signal: controller.signal,
            });
            if (res.ok || res.status === 206) {
              response = res;
              break;
            }
            lastErr = new Error(`HTTP ${res.status}`);
          } catch (fetchErr: any) {
            lastErr = fetchErr;
            if (controller.signal.aborted) break;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }

        if (!response || (!response.ok && response.status !== 206)) {
          throw lastErr || new Error('Échec de la requête du segment');
        }

        if (!response.body) {
          throw new Error('Corps de réponse vide');
        }

        const reader = response.body.getReader();
        let threadLastTime = Date.now();
        let threadLastBytes = 0;

        while (true) {
          const remaining = (seg.endByte + 1) - seg.currentByte;
          if (remaining <= 0) break;

          const { done, value } = await reader.read();
          if (done) break;

          if (value && value.byteLength > 0) {
            const bytesToTake = Math.min(value.byteLength, remaining);
            const slice = bytesToTake === value.byteLength ? value : value.subarray(0, bytesToTake);

            threadBuffer.push(slice);
            seg.currentByte += bytesToTake;
            item.downloadedSize += bytesToTake;

            // Update thread speed
            const now = Date.now();
            if (now - threadLastTime >= 500) {
              const delta = (seg.currentByte - seg.startByte) - threadLastBytes;
              seg.speed = Math.floor((delta / (now - threadLastTime)) * 1000);
              threadLastTime = now;
              threadLastBytes = seg.currentByte - seg.startByte;
            }

            // Optional client-side throttle
            if (speedLimitKBps > 0) {
              const delay = Math.floor((bytesToTake / (speedLimitKBps * 1024)) * 1000);
              if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 50)));
            }

            if (seg.currentByte > seg.endByte) break;
          }
        }

        seg.status = 'completed';
        seg.currentByte = seg.endByte;
        seg.speed = 0;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          seg.status = 'paused';
          seg.speed = 0;
        } else {
          console.error(`Thread ${seg.id} error:`, err);
          seg.status = 'error';
          seg.speed = 0;
        }
      }
    });

    await Promise.all(threadPromises);

    // Stop speed ticker
    if (session.speedTimer) clearInterval(session.speedTimer);

    // Verify completion
    const allDone = item.segments.every((s) => s.status === 'completed');
    if (allDone && item.status !== 'paused' && item.status !== 'canceled') {
      try {
        // Concatenate all thread buffers into a real Blob
        const orderedChunks: Uint8Array[] = [];
        for (const seg of item.segments) {
          const threadObj = session.threads.get(seg.id);
          if (threadObj && threadObj.buffer) {
            orderedChunks.push(...threadObj.buffer);
          }
        }

        const mimeType = item.format === 'webm' ? 'video/webm' : 'video/mp4';
        const finalBlob = new Blob(orderedChunks, { type: mimeType });
        const objectUrl = URL.createObjectURL(finalBlob);

        item.blobUrl = objectUrl;
        item.status = 'completed';
        item.speed = 0;
        item.completedAt = Date.now();
        item.downloadedSize = item.totalSize;

        // Persist real Blob in IndexedDB (non-blocking)
        saveVideoBlob(item.id, finalBlob, `${item.title}.${item.format}`).catch(() => {});
      } catch (mergeErr) {
        console.error('Error assembling final video blob:', mergeErr);
        item.status = 'error';
        item.error = 'Erreur lors de l assemblage du fichier vidéo';
      }
    } else if (!allDone && item.status === 'downloading') {
      const hasErrors = item.segments.some((s) => s.status === 'error');
      if (hasErrors) {
        item.status = 'error';
        item.error = 'Le serveur source a interrompu la connexion. Cliquez sur Réessayer pour relancer.';
      }
    }

    this.emitUpdate();
  }

  // REAL HLS Segment Downloader
  private async startHlsDownload(item: DownloadItem, speedLimitKBps: number = 0) {
    const session: ActiveDownloadSession = {
      threads: new Map(),
      hlsBuffers: new Map(),
      hlsControllers: new Map(),
      lastDownloadedBytes: item.downloadedSize,
      lastSpeedCheckTime: Date.now(),
    };
    this.sessions.set(item.id, session);

    try {
      let segData: any = null;
      let lastFetchErr: any = null;

      // Resilient playlist fetch with 3 attempts and exponential backoff
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (item.status !== 'downloading') return;
        try {
          const qualityParam = item.quality ? `&quality=${encodeURIComponent(item.quality)}` : '';
          const sourcePageParam = item.sourcePageUrl ? `&sourcePageUrl=${encodeURIComponent(item.sourcePageUrl)}` : '';
          const refererParam = item.headers.referer ? `&referer=${encodeURIComponent(item.headers.referer)}` : '';

          const segRes = await fetch(
            `/api/hls-segments?url=${encodeURIComponent(item.url)}${qualityParam}${refererParam}${sourcePageParam}`
          );

          if (!segRes.ok) {
            const errJson = await segRes.json().catch(() => null);
            throw new Error(errJson?.error || `HTTP ${segRes.status}`);
          }

          segData = await segRes.json();
          if (segData && segData.success && (segData.isDirectVideo || (segData.segments && segData.segments.length > 0))) {
            break;
          }
          throw new Error(segData?.error || 'Aucun segment trouvé');
        } catch (fetchErr: any) {
          lastFetchErr = fetchErr;
          console.warn(`HLS playlist fetch attempt ${attempt} failed:`, fetchErr?.message || fetchErr);
          if (item.status !== 'downloading') return;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 750));
          }
        }
      }

      // If HLS failed, try an automatic re-resolution via resolve-embed before giving up
      if (!segData || !segData.success || (!segData.isDirectVideo && (!segData.segments || segData.segments.length === 0))) {
        let fallbackTarget = item.sourcePageUrl || item.headers.referer;
        if (!fallbackTarget || (!fallbackTarget.includes('ansembed') && !fallbackTarget.includes('vidmoly') && !fallbackTarget.includes('sibnet') && !fallbackTarget.includes('voe') && !fallbackTarget.includes('anime-sama'))) {
          // Check if video ID can be extracted from item.url (e.g. vmget.online or vidmoly or ansembed)
          const vidMatch = item.url.match(/\/([a-zA-Z0-9]{8,16})[_,]/i);
          if (vidMatch && vidMatch[1]) {
            fallbackTarget = `https://ansembed.net/embed-${vidMatch[1]}.html`;
          }
        }

        if (fallbackTarget) {
          try {
            const reRes = await fetch('/api/resolve-embed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: fallbackTarget,
                embedUrl: fallbackTarget,
                referer: item.headers.referer || fallbackTarget,
                userAgent: item.headers.userAgent,
              }),
            });
            const reData = await reRes.json();
            if (reData?.success && reData.streamUrl && reData.streamUrl !== item.url) {
              item.url = reData.streamUrl;
              if (reData.headers?.referer) item.headers.referer = reData.headers.referer;
              const retryParam = item.headers.referer ? `&referer=${encodeURIComponent(item.headers.referer)}` : '';
              const retryRes = await fetch(`/api/hls-segments?url=${encodeURIComponent(item.url)}${retryParam}`);
              if (retryRes.ok) {
                const retryJson = await retryRes.json();
                if (retryJson.success && (retryJson.isDirectVideo || (retryJson.segments && retryJson.segments.length > 0))) {
                  segData = retryJson;
                }
              }
            }
          } catch {}
        }
      }

      // Check if upstream is direct video (e.g. MP4/WebM)
      if (segData?.isDirectVideo) {
        item.isHls = false;
        item.url = segData.streamUrl || item.url;
        item.format = (segData.format as any) || item.format || 'mp4';
        if (segData.estimatedBytes) item.totalSize = segData.estimatedBytes;
        if (segData.effectiveReferer) item.headers.referer = segData.effectiveReferer;
        this.startRangeDownload(item, speedLimitKBps);
        return;
      }

      if (!segData || !segData.success || !segData.segments || segData.segments.length === 0) {
        const errorMsg = lastFetchErr?.message === 'Load failed'
          ? 'Connexion réseau instable lors de l extraction du flux. Cliquez sur Réessayer.'
          : (lastFetchErr?.message || segData?.error || 'Impossible de lire les segments HLS');
        throw new Error(errorMsg);
      }

      if (segData.streamUrl && segData.streamUrl !== item.url) {
        item.url = segData.streamUrl;
      }
      if (segData.estimatedBytes && segData.estimatedBytes > 0) {
        item.totalSize = segData.estimatedBytes;
      }
      if (segData.selectedQuality) {
        item.quality = `${segData.selectedQuality} ${segData.selectedResolution || ''}`.trim();
      }
      if (segData.variants && Array.isArray(segData.variants) && segData.variants.length > 0) {
        item.availableVariants = segData.variants;
      }

      const effectiveReferer = segData.effectiveReferer || item.headers.referer;
      const hlsSegments: Array<{ index: number; url: string; duration: number; isInit?: boolean }> = segData.segments;
      item.hlsSegmentsTotal = hlsSegments.length;
      item.hlsSegmentsDone = 0;

      // Speed telemetry
      session.speedTimer = setInterval(() => {
        const now = Date.now();
        const elapsedSec = (now - session.lastSpeedCheckTime) / 1000;
        if (elapsedSec > 0) {
          const deltaBytes = item.downloadedSize - session.lastDownloadedBytes;
          const currentSpeed = Math.max(0, Math.floor(deltaBytes / elapsedSec));
          item.speed = currentSpeed;
          if (currentSpeed > item.peakSpeed) item.peakSpeed = currentSpeed;
          session.lastDownloadedBytes = item.downloadedSize;
          session.lastSpeedCheckTime = now;
          this.emitUpdate();
        }
      }, 500);

      // Download segments in parallel batches across all threads
      const numThreads = Math.max(1, item.segments.length || item.threadsCount || 6);
      const concurrency = Math.min(numThreads, 8);
      let activeIndex = 0;

      const worker = async (workerId: number) => {
        while (activeIndex < hlsSegments.length && item.status === 'downloading') {
          const currentSegIndex = activeIndex++;
          const segInfo = hlsSegments[currentSegIndex];
          if (!segInfo) break;

          // Skip if segment was already successfully downloaded in this session
          if (session.hlsBuffers.has(currentSegIndex)) {
            continue;
          }

          try {
            // Fetch segment through proxy with dynamic referer and sourcePageUrl
            const segReferer = item.headers.referer || effectiveReferer;
            const proxyUrl = `/api/chunk?url=${encodeURIComponent(segInfo.url)}${
              segReferer ? `&referer=${encodeURIComponent(segReferer)}` : ''
            }${item.sourcePageUrl ? `&sourcePageUrl=${encodeURIComponent(item.sourcePageUrl)}` : ''}${
              item.headers.userAgent ? `&userAgent=${encodeURIComponent(item.headers.userAgent)}` : ''
            }`;
            
            let res: Response | null = null;
            for (let attempt = 0; attempt < 4; attempt++) {
              if (item.status !== 'downloading') return;

              const attemptCtrl = new AbortController();
              session.hlsControllers.set(currentSegIndex, attemptCtrl);

              // 25 second timeout safeguard so no worker is stuck indefinitely
              const timeoutId = setTimeout(() => {
                try {
                  attemptCtrl.abort();
                } catch {}
              }, 25000);

              try {
                const fetchRes = await fetch(proxyUrl, { signal: attemptCtrl.signal });
                clearTimeout(timeoutId);
                if (fetchRes.ok || fetchRes.status === 206) {
                  res = fetchRes;
                  break;
                }
              } catch (e: any) {
                clearTimeout(timeoutId);
                if (item.status !== 'downloading') return;
                await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
              }
            }

            if (!res || (!res.ok && res.status !== 206)) {
              console.warn(`HLS segment ${currentSegIndex} unreachable after retries (status ${res?.status})`);
              continue;
            }

            const arrayBuf = await res.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuf);
            session.hlsBuffers.set(currentSegIndex, uint8);

            item.downloadedSize += uint8.byteLength;
            item.hlsSegmentsDone = session.hlsBuffers.size;

            // Dynamically calibrate totalSize based on average actual segment weight
            if (item.hlsSegmentsTotal && item.hlsSegmentsTotal > 0 && item.hlsSegmentsDone > 0) {
              const avgBytes = item.downloadedSize / item.hlsSegmentsDone;
              item.totalSize = Math.max(item.downloadedSize, Math.round(avgBytes * item.hlsSegmentsTotal));
            }

            // Reflect on UI threads for visual feedback evenly across all slots
            const threadSlot = workerId % item.segments.length;
            if (item.segments[threadSlot]) {
              const threadSegGoal = Math.max(1, Math.ceil(hlsSegments.length / item.segments.length));
              const currentThreadSegs = Math.min(threadSegGoal, Math.ceil(item.hlsSegmentsDone / item.segments.length));
              const threadPct = Math.min(100, Math.round((currentThreadSegs / threadSegGoal) * 100));
              const seg = item.segments[threadSlot];
              seg.currentByte = Math.round(seg.startByte + (threadPct / 100) * (seg.endByte - seg.startByte));
              seg.status = threadPct >= 100 ? 'completed' : 'downloading';
            }

            if (speedLimitKBps > 0) {
              await new Promise((r) => setTimeout(r, 50));
            }
          } catch (segErr: any) {
            if (segErr.name === 'AbortError' && item.status !== 'downloading') return;
            console.warn(`HLS segment ${currentSegIndex} error:`, segErr);
          }
        }
      };

      const workers = Array.from({ length: concurrency }).map((_, wId) => worker(wId));
      await Promise.all(workers);

      if (session.speedTimer) clearInterval(session.speedTimer);

      if (item.status !== 'paused' && item.status !== 'canceled') {
        const downloadedCount = session.hlsBuffers.size;
        const totalCount = hlsSegments.length;

        // Strict integrity check: if more than 3 segments are missing, do NOT falsely complete
        if (downloadedCount < Math.max(1, totalCount - 2)) {
          item.status = 'error';
          item.error = `Téléchargement partiel (${downloadedCount}/${totalCount} segments). Touchez 'Réessayer' pour continuer sans repartir de zéro.`;
          item.speed = 0;
          this.emitUpdate();
          return;
        }

        // Merge real TS segments into an ordered buffer
        const orderedTsBuffers: Uint8Array[] = [];
        for (let i = 0; i < hlsSegments.length; i++) {
          const buf = session.hlsBuffers.get(i);
          if (buf) orderedTsBuffers.push(buf);
        }

        if (orderedTsBuffers.length === 0) {
          throw new Error('Aucun segment n\'a pu être assemblé');
        }

        const rawTsBlob = new Blob(orderedTsBuffers, { type: 'video/mp2t' });
        item.speed = 0;
        item.totalSize = item.downloadedSize;
        item.hlsSegmentsDone = downloadedCount;

        // Auto-remux TS segments into a pristine, universal Apple MP4 via FFmpeg on the server
        let finalBlob: Blob = rawTsBlob;
        try {
          const remuxRes = await fetch(`/api/remux-to-mp4?title=${encodeURIComponent(item.title)}`, {
            method: 'POST',
            body: rawTsBlob,
          });
          if (remuxRes.ok) {
            const mp4Blob = await remuxRes.blob();
            if (mp4Blob && mp4Blob.size > 1000) {
              finalBlob = mp4Blob;
            }
          }
        } catch (remuxErr) {
          console.warn('Auto remuxing skipped or failed, using raw blob:', remuxErr);
        }

        const blobUrl = URL.createObjectURL(finalBlob);
        item.blobUrl = blobUrl;
        item.format = 'mp4'; // Always present as MP4 to guarantee native iOS / QuickTime support
        item.isHls = false;
        item.status = 'completed';
        item.completedAt = Date.now();
        item.segments.forEach((s) => {
          s.status = 'completed';
          s.currentByte = s.endByte;
          s.speed = 0;
        });

        // Persist real MP4 video in IndexedDB (non-blocking)
        saveVideoBlob(item.id, finalBlob, `${item.title}.mp4`).catch(() => {});
      }
    } catch (hlsErr: any) {
      if (session.speedTimer) clearInterval(session.speedTimer);
      console.error('HLS Download Failed:', hlsErr);
      item.status = 'error';
      item.error = hlsErr.message || 'Échec du téléchargement HLS';
    }

    this.emitUpdate();
  }

  public pause(id: string) {
    const item = this.downloads.find((d) => d.id === id);
    if (!item || item.status !== 'downloading') return;

    item.status = 'paused';
    item.speed = 0;
    item.segments.forEach((seg) => {
      if (seg.status === 'downloading') {
        seg.status = 'paused';
        seg.speed = 0;
      }
    });

    const session = this.sessions.get(id);
    if (session) {
      if (session.speedTimer) clearInterval(session.speedTimer);
      if (session.serverPollingTimer) clearTimeout(session.serverPollingTimer);
      session.serverAbortController?.abort();
      session.threads.forEach((t) => t.controller.abort());
      session.hlsControllers.forEach((c) => c.abort());
    }

    this.emitUpdate();
  }

  public resume(id: string, speedLimitKBps: number = 0) {
    const item = this.downloads.find((d) => d.id === id);
    if (!item || item.status !== 'paused') return;

    item.status = 'downloading';
    this.emitUpdate();

    this.startServerDownload(item, speedLimitKBps);
  }

  public cancel(id: string) {
    const item = this.downloads.find((d) => d.id === id);
    if (item) {
      if (item.serverJobId) {
        fetch(`/api/download/cancel/${item.serverJobId}`, { method: 'POST' }).catch(() => {});
      }
      item.status = 'canceled';
      item.speed = 0;
    }

    const session = this.sessions.get(id);
    if (session) {
      if (session.speedTimer) clearInterval(session.speedTimer);
      if (session.serverPollingTimer) clearTimeout(session.serverPollingTimer);
      session.serverAbortController?.abort();
      session.threads.forEach((t) => t.controller.abort());
      session.hlsControllers.forEach((c) => c.abort());
      this.sessions.delete(id);
    }

    this.downloads = this.downloads.filter((d) => d.id !== id);
    this.emitUpdate();
  }

  public async retry(id: string, speedLimitKBps: number = 0) {
    const item = this.downloads.find((d) => d.id === id);
    if (!item) return;

    const oldSession = this.sessions.get(id);
    if (oldSession) {
      if (oldSession.speedTimer) clearInterval(oldSession.speedTimer);
      if (oldSession.serverPollingTimer) clearTimeout(oldSession.serverPollingTimer);
      oldSession.serverAbortController?.abort();
      oldSession.threads.forEach((t) => t.controller.abort());
      oldSession.hlsControllers.forEach((c) => c.abort());
      this.sessions.delete(id);
    }

    item.status = 'downloading';
    item.downloadedSize = 0;
    item.hlsSegmentsDone = 0;
    item.speed = 0;
    item.error = undefined;
    item.segments.forEach((seg) => {
      seg.currentByte = seg.startByte;
      seg.status = 'downloading';
      seg.speed = 0;
    });

    this.emitUpdate();

    // If sourcePageUrl or referer is available, attempt to re-resolve the embed to refresh expired CDN tokens
    let refreshTarget = item.sourcePageUrl || item.headers.referer;
    if (!refreshTarget || (!refreshTarget.includes('ansembed') && !refreshTarget.includes('vidmoly') && !refreshTarget.includes('sibnet') && !refreshTarget.includes('voe') && !refreshTarget.includes('sendvid') && !refreshTarget.includes('embed') && !refreshTarget.includes('anime-sama'))) {
      const vidMatch = item.url.match(/\/([a-zA-Z0-9]{8,16})[_,]/i);
      if (vidMatch && vidMatch[1]) {
        refreshTarget = `https://ansembed.net/embed-${vidMatch[1]}.html`;
      }
    }
    if (refreshTarget && (refreshTarget.includes('ansembed') || refreshTarget.includes('vidmoly') || refreshTarget.includes('sibnet') || refreshTarget.includes('voe') || refreshTarget.includes('sendvid') || refreshTarget.includes('embed') || refreshTarget.includes('anime-sama'))) {
      try {
        const resolveRes = await fetch('/api/resolve-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: refreshTarget,
            embedUrl: refreshTarget,
            referer: item.headers.referer || refreshTarget,
            userAgent: item.headers.userAgent,
          }),
        });
        const resolved = await resolveRes.json();
        if (resolved && resolved.success && resolved.streamUrl) {
          item.url = resolved.streamUrl;
          if (resolved.format) {
            item.format = resolved.format;
            item.isHls = resolved.format === 'm3u8';
          }
          if (resolved.headers?.referer) item.headers.referer = resolved.headers.referer;
        }
      } catch {
        // Continue with existing URL if re-resolution fails
      }
    }

    this.startServerDownload(item, speedLimitKBps);
  }

  public async changeQuality(id: string, newQuality: string, speedLimitKBps: number = 0) {
    const item = this.downloads.find((d) => d.id === id);
    if (!item) return;

    // 1. Abort existing active session
    const session = this.sessions.get(id);
    if (session) {
      if (session.speedTimer) clearInterval(session.speedTimer);
      if (session.serverPollingTimer) clearTimeout(session.serverPollingTimer);
      session.serverAbortController?.abort();
      session.threads.forEach((t) => t.controller.abort());
      session.hlsControllers.forEach((c) => c.abort());
      session.hlsBuffers.clear();
      this.sessions.delete(id);
    }

    // 2. Update quality property and reset progress
    item.quality = newQuality;
    item.status = 'downloading';
    item.downloadedSize = 0;
    item.hlsSegmentsDone = 0;
    item.speed = 0;
    item.error = undefined;

    // If available variants exist, update estimated total size and stream URL
    if (item.availableVariants && item.availableVariants.length > 0) {
      const match = item.availableVariants.find(
        (v) =>
          v.qualityName.toLowerCase().includes(newQuality.toLowerCase()) ||
          newQuality.toLowerCase().includes(v.qualityName.toLowerCase()) ||
          (v.resolution && newQuality.toLowerCase().includes(v.resolution.toLowerCase()))
      );
      if (match) {
        if (match.estimatedBytes) item.totalSize = match.estimatedBytes;
        if (match.url) item.url = match.url;
      }
    } else {
      // Proportional size adjustment if variants list is not yet cached
      if (newQuality.includes('480')) {
        item.totalSize = Math.max(80000000, Math.round(item.totalSize * 0.35));
      } else if (newQuality.includes('720')) {
        item.totalSize = Math.max(180000000, Math.round(item.totalSize * 0.55));
      } else if (newQuality.includes('360')) {
        item.totalSize = Math.max(50000000, Math.round(item.totalSize * 0.22));
      }
    }

    // Reset segments
    item.segments.forEach((s) => {
      s.currentByte = s.startByte;
      s.status = 'downloading';
      s.speed = 0;
    });

    this.emitUpdate();

    // 3. Restart download with the new quality
    this.startServerDownload(item, speedLimitKBps);
  }

  public retryAllErrors(speedLimitKBps: number = 0) {
    const failedItems = this.downloads.filter((d) => d.status === 'error');
    failedItems.forEach((item) => {
      this.retry(item.id, speedLimitKBps);
    });
  }

  public clearAllErrors() {
    this.downloads = this.downloads.filter((d) => d.status !== 'error');
    this.emitUpdate();
  }

  public deleteCompleted(id: string) {
    const item = this.downloads.find((d) => d.id === id);
    if (item?.blobUrl && item.blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.blobUrl);
    }
    this.downloads = this.downloads.filter((d) => d.id !== id);
    this.emitUpdate();
  }

  public clearAllCompleted() {
    this.downloads.forEach((item) => {
      if (item.blobUrl && item.blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.blobUrl);
      }
    });
    this.downloads = this.downloads.filter((d) => d.status !== 'completed');
    this.emitUpdate();
  }

  private emitUpdate() {
    if (this.onUpdateCallback) {
      this.onUpdateCallback([...this.downloads]);
    }
  }

  public destroy() {
    this.sessions.forEach((s) => {
      if (s.speedTimer) clearInterval(s.speedTimer);
      s.threads.forEach((t) => t.controller.abort());
      s.hlsControllers.forEach((c) => c.abort());
    });
    this.sessions.clear();
  }
}
