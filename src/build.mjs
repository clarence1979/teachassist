// Inlines the app scripts into teach-assist.html → dist/teach-assist.html (single file).
import { readFileSync, writeFileSync } from 'node:fs';
export const SCRIPTS = ['art.js', 'app.js', 'local-ai.js', 'timetable-core.js', 'tools.js', 'views.js', 'main.js'];
const html = readFileSync(new URL('./teach-assist.html', import.meta.url), 'utf8');
const js = SCRIPTS.map((f) => `/* ===== ${f} ===== */\n${readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')}`).join('\n\n');
if (!html.includes('/* PLACEHOLDER_APP_SCRIPT */')) throw new Error('placeholder missing');
// Guard against a stray </script> inside the JS breaking the inline script.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const out = html.replace('/* PLACEHOLDER_APP_SCRIPT */', () => safeJs);
// In this repository the built file is served by GitHub Pages from the root as index.html (and teach-assist.html).
for (const f of ['../index.html', '../teach-assist.html']) writeFileSync(new URL(f, import.meta.url), out);
console.log('built index.html + teach-assist.html', (out.length / 1024).toFixed(0), 'KB');
