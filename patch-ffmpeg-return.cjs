const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  `const runFfmpeg = (customOutArgs: string[]): Promise<boolean> => {`,
  `const runFfmpeg = (customOutArgs: string[]): Promise<{ok: boolean, err: string}> => {`
);

code = code.replace(
  `resolve(true);`,
  `resolve({ok: true, err: ''});`
);

code = code.replace(
  `resolve(false);`,
  `resolve({ok: false, err: stderr.slice(-100)});`
);

code = code.replace(
  `let ok = await runFfmpeg(outArgs);`,
  `let { ok, err: ffmpegErr } = await runFfmpeg(outArgs);`
);

code = code.replace(
  `ok = await runFfmpeg(transcodeArgs);`,
  `const fallbackRes = await runFfmpeg(transcodeArgs); ok = fallbackRes.ok; ffmpegErr = fallbackRes.err;`
);

code = code.replace(
  `job.error = 'Échec de conversion ou de téléchargement du flux';`,
  `job.error = 'Erreur ffmpeg: ' + (ffmpegErr || 'Échec inconnu');`
);

fs.writeFileSync('server.ts', code);
console.log('Patched');
