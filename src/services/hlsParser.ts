/**
 * HLS (.m3u8) Parser utility
 * Extracts master playlist variants (1080p, 720p, 480p) and segment lists (.ts files).
 */

export interface HlsVariant {
  resolution: string;
  bandwidth: number;
  url: string;
  codecs?: string;
}

export interface HlsSegment {
  uri: string;
  duration: number;
  byteRange?: string;
}

export interface ParsedHlsManifest {
  isMaster: boolean;
  variants: HlsVariant[];
  segments: HlsSegment[];
  targetDuration?: number;
}

export function parseM3U8(content: string, baseUrl: string): ParsedHlsManifest {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const isMaster = content.includes('#EXT-X-STREAM-INF');
  const variants: HlsVariant[] = [];
  const segments: HlsSegment[] = [];
  let targetDuration = 10;

  if (isMaster) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const codecsMatch = line.match(/CODECS="([^"]+)"/);

        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 1500000;
        const resolution = resolutionMatch ? resolutionMatch[1] : (bandwidth > 4000000 ? '1920x1080' : bandwidth > 2000000 ? '1280x720' : '854x480');
        const codecs = codecsMatch ? codecsMatch[1] : undefined;

        // Next line contains the relative or absolute URI
        const nextLine = lines[i + 1];
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(nextLine, baseUrl);
          variants.push({ resolution, bandwidth, url: resolvedUrl, codecs });
          i++;
        }
      }
    }
  } else {
    // Media playlist with TS segments
    let currentDuration = 6.0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.split(':')[1]) || 10;
      } else if (line.startsWith('#EXTINF:')) {
        const durMatch = line.match(/#EXTINF:([\d.]+)/);
        if (durMatch) {
          currentDuration = parseFloat(durMatch[1]);
        }
      } else if (!line.startsWith('#') && line.length > 0) {
        segments.push({
          uri: resolveUrl(line, baseUrl),
          duration: currentDuration,
        });
      }
    }
  }

  return {
    isMaster,
    variants,
    segments,
    targetDuration,
  };
}

function resolveUrl(relativeOrAbsolute: string, base: string): string {
  try {
    return new URL(relativeOrAbsolute, base).toString();
  } catch {
    return relativeOrAbsolute;
  }
}
