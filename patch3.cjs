const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /app\.get\('\/api\/download\/file\/:id',[\s\S]*?\}\);\s*\n\/\/ Cancels a running/;

const newCode = `app.get('/api/download/file/:id', (req, res) => {
  const jobId = req.params.id;
  const job = serverDownloadJobs.get(jobId);
  
  let filePath = job?.outputPath;
  let outputExt = job?.outputExt || 'mp4';
  let mimeType = job?.mimeType || 'video/mp4';
  let cleanTitle = job?.cleanTitle || jobId;

  if (!filePath || !fs.existsSync(filePath)) {
    const downloadDir = path.join(os.tmpdir(), 'downloads');
    const exts = ['mp4', 'mp3', 'm4a', 'webm'];
    for (const ext of exts) {
      const p = path.join(downloadDir, \`\${jobId}.\${ext}\`);
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

    if (isAttachment) {
      res.setHeader('Content-Disposition', \`attachment; filename="\${cleanTitle}.\${outputExt}"\`);
    } else {
      res.setHeader('Content-Disposition', \`inline; filename="\${cleanTitle}.\${outputExt}"\`);
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': \`bytes \${start}-\${end}/\${stat.size}\`,
        'Content-Length': chunksize,
      });
      file.pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).send('Erreur lecture fichier');
  }
});

// Cancels a running`;

code = code.replace(regex, newCode);
fs.writeFileSync('server.ts', code);
