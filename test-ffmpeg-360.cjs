const { spawn } = require('child_process');
const targetUrl = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.1080p.vp9.webm';
const args = [
  '-y',
  '-reconnect', '1',
  '-reconnect_streamed', '1',
  '-reconnect_delay_max', '5',
  '-rw_timeout', '20000000',
  '-threads', '0',
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
  '/tmp/test-out-360.mp4'
];

const p = spawn('ffmpeg', args);
p.stderr.on('data', d => console.error(d.toString()));
p.on('close', c => console.log('Exited with', c));
