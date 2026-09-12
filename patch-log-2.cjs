const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const search = `proc.on('close', (code) => {
            clearInterval(statInterval);
            job.proc = undefined;`;
            
const replace = `proc.on('close', (code) => {
            clearInterval(statInterval);
            job.proc = undefined;
            fs.appendFileSync('/tmp/server2.log', \`[FFmpeg Exit] \${code} \${stderr.slice(-500)}\\n\`);
            fs.appendFileSync('/tmp/server2.log', \`[FFmpeg Args] \${JSON.stringify(ffmpegArgs)}\\n\`);
`;

code = code.replace(search, replace);
fs.writeFileSync('server.ts', code);
console.log('Patched second place');
