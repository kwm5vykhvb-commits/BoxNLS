import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS for API routes
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization, User-Agent, Referer');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Probes a URL to get real HTTP headers (Content-Length, Accept-Ranges, Content-Type)
app.post('/api/probe', async (req, res) => {
  const { url, userAgent, referer, cookies } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL requise' });
    return;
  }

  const startTime = Date.now();
  try {
    const headers: Record<string, string> = {
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    };
    if (referer) headers['Referer'] = referer;
    if (cookies) headers['Cookie'] = cookies;

    // Try HEAD first
    let response = await fetch(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
    }).catch(() => null);

    // If HEAD fails or method not allowed (405), fallback to Range GET 0-1
    if (!response || response.status === 405 || response.status >= 400) {
      headers['Range'] = 'bytes=0-1';
      response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
      });
    }

    const durationMs = Date.now() - startTime;
    const finalUrl = response.url;
    const status = response.status;
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const acceptRanges = response.headers.get('accept-ranges') || '';
    const contentRange = response.headers.get('content-range') || '';
    
    let contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) {
        contentLength = parseInt(match[1], 10);
      }
    }

    const supportsRange = acceptRanges.toLowerCase().includes('bytes') || !!contentRange || status === 206;

    res.json({
      success: true,
      url,
      finalUrl,
      status,
      contentType,
      contentLength,
      supportsRange,
      durationMs,
      headers: {
        'content-type': contentType,
        'content-length': contentLength.toString(),
        'accept-ranges': acceptRanges,
        'content-range': contentRange,
        'server': response.headers.get('server') || 'unknown',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Erreur lors du probe HTTP',
      durationMs: Date.now() - startTime,
    });
  }
});

