// Renders a README the way github.com shows it on a repository page, approximately: GFM through the
// repository's own `marked`, GitHub's sanitiser imitated by stripping style/class/script, github-markdown-css,
// an 830px column. Usage: bun render-readme.js <README.md> <out.html> [light|dark]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { marked } from '../node_modules/marked/lib/marked.esm.js';

const [readmePath, outputPath, theme = 'light'] = process.argv.slice(2);
if (!readmePath || !outputPath) throw new Error('usage: bun render-readme.js <README.md> <out.html> [light|dark]');

const alertTitles = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

// Relative links in the README resolve against the README's folder, so the page gets a matching <base>.
const baseHref = `/files${resolve(dirname(readmePath))}/`;

let html = await marked.parse(readFileSync(readmePath, 'utf8'), { gfm: true });
html = html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\s(style|class)="[^"]*"/gi, '')
  .replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g, (_match, kind) =>
    `<blockquote class="alert alert-${kind.toLowerCase()}"><p class="alert-title">${alertTitles[kind]}</p><p>`);

const cssFile = theme === 'dark' ? 'github-markdown-dark.css' : 'github-markdown-light.css';
const pageBackground = theme === 'dark' ? '#0d1117' : '#ffffff';
const borderColour = theme === 'dark' ? '#3d444d' : '#d1d9e0';
writeFileSync(outputPath, `<!doctype html><html><head><meta charset="utf-8"><base href="${baseHref}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/${cssFile}">
<style>
body{margin:0;background:${pageBackground}}
.frame{width:894px;margin:24px auto;border:1px solid ${borderColour};border-radius:6px;overflow:hidden}
.frame-head{padding:10px 16px;border-bottom:1px solid ${borderColour};font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${theme === 'dark' ? '#f0f6fc' : '#1f2328'}}
.markdown-body{padding:32px}
.alert{border-left:4px solid #0969da;padding:8px 16px;color:inherit}
.alert-title{font-weight:600;color:#0969da;margin-bottom:4px}
.alert-tip{border-color:#1a7f37}.alert-tip .alert-title{color:#1a7f37}
.alert-important{border-color:#8250df}.alert-important .alert-title{color:#8250df}
.alert-warning{border-color:#9a6700}.alert-warning .alert-title{color:#9a6700}
</style></head><body><div class="frame"><div class="frame-head">${relative(process.cwd(), readmePath)}</div><article class="markdown-body">${html}</article></div></body></html>`);
