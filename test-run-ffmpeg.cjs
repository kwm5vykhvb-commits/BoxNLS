const { spawn } = require('child_process');
const targetUrl = 'https://video.sibnet.ru/v/ebcf368e7b172a15c5457ef4696c7cb6/4943016.mp4';
const args = [
  '-y',
  '-reconnect', '1',
  '-reconnect_streamed', '1',
  '-reconnect_delay_max', '5',
  '-rw_timeout', '20000000',
  '-threads', '0',
  '-headers', 'Referer: https://video.sibnet.ru/\r\n',
  '-i', targetUrl,
  '-vf', 'scale=-2:360:flags=lanczos',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-preset', 'ultrafast',
  '-tune', 'fastdecode',
  '-crf', '24',
  '-c:a', 'aac',
  '-b:a', '96k',
  '-movflags', '+faststart',
  '-progress', 'pipe:1',
  '/tmp/sibnet-out.mp4'
];

const p = spawn('ffmpeg', args);
p.stderr.on('data', d => console.error(d.toString()));
p.on('close', c => console.log('Exited with', c));
