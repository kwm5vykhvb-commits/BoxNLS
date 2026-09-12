export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 o';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 Ko/s';
  if (bytesPerSec >= 1024 * 1024) {
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' Mo/s';
  }
  return Math.round(bytesPerSec / 1024) + ' Ko/s';
}

export function formatTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds <= 0) return '00:00';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatEta(totalBytes: number, downloadedBytes: number, speed: number): string {
  if (speed <= 0) return '--:--';
  const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
  const seconds = Math.ceil(remainingBytes / speed);
  if (seconds > 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  if (seconds > 60) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  return `${seconds}s`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
