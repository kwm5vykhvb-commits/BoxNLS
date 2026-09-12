const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Find: proc.on('close', (code) => {
// And inject logging
const search = `proc.on('close', (code) => {`;
const replace = `proc.on('close', (code) => {
  fs.appendFileSync('/tmp/server.log', \`[FFmpeg Exit] \${code} \${stderr.slice(-500)}\\n\`);
  fs.appendFileSync('/tmp/server.log', \`[FFmpeg Args] \${JSON.stringify(ffmpegArgs)}\\n\`);
`;
code = code.replace(search, replace);

const search2 = `procF.on('close', (fCode) => {`;
const replace2 = `procF.on('close', (fCode) => {
  fs.appendFileSync('/tmp/server.log', \`[FFmpeg Fallback Exit] \${fCode} \${stderr.slice(-500)}\\n\`);
`;
code = code.replace(search2, replace2);

fs.writeFileSync('server.ts', code);
console.log('Patched logging');