// Helper to get domain-adapted headers preventing 403 Forbidden on CDNs (VidMoly, Sibnet, Sendvid, Voe, etc.)
function getOptimalHeaders(url: string, requestedReferer?: string, requestedUa?: string, cookies?: string) {
  const ua = requestedUa || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': '*/*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  };

  let effectiveReferer = requestedReferer || '';
  const lowerUrl = url.toLowerCase();

  // If user provided a specific valid referer from the streaming site, preserve it!
  if (lowerUrl.includes('vmget.online') || lowerUrl.includes('vidmoly') || lowerUrl.includes('ansembed')) {
    if (!effectiveReferer || (!effectiveReferer.includes('vidmoly') && !effectiveReferer.includes('ansembed'))) {
      effectiveReferer = 'https://ansembed.net/';
    }
    try {
      headers['Origin'] = new URL(effectiveReferer).origin;
    } catch {
      headers['Origin'] = 'https://ansembed.net';
    }
  } else if (lowerUrl.includes('sibnet.ru')) {
    if (!effectiveReferer || !effectiveReferer.includes('sibnet.ru')) {
      effectiveReferer = 'https://video.sibnet.ru/';
    }
    headers['Origin'] = 'https://video.sibnet.ru';
  } else if (lowerUrl.includes('sendvid.com')) {
    if (!effectiveReferer || !effectiveReferer.includes('sendvid.com')) {
      effectiveReferer = 'https://sendvid.com/';
    }
    headers['Origin'] = 'https://sendvid.com';
  } else if (lowerUrl.includes('voe.sx') || lowerUrl.includes('voe-network') || lowerUrl.includes('voe.')) {
    if (!effectiveReferer || !effectiveReferer.includes('voe.')) {
      effectiveReferer = 'https://voe.sx/';
    }
    headers['Origin'] = 'https://voe.sx';
  } else if (effectiveReferer) {
    try {
      const u = new URL(effectiveReferer);
      headers['Origin'] = u.origin;
    } catch {}
  }

  if (effectiveReferer) headers['Referer'] = effectiveReferer;
  if (cookies && typeof cookies === 'string') headers['Cookie'] = cookies;

  return { headers, effectiveReferer };
}

// Unpacker for Dean Edwards P.A.C.K.E.R encoded Javascript (used by VidMoly, VOE, Streamtape, Ansembed)
function unpackDeanEdwards(packedCode: string): string {
  try {
    const match = packedCode.match(/eval\(function\(p,a,c,k,e,[rd]\)\{.+?\}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s) ||
                  packedCode.match(/eval\(function\(p,a,c,k,e,[rd]\)\{.+?\}\s*\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s);
    if (!match) return '';
    let [_, p, aStr, cStr, kStr] = match;
    let a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    let k = kStr.split('|');
    const e = (val: number): string => (val < a ? '' : e(Math.floor(val / a))) + ((val = val % a) > 35 ? String.fromCharCode(val + 29) : val.toString(36));
    while (c--) {
      if (k[c]) {
        p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
      }
    }
    return p;
  } catch {
    return '';
  }
}

// Extract source embed URL from a CDN stream URL if tokens expired
function extractEmbedUrlFromStream(streamUrl: string): string | null {
  if (!streamUrl) return null;
  if (streamUrl.includes('vmget.online') || streamUrl.includes('vidmoly') || streamUrl.includes('ansembed')) {
    const m = streamUrl.match(/\/([a-zA-Z0-9]{8,16})[_,]/i);
    if (m && m[1]) {
      return `https://ansembed.net/embed-${m[1]}.html`;
    }
  }
  if (streamUrl.includes('sibnet.ru')) {
    const m = streamUrl.match(/(\d{5,8})/);
    if (m && m[1]) {
      return `https://video.sibnet.ru/shell.php?videoid=${m[1]}`;
    }
  }
  return null;
}

// Extractor that parses HTML/JS content to detect video streams directly
function extractStreamFromHtml(
  html: string,
  pageUrl: string,
  userAgent?: string
): { streamUrl: string; format: 'm3u8' | 'mp4' | 'webm'; quality: string; thumbnail?: string; headers: Record<string, string> } | null {
  if (!html) return null;

  // Try unpacking packed JS if present
  let unpackedCode = '';
  const packedMatches = html.match(/eval\(function\(p,a,c,k,e,[rd]\).+?\.split\('\|'\)\)\)/gs) || [];
  for (const pMatch of packedMatches) {
    unpackedCode += '\n' + unpackDeanEdwards(pMatch);
  }
  const combinedText = html + '\n' + unpackedCode;

  // 1. VidMoly / ansembed: sources: [{ file: '...' }] or file: '...'
  const sourcesMatch = combinedText.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+)['"]/i) ||
                       combinedText.match(/file:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i) ||
                       combinedText.match(/["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)[^"'\s<>]*)["']/i);
  const imgMatch = combinedText.match(/image:\s*['"]([^'"]+)['"]/i);
  const labelMatch = combinedText.match(/label:\s*['"]([^'"]+)['"]/i);

  if (sourcesMatch && sourcesMatch[1]) {
    const streamUrl = sourcesMatch[1];
    const isM3u8 = streamUrl.includes('.m3u8');
    return {
      streamUrl,
      format: isM3u8 ? 'm3u8' : 'mp4',
      quality: labelMatch ? labelMatch[1] : (isM3u8 ? '1080p Full HD' : '720p HD'),
      thumbnail: imgMatch ? imgMatch[1] : undefined,
      headers: {
        referer: pageUrl.includes('vidmoly') ? pageUrl : 'https://ansembed.net/',
      },
    };
  }

  // 2. Sibnet player
  const sibnetMatch = combinedText.match(/(?:player\.src\(\[\{\s*src:\s*|src:\s*)["']([^"']+\.mp4[^"']*)["']/i) ||
                      combinedText.match(/["'](\/upload\/[^"']+\.mp4[^"']*)["']/i);
  if (sibnetMatch && sibnetMatch[1]) {
    const streamUrl = new URL(sibnetMatch[1], 'https://video.sibnet.ru').href;
    return {
      streamUrl,
      format: 'mp4',
      quality: '720p HD',
      headers: {
        referer: 'https://video.sibnet.ru/',
      },
    };
  }

  // 3. Sendvid
  const sendvidMatch = combinedText.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i) ||
                       combinedText.match(/var\s+video_source\s*=\s*["']([^"']+)["']/i);
  if (sendvidMatch && sendvidMatch[1]) {
    return {
      streamUrl: sendvidMatch[1],
      format: 'mp4',
      quality: '720p HD',
      headers: {
        referer: 'https://sendvid.com/',
      },
    };
  }

  // 4. Voe: hls: '...' or base64 sources
  const voeMatch = combinedText.match(/(?:'hls'|"hls"|hls)\s*:\s*['"]([^'"]+)['"]/i) ||
                   combinedText.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
  if (voeMatch && voeMatch[1]) {
    return {
      streamUrl: voeMatch[1],
      format: 'm3u8',
      quality: '1080p Full HD',
      headers: {
        referer: pageUrl,
      },
    };
  }

  // VOE base64 decoded match
  const b64Matches = combinedText.matchAll(/atob\(['"]([A-Za-z0-9+/=]{20,})['"]\)/g);
  for (const b64m of b64Matches) {
    try {
      const decoded = Buffer.from(b64m[1], 'base64').toString('utf-8');
      const m3u8Inside = decoded.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
      if (m3u8Inside) {
        const streamUrl = m3u8Inside[1];
        const isM3u8 = streamUrl.includes('.m3u8');
        return {
          streamUrl,
          format: isM3u8 ? 'm3u8' : 'mp4',
          quality: isM3u8 ? '1080p Full HD' : '720p HD',
          headers: { referer: pageUrl },
        };
      }
    } catch {}
  }

  // 5. Generic .m3u8 or .mp4 inside embed HTML
  const genericStream = combinedText.match(/["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4|webm)(?:\?[^"'\s<>]*)?)["']/i);
  if (genericStream && genericStream[1]) {
    const sUrl = genericStream[1];
    const isM3u8 = sUrl.includes('.m3u8');
    return {
      streamUrl: sUrl,
      format: isM3u8 ? 'm3u8' : 'mp4',
      quality: isM3u8 ? '1080p HD' : '720p',
      headers: {
        referer: pageUrl,
      },
    };
  }

  return null;
}

// Helper to resolve embed links (VidMoly, ansembed, sibnet, sendvid, voe, etc.) into real video streams
async function resolveEmbedStream(
  embedUrl: string,
  referer: string,
  userAgent: string
): Promise<{ streamUrl: string; format: 'm3u8' | 'mp4' | 'webm'; quality: string; thumbnail?: string; headers: Record<string, string> } | null> {
  // If already a direct media URL, return directly
  const cleanUrl = embedUrl.split('#')[0];
  if (cleanUrl.match(/\.(m3u8|mp4|webm)(\?.*)?$/i)) {
    const isM3u8 = cleanUrl.includes('.m3u8');
    const { headers, effectiveReferer } = getOptimalHeaders(embedUrl, referer || embedUrl, userAgent);
    return {
      streamUrl: embedUrl,
      format: isM3u8 ? 'm3u8' : cleanUrl.includes('.webm') ? 'webm' : 'mp4',
      quality: isM3u8 ? '1080p Full HD' : '720p HD',
      headers: {
        referer: effectiveReferer,
        userAgent: headers['User-Agent'],
      },
    };
  }

  // If stream URL is from vmget or sibnet whose token expired, extract real embed page
  const extracted = extractEmbedUrlFromStream(embedUrl);
  const targetUrl = extracted || embedUrl;

  try {
    const { headers: fetchHeaders } = getOptimalHeaders(targetUrl, referer || targetUrl, userAgent);
    const res = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    });
    const html = await res.text();
    const finalEmbedUrl = res.url;

    // First try direct extraction from fetched HTML
    const extractedStream = extractStreamFromHtml(html, finalEmbedUrl, userAgent);
    if (extractedStream) return extractedStream;

    // If catalog or episode page with episode arrays
    if (html.includes('eps1') || html.includes('eps2') || html.includes('eps3')) {
      const eps2Match = html.match(/var\s+eps2\s*=\s*\[(.*?)\];/s);
      const eps1Match = html.match(/var\s+eps1\s*=\s*\[(.*?)\];/s);
      const eps3Match = html.match(/var\s+eps3\s*=\s*\[(.*?)\];/s);
      const matches = [eps2Match, eps1Match, eps3Match].filter(Boolean);
      const targetMatch = matches.find((m) => m && (m[1].includes('ansembed') || m[1].includes('vidmoly') || m[1].includes('sibnet') || m[1].includes('voe'))) || matches[0];
      if (targetMatch && targetMatch[1]) {
        const epUrls = (targetMatch[1].match(/['"](https?:[^'"]+)['"]/g) || []).map((u) => u.replace(/['"]/g, ''));
        if (epUrls.length > 0) {
          const firstEpResolved = await resolveEmbedStream(epUrls[0], finalEmbedUrl, userAgent);
          if (firstEpResolved) return firstEpResolved;
        }
      }
    }
  } catch (err) {
    // Ignore resolution errors
  }
  return null;
}

// Sniffs a real web page and extracts all media files (.mp4, .m3u8, .webm, audio, etc.)
app.post('/api/sniff-page', async (req, res) => {
  const { url, userAgent, referer, cookies } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL requise' });
    return;
  }

  const startTime = Date.now();
  try {
    const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    const headers: Record<string, string> = {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    };
    if (referer) headers['Referer'] = referer;
    if (cookies) headers['Cookie'] = cookies;

    // Check if the URL passed is ITSELF an embed URL
    if (url.includes('ansembed.net') || url.includes('vidmoly.') || url.includes('sibnet.ru') || url.includes('sendvid.com') || url.includes('voe.')) {
      const directResolved = await resolveEmbedStream(url, referer || url, ua);
      if (directResolved) {
        res.json({
          success: true,
          pageTitle: 'Flux Détecté',
          finalUrl: url,
          durationMs: Date.now() - startTime,
          discoveredCount: 1,
          medias: [
            {
              id: `sniff-${Date.now()}-0`,
              title: `Vidéo directe (${directResolved.quality})`,
              url: directResolved.streamUrl,
              format: directResolved.format,
              quality: directResolved.quality,
              estimatedSize: directResolved.format === 'm3u8' ? 120000000 : 75000000,
              headers: directResolved.headers,
              timestamp: Date.now(),
              thumbnail: directResolved.thumbnail || 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&auto=format&fit=crop&q=80',
              duration: directResolved.format === 'm3u8' ? 'Live / HLS' : 'Direct',
              sourcePageUrl: url,
            },
          ],
        });
        return;
      }
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    const finalUrl = response.url;
    const html = await response.text();
    const durationMs = Date.now() - startTime;

    // Extract Page Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let pageTitle = titleMatch ? titleMatch[1].trim() : new URL(finalUrl).hostname;
    if (pageTitle.includes('|')) {
      pageTitle = pageTitle.split('|')[0].trim();
    }

    // Extract Favicon or OpenGraph image or Anime-Sama poster
    const animeSamaPoster = html.match(/<img[^>]+id=["']imgOeuvre["'][^>]+src=["']([^"']+)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const pageThumbnail = animeSamaPoster
      ? animeSamaPoster[1]
      : ogImageMatch
      ? new URL(ogImageMatch[1], finalUrl).href
      : '';

    const validMedias: any[] = [];

    // --- A. DEEP DETECTION: Anime-Sama and Streaming Episode Arrays ---
    const scriptMatch = html.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i) ||
                        html.match(/<script[^>]+src=['"]([^'"]*(?:episodes|player|videos?)\.js[^'"]*)['"]/i);

    let episodesScriptContent = '';
    if (scriptMatch && scriptMatch[1]) {
      try {
        const jsUrl = new URL(scriptMatch[1], finalUrl).href;
        const jsRes = await fetch(jsUrl, {
          headers: {
            'User-Agent': ua,
            'Referer': finalUrl,
          },
        });
        episodesScriptContent = await jsRes.text();
      } catch (e) {
        // ignore
      }
    }

    // Check script content or inline HTML for episode arrays (eps1, eps2, etc.)
    const jsSourceToScan = episodesScriptContent || html;
    if (jsSourceToScan.includes('eps1') || jsSourceToScan.includes('eps2') || jsSourceToScan.includes('eps3')) {
      // Prioritize eps2 (VidMoly / ansembed: fast 1080p Full HD), then eps1, eps3
      const eps2Match = jsSourceToScan.match(/var\s+eps2\s*=\s*\[(.*?)\];/s);
      const eps1Match = jsSourceToScan.match(/var\s+eps1\s*=\s*\[(.*?)\];/s);
      const eps3Match = jsSourceToScan.match(/var\s+eps3\s*=\s*\[(.*?)\];/s);

      const targetMatch = eps2Match || eps1Match || eps3Match;
      if (targetMatch && targetMatch[1]) {
        const rawEpisodeUrls = (targetMatch[1].match(/['"](https?:[^'"]+)['"]/g) || []).map((u) => u.replace(/['"]/g, ''));

        if (rawEpisodeUrls.length > 0) {
          // Concurrently resolve up to 10 episodes immediately for fast response
          const immediateToResolve = rawEpisodeUrls.slice(0, 10);
          const resolvedEpisodes = await Promise.all(
            immediateToResolve.map(async (embedUrl, idx) => {
              const epNum = idx + 1;
              const epNumStr = epNum < 10 ? `0${epNum}` : `${epNum}`;
              const epTitle = `${pageTitle} - Épisode ${epNumStr} VF (1080p Full HD)`;

              const resolved = await resolveEmbedStream(embedUrl, finalUrl, ua);
              if (resolved) {
                return {
                  id: `sniff-ep-${epNum}-${Date.now()}`,
                  title: epTitle,
                  url: resolved.streamUrl,
                  format: resolved.format,
                  quality: resolved.quality || '1080p Full HD',
                  estimatedSize: 145000000,
                  headers: resolved.headers,
                  timestamp: Date.now(),
                  thumbnail: resolved.thumbnail || pageThumbnail || 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&auto=format&fit=crop&q=80',
                  duration: 'Épisode (1080p)',
                  sourcePageUrl: embedUrl,
                };
              } else {
                // Fallback entry with embed link if resolution took too long or failed
                return {
                  id: `sniff-ep-${epNum}-${Date.now()}`,
                  title: `${pageTitle} - Épisode ${epNumStr} VF`,
                  url: embedUrl,
                  format: 'm3u8' as const,
                  quality: 'HD Stream',
                  estimatedSize: 120000000,
                  headers: { referer: finalUrl },
                  timestamp: Date.now(),
                  thumbnail: pageThumbnail,
                  duration: 'Épisode',
                  sourcePageUrl: embedUrl,
                };
              }
            })
          );

          validMedias.push(...resolvedEpisodes.filter(Boolean));

          // Also include placeholders for remaining episodes (11+) so the user sees all available episodes
          if (rawEpisodeUrls.length > 10) {
            for (let i = 10; i < rawEpisodeUrls.length; i++) {
              const epNum = i + 1;
              const epNumStr = epNum < 10 ? `0${epNum}` : `${epNum}`;
              validMedias.push({
                id: `sniff-ep-${epNum}-${Date.now()}`,
                title: `${pageTitle} - Épisode ${epNumStr} VF`,
                url: rawEpisodeUrls[i],
                format: 'm3u8',
                quality: '1080p Full HD',
                estimatedSize: 145000000,
                headers: { referer: finalUrl },
                timestamp: Date.now(),
                thumbnail: pageThumbnail,
                duration: 'Épisode',
                sourcePageUrl: rawEpisodeUrls[i],
                isPendingEmbed: true,
              });
            }
          }
        }
      }
    }

    // --- B. Iframe Embeds Extraction ---
    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let iframeMatch;
    const iframeUrls: string[] = [];
    while ((iframeMatch = iframeRegex.exec(html)) !== null) {
      const src = iframeMatch[1];
      if (src && !src.startsWith('about:') && !src.startsWith('javascript:')) {
        try {
          iframeUrls.push(new URL(src, finalUrl).href);
        } catch {
          // ignore
        }
      }
    }

    // Also look for embeds in HTML text
    const embedPatternRegex = /(https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:ansembed\.net|vidmoly\.[a-z]+|sibnet\.ru|sendvid\.com|voe\.[a-z]+|myvi\.[a-z]+|embed4me\.com)[^\s"'<>]+)/gi;
    let embedMatch;
    while ((embedMatch = embedPatternRegex.exec(html)) !== null) {
      if (!iframeUrls.includes(embedMatch[1])) {
        iframeUrls.push(embedMatch[1]);
      }
    }

    if (iframeUrls.length > 0 && validMedias.length === 0) {
      const resolvedFromIframes = await Promise.all(
        iframeUrls.slice(0, 5).map(async (iframeUrl, idx) => {
          const resolved = await resolveEmbedStream(iframeUrl, finalUrl, ua);
          if (resolved) {
            return {
              id: `sniff-iframe-${Date.now()}-${idx}`,
              title: `${pageTitle} - Lecteur #${idx + 1} (${resolved.quality})`,
              url: resolved.streamUrl,
              format: resolved.format,
              quality: resolved.quality,
              estimatedSize: resolved.format === 'm3u8' ? 120000000 : 70000000,
              headers: resolved.headers,
              timestamp: Date.now(),
              thumbnail: resolved.thumbnail || pageThumbnail,
              duration: 'Lecteur Web',
              sourcePageUrl: iframeUrl,
            };
          }
          return null;
        })
      );
      validMedias.push(...resolvedFromIframes.filter(Boolean));
    }

    // --- C. Standard Direct Video & Stream Extraction ---
    const discoveredUrls = new Set<string>();

    // 1. Direct <video> and <source> src
    const videoSrcRegex = /<(?:video|source|audio)[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = videoSrcRegex.exec(html)) !== null) {
      discoveredUrls.add(match[1]);
    }

    // 2. Data attributes (data-src, data-video, data-stream)
    const dataSrcRegex = /data-(?:src|video|stream|url|file)=["']([^"']+)["']/gi;
    while ((match = dataSrcRegex.exec(html)) !== null) {
      const val = match[1];
      if (val.includes('.m3u8') || val.includes('.mp4') || val.includes('.webm') || val.includes('.ts') || val.includes('.mkv')) {
        discoveredUrls.add(val);
      }
    }

    // 3. Regex scan for direct video stream links in JS or HTML
    const streamRegex = /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|webm|ts|mkv)(?:\?[^\s"'<>]*)?)/gi;
    while ((match = streamRegex.exec(html)) !== null) {
      discoveredUrls.add(match[1]);
    }

    // 4. Relative paths like "/media/stream.m3u8" or "./video.mp4"
    const relRegex = /["'](\/[^"'\s<>]+\.(?:m3u8|mp4|webm|ts|mkv)(?:\?[^"'\s<>]*)?)["']/gi;
    while ((match = relRegex.exec(html)) !== null) {
      discoveredUrls.add(match[1]);
    }

    // Resolve URLs and probe top candidates if no media detected yet
    const resolvedList: string[] = [];
    for (const raw of discoveredUrls) {
      try {
        const resolved = new URL(raw, finalUrl).href;
        if (!resolvedList.includes(resolved)) {
          resolvedList.push(resolved);
        }
      } catch {
        // Skip invalid URL
      }
    }

    if (resolvedList.length > 0) {
      const mediaProbes = await Promise.all(
        resolvedList.slice(0, 8).map(async (mediaUrl, idx) => {
          try {
            const probeHeaders: Record<string, string> = {
              'User-Agent': ua,
              'Referer': finalUrl,
            };
            if (cookies) probeHeaders['Cookie'] = cookies;

            let probeRes = await fetch(mediaUrl, {
              method: 'HEAD',
              headers: probeHeaders,
              redirect: 'follow',
            }).catch(() => null);

            if (!probeRes || probeRes.status === 405 || probeRes.status >= 400) {
              probeHeaders['Range'] = 'bytes=0-1';
              probeRes = await fetch(mediaUrl, {
                method: 'GET',
                headers: probeHeaders,
                redirect: 'follow',
              }).catch(() => null);
            }

            const cType = probeRes?.headers.get('content-type') || '';
            let cLength = parseInt(probeRes?.headers.get('content-length') || '0', 10);
            const cRange = probeRes?.headers.get('content-range') || '';
            if (cRange) {
              const m = cRange.match(/\/(\d+)$/);
              if (m) cLength = parseInt(m[1], 10);
            }

            const isM3u8 = mediaUrl.includes('.m3u8') || cType.includes('mpegurl');
            const isWebm = mediaUrl.includes('.webm') || cType.includes('webm');
            const format = isM3u8 ? 'm3u8' : isWebm ? 'webm' : 'mp4';

            const title = `${pageTitle} - Flux #${validMedias.length + idx + 1} (${format.toUpperCase()})`;

            return {
              id: `sniff-${Date.now()}-${validMedias.length + idx}`,
              title,
              url: mediaUrl,
              format,
              quality: isM3u8 ? 'Adaptive HLS' : cLength > 50000000 ? '1080p HD' : '720p',
              estimatedSize: cLength > 0 ? cLength : (isM3u8 ? 45000000 : 75000000),
              headers: {
                referer: finalUrl,
                userAgent: ua,
                cookies: cookies || '',
              },
              timestamp: Date.now(),
              thumbnail: pageThumbnail || 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&auto=format&fit=crop&q=80',
              duration: isM3u8 ? 'Live / Stream' : 'Vidéo web',
              sourcePageUrl: finalUrl,
              supportsRange: !!probeRes?.headers.get('accept-ranges')?.includes('bytes') || !!cRange,
              realContentType: cType,
            };
          } catch {
            return null;
          }
        })
      );

      validMedias.push(...mediaProbes.filter(Boolean));
    }

    res.json({
      success: true,
      pageTitle,
      finalUrl,
      durationMs,
      discoveredCount: validMedias.length,
      medias: validMedias,
      networkPacket: {
        id: `pkt-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        method: 'GET',
        url: finalUrl,
        type: response.headers.get('content-type') || 'text/html',
        status: response.status,
        size: html.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Impossible d analyser cette page web',
      durationMs: Date.now() - startTime,
    });
  }
});

// Resolves any embed or episode URL on demand
app.post('/api/resolve-embed', async (req, res) => {
  const { url, embedUrl, referer, userAgent } = req.body;
  const targetUrl = url || embedUrl;
  if (!targetUrl || typeof targetUrl !== 'string') {
    res.status(400).json({ error: 'URL requise' });
    return;
  }

  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const resolved = await resolveEmbedStream(targetUrl, referer || 'https://anime-sama.to/', ua);

  if (!resolved) {
    // If it's already a playable link, return it as-is
    const isDirect = targetUrl.match(/\.(m3u8|mp4|webm)(\?.*)?$/i);
    if (isDirect) {
      const isM3u8 = targetUrl.includes('.m3u8');
      res.json({
        success: true,
        streamUrl: targetUrl,
        format: isM3u8 ? 'm3u8' : 'mp4',
        quality: isM3u8 ? '1080p Full HD' : '720p HD',
        headers: {
          referer: referer || targetUrl,
        },
      });
      return;
    }

    res.status(404).json({ success: false, error: 'Impossible d extraire le flux de ce lecteur' });
    return;
  }

  res.json({
    success: true,
    ...resolved,
  });
});

// Downloads a specific byte chunk with real Range request
// Enables true multi-threading without browser CORS restrictions
app.get('/api/chunk', async (req, res) => {
  const { url, start, end, referer, userAgent, cookies, sourcePageUrl } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).send('Paramètre url requis');
    return;
  }

  const hasRange = start !== undefined && end !== undefined && start !== '' && end !== '';
  const startByte = hasRange ? parseInt(start as string, 10) : 0;
  const endByte = hasRange ? parseInt(end as string, 10) : 0;

  if (hasRange && (isNaN(startByte) || isNaN(endByte) || startByte > endByte)) {
    res.status(400).send('Plage d octets invalide');
    return;
  }

  try {
    const contextReferer = (referer as string) || (sourcePageUrl as string) || '';
    let { headers, effectiveReferer } = getOptimalHeaders(url, contextReferer, userAgent as string, cookies as string);

    if (hasRange) {
      headers['Range'] = `bytes=${startByte}-${endByte}`;
    }

    let upstreamRes = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    // If upstream returned 416 (Range Not Satisfiable), retry without Range header
    if (hasRange && (upstreamRes.status === 416 || upstreamRes.status === 400)) {
      delete headers['Range'];
      upstreamRes = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
      });
    }

    // If 403 Forbidden, quickly test alternative Referer headers
    if (upstreamRes.status === 403) {
      const altReferers = [
        url.includes('vidmoly') ? 'https://vidmoly.to/' : '',
        url.includes('ansembed') ? 'https://ansembed.net/' : '',
        (() => { try { return new URL(url).origin + '/'; } catch { return ''; } })(),
        '', // No referer
      ].filter(Boolean);

      for (const altRef of altReferers) {
        const altH = { ...headers };
        if (altRef) {
          altH['Referer'] = altRef;
          try { altH['Origin'] = new URL(altRef).origin; } catch {}
        } else {
          delete altH['Referer'];
          delete altH['Origin'];
        }
        try {
          const testRes = await fetch(url, { method: 'GET', headers: altH, redirect: 'follow' });
          if (testRes.ok || testRes.status === 206) {
            upstreamRes = testRes;
            headers = altH;
            break;
          }
        } catch {}
      }
    }

    // If upstream failed with 403 Forbidden or 404 (common when temporary token expired on VidMoly, Sibnet, etc.)
    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      const sourcePage = (sourcePageUrl as string) || contextReferer;
      if (
        (upstreamRes.status === 403 || upstreamRes.status === 404 || upstreamRes.status === 410) &&
        sourcePage &&
        (sourcePage.includes('ansembed') ||
          sourcePage.includes('vidmoly') ||
          sourcePage.includes('sibnet') ||
          sourcePage.includes('voe') ||
          sourcePage.includes('sendvid') ||
          sourcePage.includes('embed') ||
          sourcePage.includes('anime-sama'))
      ) {
        try {
          const reResolved = await resolveEmbedStream(sourcePage, sourcePage, headers['User-Agent']);
          if (reResolved && reResolved.streamUrl && reResolved.streamUrl !== url) {
            const freshOpts = getOptimalHeaders(reResolved.streamUrl, reResolved.headers?.referer || effectiveReferer, headers['User-Agent']);
            if (hasRange) {
              freshOpts.headers['Range'] = `bytes=${startByte}-${endByte}`;
            }
            const retryRes = await fetch(reResolved.streamUrl, {
              method: 'GET',
              headers: freshOpts.headers,
              redirect: 'follow',
            });
            if (retryRes.ok || retryRes.status === 206) {
              upstreamRes = retryRes;
            }
          }
        } catch {
          // ignore retry error
        }
      }

      // If still failing, return real error status rather than streaming HTML error as video
      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        res.status(upstreamRes.status).send(`Erreur serveur distant (HTTP ${upstreamRes.status})`);
        return;
      }
    }

    // If upstream returned 200 OK while a byte range was requested,
    // upstream does not support HTTP Range; synthesize the exact slice so threads never duplicate data
    if (hasRange && upstreamRes.status === 200) {
      const totalLen = upstreamRes.headers.get('content-length')
        ? parseInt(upstreamRes.headers.get('content-length')!, 10)
        : undefined;

      res.status(206);
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
      res.setHeader('Content-Range', `bytes ${startByte}-${endByte}/${totalLen ? totalLen : '*'}`);
      res.setHeader('Content-Length', `${endByte - startByte + 1}`);

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();
      req.on('close', () => {
        try {
          reader.cancel();
        } catch {}
      });

      let currentOffset = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkLen = value.byteLength;
        const chunkStart = currentOffset;
        const chunkEnd = currentOffset + chunkLen - 1;
        currentOffset += chunkLen;

        if (chunkEnd < startByte) {
          continue;
        }
        if (chunkStart > endByte) {
          try {
            reader.cancel();
          } catch {}
          break;
        }

        const sliceStart = Math.max(0, startByte - chunkStart);
        const sliceEnd = Math.min(chunkLen, endByte - chunkStart + 1);
        res.write(Buffer.from(value.subarray(sliceStart, sliceEnd)));

        if (currentOffset > endByte) {
          try {
            reader.cancel();
          } catch {}
          break;
        }
      }
      res.end();
      return;
    }

    res.status(upstreamRes.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
    
    if (upstreamRes.headers.get('content-range')) {
      res.setHeader('Content-Range', upstreamRes.headers.get('content-range')!);
    }
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Stream binary chunks directly to the client
    const reader = upstreamRes.body.getReader();
    req.on('close', () => {
      try {
        reader.cancel();
      } catch {}
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).send(err.message || 'Erreur proxy chunk');
    }
  }
});

// Real HLS playlist segment parser with automatic embed resolution
app.get('/api/hls-segments', async (req, res) => {
  let { url, referer, userAgent, sourcePageUrl } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL m3u8 requise' });
    return;
  }

  const contextReferer = (referer as string) || (sourcePageUrl as string) || '';
  const ua = (userAgent as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  // 1. If url is already a direct MP4 or WebM video, return immediately
  const cleanUrl = url.split('#')[0];
  if (cleanUrl.match(/\.(mp4|webm)(\?.*)?$/i)) {
    res.json({
      success: true,
      isDirectVideo: true,
      streamUrl: url,
      format: cleanUrl.includes('.webm') ? 'webm' : 'mp4',
      estimatedBytes: 50000000,
      effectiveReferer: (referer as string) || contextReferer || url,
    });
    return;
  }

  // 2. If url is an embed player, resolve it first
  if (url.includes('ansembed.net') || url.includes('vidmoly') || url.includes('sibnet') || url.includes('voe') || url.includes('sendvid') || url.includes('embed')) {
    const resolved = await resolveEmbedStream(url, contextReferer || url, ua);
    if (resolved && resolved.streamUrl) {
      if (resolved.format === 'mp4' || resolved.format === 'webm') {
        res.json({
          success: true,
          isDirectVideo: true,
          streamUrl: resolved.streamUrl,
          format: resolved.format,
          estimatedBytes: 50000000,
          effectiveReferer: resolved.headers?.referer || contextReferer,
        });
        return;
      }
      url = resolved.streamUrl;
      if (resolved.headers?.referer) {
        referer = resolved.headers.referer;
      }
    }
  }

  try {
    let { headers, effectiveReferer } = getOptimalHeaders(url, (referer as string) || contextReferer, ua);

    // Multi-strategy playlist fetch to bypass CDN anti-hotlinking and 403 Forbidden
    async function fetchPlaylist(targetUrl: string, targetHeaders: Record<string, string>): Promise<{ res: Response | null; content: string; effectiveHeaders: Record<string, string>; isDirectVideo?: boolean }> {
      const playlistHeaders: Record<string, string> = {
        ...targetHeaders,
        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*',
      };
      // For playlist manifests, Sec-Fetch-Dest should be empty to prevent 403 on CDN
      playlistHeaders['Sec-Fetch-Dest'] = 'empty';

      let resp = await fetch(targetUrl, { headers: playlistHeaders, redirect: 'follow' }).catch(() => null);
      if (!resp) return { res: null, content: '', effectiveHeaders: playlistHeaders };

      const cType = resp.headers.get('content-type') || '';
      if (cType.includes('video/') || targetUrl.match(/\.(mp4|webm)(\?.*)?$/i)) {
        return { res: resp, content: '', effectiveHeaders: playlistHeaders, isDirectVideo: true };
      }

      let text = await resp.text().catch(() => '');

      // If initial fetch failed, or returned an error page / 403 / non-M3U8, try alternative referers
      if (!resp.ok || (!text.includes('#EXTM3U') && !text.includes('#EXT-X-STREAM-INF'))) {
        const altStrategies: Array<{ name: string; headers: Record<string, string> }> = [];

        // Alt 1: Stream origin as Referer
        try {
          const originUrl = new URL(targetUrl).origin + '/';
          altStrategies.push({
            name: 'origin',
            headers: { ...playlistHeaders, Referer: originUrl, Origin: new URL(targetUrl).origin },
          });
        } catch {}

        // Alt 2: VidMoly / ansembed specific referers
        if (targetUrl.includes('vidmoly') || targetUrl.includes('vmget') || targetUrl.includes('ansembed')) {
          altStrategies.push({ name: 'ansembed.net', headers: { ...playlistHeaders, Referer: 'https://ansembed.net/', Origin: 'https://ansembed.net' } });
          altStrategies.push({ name: 'vidmoly.to', headers: { ...playlistHeaders, Referer: 'https://vidmoly.to/', Origin: 'https://vidmoly.to' } });
          altStrategies.push({ name: 'anime-sama.to', headers: { ...playlistHeaders, Referer: 'https://anime-sama.to/', Origin: 'https://anime-sama.to' } });
        }

        // Alt 3: Sibnet
        if (targetUrl.includes('sibnet.ru')) {
          altStrategies.push({ name: 'sibnet', headers: { ...playlistHeaders, Referer: 'https://video.sibnet.ru/', Origin: 'https://video.sibnet.ru' } });
        }

        // Alt 4: No referer (direct player simulation)
        const noRef = { ...playlistHeaders };
        delete noRef['Referer'];
        delete noRef['Origin'];
        altStrategies.push({ name: 'no-referer', headers: noRef });

        for (const alt of altStrategies) {
          try {
            const altRes = await fetch(targetUrl, { headers: alt.headers, redirect: 'follow' });
            if (altRes.ok) {
              const altType = altRes.headers.get('content-type') || '';
              if (altType.includes('video/')) {
                return { res: altRes, content: '', effectiveHeaders: alt.headers, isDirectVideo: true };
              }
              const altText = await altRes.text();
              if (altText.includes('#EXTM3U') || altText.includes('#EXT-X-STREAM-INF')) {
                return { res: altRes, content: altText, effectiveHeaders: alt.headers };
              }
            }
          } catch {}
        }
      }

      return { res: resp, content: text, effectiveHeaders: playlistHeaders };
    }

    let fetchResult = await fetchPlaylist(url, headers);
    let m3u8Res = fetchResult.res;
    let content = fetchResult.content;
    let baseUrl = m3u8Res ? m3u8Res.url : url;
    headers = fetchResult.effectiveHeaders;
    effectiveReferer = headers['Referer'] || effectiveReferer;

    // Check if the stream is actually a direct MP4 or WebM video
    if (fetchResult.isDirectVideo || m3u8Res?.headers.get('content-type')?.includes('video/') || url.match(/\.(mp4|webm)(\?.*)?$/i)) {
      res.json({
        success: true,
        isDirectVideo: true,
        streamUrl: m3u8Res?.url || url,
        format: url.includes('.webm') ? 'webm' : 'mp4',
        estimatedBytes: parseInt(m3u8Res?.headers.get('content-length') || '50000000', 10),
        effectiveReferer,
      });
      return;
    }

    // If initial fetch failed or returned expired token, re-resolve via content, candidate URLs or extracted embed
    if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-STREAM-INF')) {
      // 1. If content is HTML, extract stream directly
      if (content.includes('<html') || content.includes('<!DOCTYPE') || content.includes('sources:') || content.includes('eval(function(p,a,c,k,e') || content.includes('player.src') || content.includes('video_source')) {
        const streamFromHtml = extractStreamFromHtml(content, baseUrl || url, ua);
        if (streamFromHtml) {
          if (streamFromHtml.format === 'mp4' || streamFromHtml.format === 'webm') {
            res.json({
              success: true,
              isDirectVideo: true,
              streamUrl: streamFromHtml.streamUrl,
              format: streamFromHtml.format,
              estimatedBytes: 50000000,
              effectiveReferer: streamFromHtml.headers?.referer || effectiveReferer,
            });
            return;
          }
          if (streamFromHtml.streamUrl) {
            url = streamFromHtml.streamUrl;
            const reOpt = getOptimalHeaders(url, streamFromHtml.headers?.referer || effectiveReferer, ua);
            const freshAttempt = await fetchPlaylist(url, reOpt.headers);
            if (freshAttempt.res && (freshAttempt.content.includes('#EXTM3U') || freshAttempt.content.includes('#EXT-X-STREAM-INF'))) {
              m3u8Res = freshAttempt.res;
              content = freshAttempt.content;
              baseUrl = freshAttempt.res.url;
              headers = freshAttempt.effectiveHeaders;
              effectiveReferer = headers['Referer'] || streamFromHtml.headers?.referer || effectiveReferer;
            }
          }
        }
      }

      // 2. Re-resolve via candidate source URLs and extracted embed URLs
      if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-STREAM-INF')) {
        const candidateSources: string[] = [];
        if (sourcePageUrl && typeof sourcePageUrl === 'string') candidateSources.push(sourcePageUrl);
        if (contextReferer && !candidateSources.includes(contextReferer)) candidateSources.push(contextReferer);
        if (url.includes('ansembed') || url.includes('vidmoly') || url.includes('sibnet') || url.includes('voe') || url.includes('embed') || url.includes('anime-sama')) {
          if (!candidateSources.includes(url)) candidateSources.push(url);
        }
        const extracted = extractEmbedUrlFromStream(url);
        if (extracted && !candidateSources.includes(extracted)) candidateSources.push(extracted);

        for (const sourceUrl of candidateSources) {
          try {
            const reResolved = await resolveEmbedStream(sourceUrl, sourceUrl, ua);
            if (reResolved && reResolved.streamUrl) {
              if (reResolved.format === 'mp4' || reResolved.format === 'webm') {
                res.json({
                  success: true,
                  isDirectVideo: true,
                  streamUrl: reResolved.streamUrl,
                  format: reResolved.format,
                  estimatedBytes: 50000000,
                  effectiveReferer: reResolved.headers?.referer || effectiveReferer,
                });
                return;
              }
              url = reResolved.streamUrl;
              const reOpt = getOptimalHeaders(url, reResolved.headers?.referer || effectiveReferer, ua);
              const freshAttempt = await fetchPlaylist(url, reOpt.headers);
              if (freshAttempt.res && (freshAttempt.content.includes('#EXTM3U') || freshAttempt.content.includes('#EXT-X-STREAM-INF'))) {
                m3u8Res = freshAttempt.res;
                content = freshAttempt.content;
                baseUrl = freshAttempt.res.url;
                headers = freshAttempt.effectiveHeaders;
                effectiveReferer = headers['Referer'] || reResolved.headers?.referer || effectiveReferer;
                break;
              }
            }
          } catch {}
        }
      }
    }

    if (!content.includes('#EXTM3U') && !content.includes('#EXT-X-STREAM-INF')) {
      res.status(404).json({
        success: false,
        error: 'Le lien de la vidéo a expiré ou n est plus disponible. Veuillez réactualiser la page de la vidéo.',
      });
      return;
    }

    const requestedQuality = (req.query.quality as string) || '';

    // Check if master playlist
    if (content.includes('#EXT-X-STREAM-INF')) {
      const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const variants: Array<{
        url: string;
        bandwidth: number;
        resolution: string;
        qualityName: string;
      }> = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
          const infLine = lines[i];
          const nextLine = lines[i + 1].trim();
          if (nextLine && !nextLine.startsWith('#')) {
            const bwMatch = infLine.match(/BANDWIDTH=(\d+)/i);
            const resMatch = infLine.match(/RESOLUTION=([\dx]+)/i);
            const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            const resolution = resMatch ? resMatch[1] : '';
            const height = resolution ? parseInt(resolution.split('x')[1] || '0', 10) : 0;
            const qualityName = height >= 1080 ? '1080p' : height >= 720 ? '720p' : height >= 480 ? '480p' : (resolution || 'Auto');

            try {
              variants.push({
                url: new URL(nextLine, baseUrl).href,
                bandwidth,
                resolution,
                qualityName,
              });
            } catch {}
          }
        }
      }

      let selectedVariant = variants[0];

      if (variants.length > 0) {
        if (requestedQuality) {
          const reqLower = requestedQuality.toLowerCase();
          let match = null;
          if (reqLower.includes('360')) {
            match = variants.find((v) => v.qualityName === '360p' || v.resolution.includes('360'));
          } else if (reqLower.includes('480') || reqLower.includes('sd') || reqLower.includes('eco') || reqLower.includes('leger')) {
            match = variants.find((v) => v.qualityName === '480p' || v.resolution.includes('480'));
          } else if (reqLower.includes('720') || reqLower.includes('hd') || reqLower.includes('normal') || reqLower.includes('equilibre')) {
            match = variants.find((v) => v.qualityName === '720p' || v.resolution.includes('720'));
          } else if (reqLower.includes('1080') || reqLower.includes('fhd') || reqLower.includes('max') || reqLower.includes('haute')) {
            match = variants.find((v) => v.qualityName === '1080p' || v.resolution.includes('1080'));
          }
          if (!match) {
            match = variants.find(
              (v) =>
                v.qualityName.toLowerCase().includes(reqLower) ||
                v.resolution.includes(reqLower) ||
                reqLower.includes(v.qualityName.toLowerCase()) ||
                (v.resolution && reqLower.includes(v.resolution))
            );
          }
          if (match) selectedVariant = match;
        } else {
          // Default to high or balanced quality if not explicitly set
          selectedVariant = variants[0];
        }
      }

      if (selectedVariant) {
        const variantFetch = await fetchPlaylist(selectedVariant.url, headers);
        const variantRes = variantFetch.res;
        const variantContent = variantFetch.content;
        const segments = parseM3u8Lines(variantContent, variantRes ? variantRes.url : selectedVariant.url);
        const totalDurationSec = segments.reduce((acc, s) => acc + (s.duration || 10), 0);
        const estimatedBytes = selectedVariant.bandwidth > 0
          ? Math.round((selectedVariant.bandwidth * totalDurationSec) / 8)
          : segments.length * 950000;

        const enrichedVariants = variants.map((v) => {
          let est = 0;
          if (v.bandwidth > 0 && totalDurationSec > 0) {
            est = Math.round((v.bandwidth * totalDurationSec) / 8);
          } else if (v.qualityName === '1080p') {
            est = Math.round((segments.length * 950000) * 1.5);
          } else if (v.qualityName === '720p') {
            est = Math.round((segments.length * 950000) * 0.85);
          } else if (v.qualityName === '480p') {
            est = Math.round((segments.length * 950000) * 0.4);
          } else if (v.qualityName === '360p') {
            est = Math.round((segments.length * 950000) * 0.22);
          } else {
            est = segments.length * 950000;
          }
          return {
            ...v,
            estimatedBytes: est,
            label: v.qualityName === '1080p'
              ? '1080p Full HD (Max)'
              : v.qualityName === '720p'
              ? '720p HD (Équilibré)'
              : v.qualityName === '480p'
              ? '480p SD (Léger • Éco)'
              : v.qualityName === '360p'
              ? '360p Mobile (Ultra léger)'
              : v.qualityName,
          };
        });

        res.json({
          success: true,
          isMaster: true,
          streamUrl: url,
          variantUrl: selectedVariant.url,
          selectedQuality: selectedVariant.qualityName,
          selectedResolution: selectedVariant.resolution,
          bandwidth: selectedVariant.bandwidth,
          estimatedBytes,
          variants: enrichedVariants,
          effectiveReferer: variantFetch.effectiveHeaders['Referer'] || effectiveReferer,
          segments,
        });
        return;
      }
    }

    const segments = parseM3u8Lines(content, baseUrl);
    const totalDurationSec = segments.reduce((acc, s) => acc + (s.duration || 10), 0);
    const baseBytes = segments.length * 950000;
    const fallbackVariants = [
      { qualityName: '1080p', resolution: '1920x1080', bandwidth: 3500000, estimatedBytes: Math.round(baseBytes * 1.4), url, label: '1080p Full HD (Max)' },
      { qualityName: '720p', resolution: '1280x720', bandwidth: 1800000, estimatedBytes: baseBytes, url, label: '720p HD (Équilibré)' },
      { qualityName: '480p', resolution: '854x480', bandwidth: 800000, estimatedBytes: Math.round(baseBytes * 0.45), url, label: '480p SD (Léger • Éco)' },
    ];
    res.json({
      success: true,
      isMaster: false,
      streamUrl: url,
      estimatedBytes: baseBytes,
      variants: fallbackVariants,
      effectiveReferer,
      segments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erreur parsing m3u8' });
  }
});

function parseM3u8Lines(content: string, baseUrl: string) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: Array<{ index: number; url: string; duration: number; isInit?: boolean }> = [];
  let currentDuration = 0;
  let idx = 0;

  // Support CMAF / fMP4 initialization segment (#EXT-X-MAP:URI="init.mp4")
  const mapMatch = content.match(/#EXT-X-MAP:URI=["']([^"']+)["']/i);
  if (mapMatch && mapMatch[1]) {
    try {
      const initUrl = new URL(mapMatch[1], baseUrl).href;
      segments.push({
        index: idx++,
        url: initUrl,
        duration: 0,
        isInit: true,
      });
    } catch {}
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const durMatch = trimmed.match(/#EXTINF:([\d.]+)/);
      if (durMatch) {
        currentDuration = parseFloat(durMatch[1]);
      }
    } else if (trimmed && !trimmed.startsWith('#')) {
      try {
        const segUrl = new URL(trimmed, baseUrl).href;
        segments.push({
          index: idx++,
          url: segUrl,
          duration: currentDuration,
        });
      } catch {
        // ignore malformed
      }
    }
  }
  return segments;
}

// Proxies full media stream for direct in-app playback with playlist rewriting
app.get('/api/stream-proxy', async (req, res) => {
  let { url, referer, userAgent } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).send('URL requise');
    return;
  }

  try {
    let targetUrl = url;
    let effectiveReferer = (referer as string) || '';
    const ua = (userAgent as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    // 1. Auto-resolve if targetUrl is an embed player
    if (targetUrl.includes('ansembed.net') || targetUrl.includes('vidmoly') || targetUrl.includes('sibnet') || targetUrl.includes('sendvid') || targetUrl.includes('voe') || targetUrl.includes('embed')) {
      const resolved = await resolveEmbedStream(targetUrl, effectiveReferer || targetUrl, ua);
      if (resolved && resolved.streamUrl) {
        targetUrl = resolved.streamUrl;
        if (resolved.headers?.referer) {
          effectiveReferer = resolved.headers.referer;
        }
      }
    }

    // Determine default Referer if missing
    if (!effectiveReferer) {
      if (targetUrl.includes('vmget.online') || targetUrl.includes('vidmoly') || targetUrl.includes('ansembed')) {
        effectiveReferer = 'https://ansembed.net/';
      } else if (targetUrl.includes('sibnet.ru')) {
        effectiveReferer = 'https://video.sibnet.ru/';
      } else if (targetUrl.includes('sendvid.com')) {
        effectiveReferer = 'https://sendvid.com/';
      }
    }

    const headers: Record<string, string> = {
      'User-Agent': ua,
    };
    if (effectiveReferer) headers['Referer'] = effectiveReferer;
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let upstreamRes = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
    });

    // If Range request failed with 416 or 400, retry without Range
    if (req.headers.range && (upstreamRes.status === 416 || upstreamRes.status === 400)) {
      delete headers['Range'];
      upstreamRes = await fetch(targetUrl, {
        headers,
        redirect: 'follow',
      });
    }

    const contentType = upstreamRes.headers.get('content-type') || '';
    const finalUrl = upstreamRes.url;
    const isM3u8 = targetUrl.includes('.m3u8') || finalUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegurl');

    // --- M3U8 PLAYLIST REWRITING ---
    if (isM3u8) {
      const rawText = await upstreamRes.text();
      if (rawText.includes('#EXTM3U') || rawText.includes('#EXTINF')) {
        const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        
        const makeProxiedUrl = (uriStr: string) => {
          try {
            const abs = new URL(uriStr.trim(), finalUrl).href;
            return `/api/stream-proxy?url=${encodeURIComponent(abs)}${
              effectiveReferer ? `&referer=${encodeURIComponent(effectiveReferer)}` : ''
            }`;
          } catch {
            return uriStr;
          }
        };

        const rewrittenLines = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith('#')) {
            // Rewrite URI="..." attributes in tags (keys, init segments, media playlists)
            return trimmed.replace(/URI=["']([^"']+)["']/g, (m, uriVal) => {
              return `URI="${makeProxiedUrl(uriVal)}"`;
            });
          }

          // Direct child playlist or TS segment URI
          return makeProxiedUrl(trimmed);
        });

        const proxiedPlaylist = rewrittenLines.join('\n');
        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(proxiedPlaylist, 'utf-8'));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.send(proxiedPlaylist);
        return;
      }
    }

    // --- BINARY VIDEO / TS SEGMENT STREAMING ---
    res.status(upstreamRes.status === 206 ? 206 : 200);
    for (const [key, val] of upstreamRes.headers.entries()) {
      if (['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
    if (!res.getHeader('Accept-Ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    const reader = upstreamRes.body.getReader();
    req.on('close', () => reader.cancel());

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).send(err.message || 'Erreur flux proxy');
    }
  }
});

// Converts uploaded TS/MPEG-TS buffers into a universal, 100% compliant Apple MP4 video
app.post('/api/remux-to-mp4', (req, res) => {
  const reqTitle = (req.query.title as string) || 'video';
  const cleanTitle = reqTitle.replace(/[^\w\s\u00C0-\u017F-]/gi, '').trim().replace(/\s+/g, '_') || 'video';
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const inputTs = `/tmp/in_${id}.ts`;
  const outputMp4 = `/tmp/out_${id}.mp4`;

  const writeStream = fs.createWriteStream(inputTs);
  req.pipe(writeStream);

  writeStream.on('finish', () => {
    // Execute FFmpeg to remux TS into pristine MP4 with +faststart (optimised for Apple iOS/Safari)
    const ffmpegArgs = [
      '-y',
      '-i', inputTs,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      outputMp4
    ];

    const proc = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
  fs.appendFileSync('/tmp/server.log', `[FFmpeg Exit] ${code} ${stderr.slice(-500)}\n`);
  fs.appendFileSync('/tmp/server.log', `[FFmpeg Args] ${JSON.stringify(ffmpegArgs)}\n`);

      if (code !== 0 || !fs.existsSync(outputMp4)) {
        console.warn('FFmpeg copy remux failed, attempting AAC transcode fallback:', stderr.slice(-300));
        // Fallback: If remux failed (e.g. non-standard audio or input issues), retry with standard aac audio
        const fallbackArgs = [
          '-y',
          '-i', inputTs,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          outputMp4
        ];
        const procFallback = spawn('ffmpeg', fallbackArgs);
        procFallback.on('close', (fCode) => {
          if (fCode !== 0 || !fs.existsSync(outputMp4)) {
            cleanup();
            res.status(500).json({ error: 'Échec de conversion MP4', details: stderr.slice(-300) });
            return;
          }
          sendMp4();
        });
        return;
      }

      sendMp4();
    });

    function sendMp4() {
      try {
        const stat = fs.statSync(outputMp4);
        res.status(200);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}.mp4"`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

        const readStream = fs.createReadStream(outputMp4);
        readStream.pipe(res);
        readStream.on('close', () => cleanup());
        req.on('close', () => cleanup());
      } catch (err) {
        cleanup();
        if (!res.headersSent) res.status(500).send('Erreur lecture MP4');
      }
    }

    function cleanup() {
      try { if (fs.existsSync(inputTs)) fs.unlinkSync(inputTs); } catch {}
      try { if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4); } catch {}
    }
  });

  writeStream.on('error', () => {
    res.status(500).json({ error: 'Erreur écriture flux temporaire' });
  });
});

// --- ULTRA-STABLE SERVER-SIDE DOWNLOAD JOB ENGINE ---
const DOWNLOADS_DIR = '/tmp/downloads';
if (!fs.existsSync(DOWNLOADS_DIR)) {
  try {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  } catch {}
}

interface ServerDownloadJob {
  id: string;
  title: string;
  cleanTitle: string;
  url: string;
  resolvedUrl: string;
  format: 'mp4' | 'mp3' | 'm4a' | 'webm';
  quality: string;
  status: 'starting' | 'downloading' | 'completed' | 'error' | 'canceled';
  progress: number; // 0 to 100
  downloadedBytes: number;
  totalBytes: number;
  speed: number; // bytes/s
  durationSec: number;
  currentTimeSec: number;
  outputPath: string;
  outputExt: string;
  mimeType: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  proc?: any;
}

const serverDownloadJobs = new Map<string, ServerDownloadJob>();

// Helper to clean up old completed/failed jobs after 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of serverDownloadJobs.entries()) {
    if (job.status === 'completed' || job.status === 'error' || job.status === 'canceled') {
      if (now - job.createdAt > 3600000) {
        try {
          if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
        } catch {}
        serverDownloadJobs.delete(id);
      }
    }
  }
}, 300000);

// Starts an ultra-stable download job powered directly by native FFmpeg on server
app.post('/api/download/start', async (req, res) => {
  const { url, title, format = 'mp4', quality = '1080p', referer, userAgent, sourcePageUrl } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL requise' });
    return;
  }

  const reqTitle = title || 'video';
  const cleanTitle = reqTitle.replace(/[^\w\s\u00C0-\u017F-]/gi, '').trim().replace(/\s+/g, '_') || 'video';
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  let effFormat: 'mp4' | 'mp3' | 'm4a' | 'webm' = 'mp4';
  if (format === 'mp3') effFormat = 'mp3';
  else if (format === 'm4a') effFormat = 'm4a';
  else if (format === 'webm') effFormat = 'webm';

  const outputExt = effFormat;
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.${outputExt}`);
  const mimeType = effFormat === 'mp3' ? 'audio/mpeg' : effFormat === 'm4a' ? 'audio/mp4' : effFormat === 'webm' ? 'video/webm' : 'video/mp4';

  const job: ServerDownloadJob = {
    id: jobId,
    title: reqTitle,
    cleanTitle,
    url,
    resolvedUrl: url,
    format: effFormat,
    quality: quality || '1080p',
    status: 'starting',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    durationSec: 0,
    currentTimeSec: 0,
    outputPath,
    outputExt,
    mimeType,
    createdAt: Date.now(),
  };

  serverDownloadJobs.set(jobId, job);
  res.json({
    success: true,
    jobId,
    status: job.status,
    title: job.title,
    format: job.format,
    quality: job.quality,
  });

  // Execute download asynchronously in background
  (async () => {
    try {
      let targetUrl = url;
      let effectiveReferer = referer || sourcePageUrl || '';

      // 1. Resolve embed player if needed
      if (
        targetUrl.includes('ansembed.net') ||
        targetUrl.includes('vidmoly') ||
        targetUrl.includes('sibnet') ||
        targetUrl.includes('voe') ||
        targetUrl.includes('sendvid') ||
        targetUrl.includes('embed')
      ) {
        const resolved = await resolveEmbedStream(targetUrl, effectiveReferer || targetUrl, ua);
        if (resolved && resolved.streamUrl) {
          targetUrl = resolved.streamUrl;
          if (resolved.headers?.referer) effectiveReferer = resolved.headers.referer;
        }
      }

      job.resolvedUrl = targetUrl;
      job.status = 'downloading';

      let matchedTargetQuality = false;

      // 2. If HLS master playlist, pick the exact variant for quality if requested & pre-calculate duration
      if (targetUrl.includes('.m3u8')) {
        try {
          const { headers: hlsHeaders } = getOptimalHeaders(targetUrl, effectiveReferer || targetUrl, ua);
          const pFetch = await fetch(targetUrl, { headers: hlsHeaders, redirect: 'follow' });
          const pText = await pFetch.text();
          if (pText.includes('#EXT-X-STREAM-INF')) {
            const lines = pText.split('\n');
            let bestVariantUrl: string | null = null;
            let variants: { res: number; url: string }[] = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const next = (lines[i + 1] || '').trim();
                if (next && !next.startsWith('#')) {
                  const resolvedVariant = new URL(next, pFetch.url).href;
                  let resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                  let res = 0;
                  if (resMatch) {
                    res = parseInt(resMatch[1], 10);
                  } else if (line.includes('1080')) res = 1080;
                  else if (line.includes('720')) res = 720;
                  else if (line.includes('480')) res = 480;
                  else if (line.includes('360')) res = 360;
                  
                  variants.push({ res, url: resolvedVariant });
                }
              }
            }
            
            if (variants.length > 0) {
              // Prefer 720p, then 480p, then whatever is closest to 720p
              const exact720 = variants.find(v => v.res === 720);
              const exact480 = variants.find(v => v.res === 480);
              
              if (exact720) bestVariantUrl = exact720.url;
              else if (exact480) bestVariantUrl = exact480.url;
              else {
                variants.sort((a, b) => Math.abs(a.res - 720) - Math.abs(b.res - 720));
                bestVariantUrl = variants[0].url;
              }
            }

            if (bestVariantUrl) {
              targetUrl = bestVariantUrl;
              job.resolvedUrl = targetUrl;
            }
          }

          // Pre-calculate exact playlist duration by summing #EXTINF
          const mediaPRes = targetUrl === pFetch.url ? pText : await (await fetch(targetUrl, { headers: hlsHeaders, redirect: 'follow' })).text();
          let dur = 0;
          const infMatches = mediaPRes.matchAll(/#EXTINF:([\d.]+)/g);
          for (const m of infMatches) {
            dur += parseFloat(m[1]) || 0;
          }
          if (dur > 0) {
            job.durationSec = Math.round(dur);
          }
        } catch (probeErr) {
          console.warn('HLS variant / duration probe notice:', probeErr);
        }
      }

      // 3. Prepare headers for FFmpeg
      const { headers } = getOptimalHeaders(targetUrl, effectiveReferer, ua);
      let headerStr = '';
      for (const [k, v] of Object.entries(headers)) {
        headerStr += `${k}: ${v}\r\n`;
      }

      // 4. Build FFmpeg command arguments with ultra-stable reconnect & high performance flags
      const baseArgs = [
        '-y',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-rw_timeout', '20000000',
        '-threads', '0',
      ];
      if (headerStr) {
        baseArgs.push('-headers', headerStr);
      }
      baseArgs.push('-i', targetUrl);

      // Output specific codec parameters: ALWAYS prioritize superfast direct stream copy for video
      let outArgs: string[] = [];

      if (effFormat === 'mp3') {
        // True MP3 audio extraction with ID3 tags
        outArgs = [
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
          '-id3v2_version', '3',
          '-metadata', `title=${cleanTitle}`,
          '-progress', 'pipe:1',
          outputPath,
        ];
      } else if (effFormat === 'm4a') {
        // High fidelity Apple AAC audio
        outArgs = [
          '-vn',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          '-metadata', `title=${cleanTitle}`,
          '-progress', 'pipe:1',
          outputPath,
        ];
      } else if (effFormat === 'webm') {
        // Native WebM stream copy (no MP4-only movflags or AAC bitstream filters)
        outArgs = [
          '-c', 'copy',
          '-progress', 'pipe:1',
          outputPath,
        ];
      } else {
        // Ultra-fast direct stream copy for MP4/WebM (20x - 30x realtime, 100% loss-free)
        // With faststart enabled for instant iOS Safari, QuickTime & camera roll playback
        // NOTE: Never use -bsf:a aac_adtstoasc manually here as FFmpeg handles it automatically
        outArgs = [
          '-c', 'copy',
          '-movflags', '+faststart',
          '-progress', 'pipe:1',
          outputPath,
        ];
      }

      const runFfmpeg = (customOutArgs: string[]): Promise<{ok: boolean, err: string}> => {
        return new Promise((resolve) => {
          const ffmpegArgs = [...baseArgs, ...customOutArgs];
          const proc = spawn('ffmpeg', ffmpegArgs);
          job.proc = proc;

          let stderr = '';
          let lastDiskBytes = 0;
          let lastCheckTime = Date.now();

          // Active disk-stat ticker for accurate speed and byte counting
          const statInterval = setInterval(() => {
            try {
              if (fs.existsSync(outputPath)) {
                const stat = fs.statSync(outputPath);
                const currentBytes = stat.size;
                const now = Date.now();
                const elapsed = (now - lastCheckTime) / 1000;
                if (elapsed >= 0.4) {
                  if (currentBytes > lastDiskBytes) {
                    job.speed = Math.max(0, Math.round((currentBytes - lastDiskBytes) / elapsed));
                    lastDiskBytes = currentBytes;
                    lastCheckTime = now;
                  }
                }
                job.downloadedBytes = currentBytes;
                if (job.durationSec > 0 && job.currentTimeSec > 0) {
                  const est = Math.round((currentBytes / job.currentTimeSec) * job.durationSec);
                  if (est > currentBytes) job.totalBytes = est;
                }
              }
            } catch {}
          }, 400);

          // Monitor stderr for duration detection fallback
          proc.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            if (job.durationSec === 0) {
              const durMatch = str.match(/Duration:\s*(\d{2}):(\d{2}):([\d.]+)/);
              if (durMatch) {
                const h = parseInt(durMatch[1], 10);
                const m = parseInt(durMatch[2], 10);
                const s = parseFloat(durMatch[3]);
                job.durationSec = Math.round(h * 3600 + m * 60 + s);
              }
            }
          });

          // Monitor stdout for -progress pipe:1
          proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
              const [key, val] = line.trim().split('=');
              if (key === 'total_size') {
                const b = parseInt(val, 10) || 0;
                if (b > job.downloadedBytes) {
                  job.downloadedBytes = b;
                }
              } else if (key === 'out_time_us') {
                const us = parseInt(val, 10) || 0;
                job.currentTimeSec = us / 1000000;
                if (job.durationSec > 0) {
                  job.progress = Math.min(99, Math.round((job.currentTimeSec / job.durationSec) * 100));
                }
              } else if (key === 'progress' && val === 'end') {
                job.progress = 100;
              }
            }
          });

          proc.on('close', (code) => {
            clearInterval(statInterval);
            job.proc = undefined;
            fs.appendFileSync('/tmp/server2.log', `[FFmpeg Exit] ${code} ${stderr.slice(-500)}\n`);
            fs.appendFileSync('/tmp/server2.log', `[FFmpeg Args] ${JSON.stringify(ffmpegArgs)}\n`);

            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
              resolve({ok: true, err: ''});
            } else {
              console.warn('FFmpeg run returned non-zero code:', code, stderr.slice(-300));
              resolve({ok: false, err: stderr.slice(-100)});
            }
          });

          proc.on('error', (err) => {
            clearInterval(statInterval);
            console.error('FFmpeg process error:', err);
            resolve({ok: false, err: err.message || 'Process error'});
          });
        });
      };

      let { ok, err: ffmpegErr } = await runFfmpeg(outArgs);

      // If copy mode failed, attempt format-appropriate ultra-fast transcode fallback
      if (!ok && outArgs.includes('-c') && outArgs.includes('copy')) {
        console.info(`Direct copy mode failed, executing format-aware fallback transcode for ${effFormat}...`);
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch {}

        let transcodeArgs: string[] = [];
        if (effFormat === 'webm') {
          // Fallback transcode for WebM container using VP9 + Opus
          transcodeArgs = [
            '-c:v', 'libvpx-vp9',
            '-b:v', '0',
            '-crf', '30',
            '-c:a', 'libopus',
            '-b:a', '128k',
            '-progress', 'pipe:1',
            outputPath,
          ];
        } else {
          // Fallback transcode for MP4 container using H.264 + AAC + faststart
          transcodeArgs = [
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast',
            '-tune', 'fastdecode',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-progress', 'pipe:1',
            outputPath,
          ];
        }
        const fallbackRes = await runFfmpeg(transcodeArgs); ok = fallbackRes.ok; ffmpegErr = fallbackRes.err;
      }

      if (ok && fs.existsSync(outputPath)) {
        const stat = fs.statSync(outputPath);
        job.totalBytes = stat.size;
        job.downloadedBytes = stat.size;
        job.progress = 100;
        job.speed = 0;
        job.status = 'completed';
        job.completedAt = Date.now();
      } else {
        job.status = 'error';
        job.error = 'Erreur ffmpeg: ' + (ffmpegErr || 'Échec inconnu');
      }
    } catch (err: any) {
      job.status = 'error';
      job.error = err.message || 'Erreur inattendue';
    }
  })();
});

// Query real-time status of a server-side download job
app.get('/api/download/status/:id', (req, res) => {
  const job = serverDownloadJobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Tâche introuvable' });
    return;
  }

  let finalSize = job.totalBytes;
  if (job.status === 'completed' && fs.existsSync(job.outputPath)) {
    try {
      finalSize = fs.statSync(job.outputPath).size;
    } catch {}
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    downloadedBytes: job.downloadedBytes,
    totalBytes: finalSize,
    speed: job.speed,
    title: job.title,
    format: job.format,
    quality: job.quality,
    outputExt: job.outputExt,
    mimeType: job.mimeType,
    durationSec: job.durationSec,
    currentTimeSec: job.currentTimeSec,
    error: job.error,
    completedAt: job.completedAt,
  });
});

// Streams or downloads the finished file with byte-range and attachment support
app.get('/api/download/file/:id', (req, res) => {
  const jobId = req.params.id;
  const job = serverDownloadJobs.get(jobId);
  
  let filePath = job?.outputPath;
  let outputExt = job?.outputExt || 'mp4';
  let mimeType = job?.mimeType || 'video/mp4';
  let cleanTitle = job?.cleanTitle || jobId;

  if (!filePath || !fs.existsSync(filePath)) {
    const downloadDir = DOWNLOADS_DIR;
    const exts = ['mp4', 'mp3', 'm4a', 'webm'];
    for (const ext of exts) {
      const p = path.join(downloadDir, `${jobId}.${ext}`);
      if (fs.existsSync(p)) {
        filePath = p;
        outputExt = ext;
        if (ext === 'mp3') mimeType = 'audio/mpeg';
        else if (ext === 'm4a') mimeType = 'audio/mp4';
        else if (ext === 'webm') mimeType = 'video/webm';
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).send('Fichier introuvable sur le serveur');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    const isAttachment = req.query.export === '1' || req.query.download === '1';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type, Content-Range, Accept-Ranges');

    const safeName = encodeURIComponent(`${cleanTitle}.${outputExt}`);
    const asciiName = cleanTitle.replace(/[^\x20-\x7E]/g, '');
    
    if (isAttachment) {
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.${outputExt}"; filename*=UTF-8''${safeName}`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${asciiName}.${outputExt}"; filename*=UTF-8''${safeName}`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': chunksize,
      });
      file.pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(`[Download API Error] ${jobId}:`, err);
    if (!res.headersSent) res.status(500).send('Erreur lecture fichier');
  }
});

// Cancels a running server download job
app.post('/api/download/cancel/:id', (req, res) => {
  const job = serverDownloadJobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Tâche introuvable' });
    return;
  }

  if (job.proc) {
    try {
      job.proc.kill('SIGKILL');
    } catch {}
  }

  job.status = 'canceled';
  try {
    if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
  } catch {}

  res.json({ success: true, canceled: true });
});

// Directly downloads and remuxes an online stream or m3u8 into a real MP4 or MP3 on the fly
app.get('/api/export-direct-mp4', async (req, res) => {
  let { url, referer, title, sourcePageUrl, format = 'mp4', quality = '1080p' } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).send('URL requise');
    return;
  }

  const reqTitle = (title as string) || 'video';
  const cleanTitle = reqTitle.replace(/[^\w\s\u00C0-\u017F-]/gi, '').trim().replace(/\s+/g, '_') || 'video';
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const isMp3 = format === 'mp3';
  const isM4a = format === 'm4a';
  const ext = isMp3 ? 'mp3' : isM4a ? 'm4a' : 'mp4';
  const mime = isMp3 ? 'audio/mpeg' : isM4a ? 'audio/mp4' : 'video/mp4';
  const outputPath = `/tmp/direct_${id}.${ext}`;

  try {
    let targetUrl = url;
    let effectiveReferer = (referer as string) || (sourcePageUrl as string) || '';
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    if (
      targetUrl.includes('ansembed.net') ||
      targetUrl.includes('vidmoly') ||
      targetUrl.includes('sibnet') ||
      targetUrl.includes('voe') ||
      targetUrl.includes('embed')
    ) {
      const resolved = await resolveEmbedStream(targetUrl, effectiveReferer || targetUrl, ua);
      if (resolved && resolved.streamUrl) {
        targetUrl = resolved.streamUrl;
        if (resolved.headers?.referer) effectiveReferer = resolved.headers.referer;
      }
    }

    const { headers } = getOptimalHeaders(targetUrl, effectiveReferer, ua);
    let headerStr = '';
    for (const [k, v] of Object.entries(headers)) {
      headerStr += `${k}: ${v}\r\n`;
    }

    const ffmpegArgs = ['-y'];
    if (headerStr) ffmpegArgs.push('-headers', headerStr);
    ffmpegArgs.push('-i', targetUrl);

    if (isMp3) {
      ffmpegArgs.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', outputPath);
    } else if (isM4a) {
      ffmpegArgs.push('-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);
    } else {
      const qStr = ((quality as string) || '').toLowerCase();
      if (qStr && !qStr.includes('1080') && !qStr.includes('source')) {
        let scale = 'scale=-2:480';
        if (qStr.includes('360')) scale = 'scale=-2:360';
        if (qStr.includes('720')) scale = 'scale=-2:720';
        ffmpegArgs.push('-vf', `${scale}:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '24', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outputPath);
      } else {
        ffmpegArgs.push('-c', 'copy', '-movflags', '+faststart', outputPath);
      }
    }

    const proc = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        if (!isMp3 && !isM4a) {
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
          // Fallback transcode to H.264 + AAC
          const fallbackArgs = [
            '-y',
            ...(headerStr ? ['-headers', headerStr] : []),
            '-i', targetUrl,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'faster',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outputPath,
          ];
          const procF = spawn('ffmpeg', fallbackArgs);
          procF.on('close', (fCode) => {
  fs.appendFileSync('/tmp/server.log', `[FFmpeg Fallback Exit] ${fCode} ${stderr.slice(-500)}\n`);

            if (fCode !== 0 || !fs.existsSync(outputPath)) {
              cleanup();
              res.status(500).send(`Erreur conversion MP4: ${stderr.slice(-300)}`);
              return;
            }
            sendOutput();
          });
          return;
        }
        cleanup();
        res.status(500).send(`Erreur conversion: ${stderr.slice(-300)}`);
        return;
      }

      sendOutput();
    });

    function sendOutput() {
      try {
        const stat = fs.statSync(outputPath);
        res.status(200);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}.${ext}"`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

        const readStream = fs.createReadStream(outputPath);
        readStream.pipe(res);
        readStream.on('close', () => cleanup());
        req.on('close', () => cleanup());
      } catch {
        cleanup();
      }
    }

    function cleanup() {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
  } catch (err: any) {
    res.status(500).send(err.message || 'Erreur export direct');
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NLSbox real backend running on http://localhost:${PORT}`);
  });
}

startServer();
