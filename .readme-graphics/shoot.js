// Headless Chrome screenshots driven by a JSON list of jobs: a frozen clock, a colour scheme, pre-seeded
// localStorage, an optional in-page action, a clip, and element measurements written to a JSON file.
// Usage: bun shoot.js <jobs.json> [<measurements.json>]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const STORY_TIME_ZONE = 'Europe/Amsterdam';
const CHROME_CANDIDATES = [
  process.env['CHROME_BINARY'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const [jobsPath, measurementsPath] = process.argv.slice(2);
if (!jobsPath) throw new Error('usage: bun shoot.js <jobs.json> [<measurements.json>]');
const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));
const chromeBinary = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromeBinary) throw new Error('No Chrome or Chromium found; set CHROME_BINARY');

function createSession(socket) {
  let nextCommandIdentifier = 1;
  const pendingCommands = new Map();
  let loadWaiters = [];
  socket.addEventListener('message', (messageEvent) => {
    const message = JSON.parse(String(messageEvent.data));
    if (message.id !== undefined) {
      const pending = pendingCommands.get(message.id);
      pendingCommands.delete(message.id);
      if (message.error) pending?.reject(new Error(JSON.stringify(message.error)));
      else pending?.resolve(message.result);
    } else if (message.method === 'Page.loadEventFired') {
      for (const waiter of loadWaiters) waiter();
      loadWaiters = [];
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      console.error('page exception:', details.exception?.description ?? details.text);
    }
  });
  return {
    send(method, parameters = {}) {
      const identifier = nextCommandIdentifier++;
      return new Promise((resolve, reject) => {
        pendingCommands.set(identifier, { resolve, reject });
        socket.send(JSON.stringify({ id: identifier, method, params: parameters }));
      });
    },
    nextLoad() {
      return new Promise((resolve) => loadWaiters.push(resolve));
    },
  };
}

async function debuggingPortOf(userDataDirectory) {
  const portFile = join(userDataDirectory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim());
      if (port > 0) return port;
    }
    await Bun.sleep(100);
  }
  throw new Error('Chrome never wrote DevToolsActivePort');
}

async function pageWebSocketUrlOf(port) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pageTarget = targets.find((target) => target.type === 'page');
      if (pageTarget) return pageTarget.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await Bun.sleep(100);
  }
  throw new Error('Chrome exposed no page target');
}

function clockFreezingScript(frozenNow) {
  return `(() => {
    const offsetMilliseconds = Date.parse(${JSON.stringify(frozenNow)}) - Date.now();
    const OriginalDate = Date;
    class FrozenDate extends OriginalDate {
      constructor(...values) { if (values.length === 0) super(OriginalDate.now() + offsetMilliseconds); else super(...values); }
      static now() { return OriginalDate.now() + offsetMilliseconds; }
    }
    globalThis.Date = FrozenDate;
  })();`;
}

function storageSeedingScript(entries) {
  return `(() => { try { const entries = ${JSON.stringify(entries)}; for (const key of Object.keys(entries)) localStorage.setItem(key, entries[key]); } catch (error) {} })();`;
}

function rectangleExpression(selector) {
  return `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left + scrollX, top: box.top + scrollY, right: box.right + scrollX, bottom: box.bottom + scrollY }; })()`;
}

const userDataDirectory = mkdtempSync(join(tmpdir(), 'readme-graphics-chrome-'));
const chromeProcess = Bun.spawn([
  chromeBinary, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${userDataDirectory}`, 'about:blank',
], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, TZ: STORY_TIME_ZONE } });

// Every file is served under /files/<absolute path>, so a page's relative links resolve as they would on disk.
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    const requestedPath = decodeURIComponent(new URL(request.url).pathname);
    if (!requestedPath.startsWith('/files/')) return new Response('not found', { status: 404 });
    const filePath = requestedPath.slice('/files'.length);
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    return new Response(Bun.file(filePath), { headers: { 'cache-control': 'no-store' } });
  },
});

const measurements = measurementsPath && existsSync(measurementsPath) ? JSON.parse(readFileSync(measurementsPath, 'utf8')) : {};

try {
  const socket = new WebSocket(await pageWebSocketUrlOf(await debuggingPortOf(userDataDirectory)));
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('could not connect to Chrome')), { once: true });
  });
  const session = createSession(socket);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Emulation.setTimezoneOverride', { timezoneId: STORY_TIME_ZONE });

  for (const job of jobs) {
    await session.send('Emulation.setDeviceMetricsOverride', { width: job.width, height: job.height, deviceScaleFactor: job.scale ?? 2, mobile: false });
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: job.colorScheme ?? 'light' }] });
    await session.send('Emulation.setDefaultBackgroundColorOverride', job.transparentBackground ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
    const injectedScripts = [];
    if (job.frozenNow) injectedScripts.push((await session.send('Page.addScriptToEvaluateOnNewDocument', { source: clockFreezingScript(job.frozenNow) })).identifier);
    if (job.localStorageEntries) injectedScripts.push((await session.send('Page.addScriptToEvaluateOnNewDocument', { source: storageSeedingScript(job.localStorageEntries) })).identifier);

    const loaded = session.nextLoad();
    await session.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/files${job.html}` });
    await loaded;
    await Bun.sleep(job.waitMilliseconds ?? 400);
    if (job.actionScript) {
      const evaluation = await session.send('Runtime.evaluate', { expression: job.actionScript, awaitPromise: true, returnByValue: true });
      if (evaluation.exceptionDetails) throw new Error(`${job.output}: action failed: ${evaluation.exceptionDetails.exception?.description}`);
      await Bun.sleep(350);
    }

    if (job.measure) {
      const measured = {};
      for (const [name, selector] of Object.entries(job.measure)) {
        measured[name] = (await session.send('Runtime.evaluate', { expression: rectangleExpression(selector), returnByValue: true })).result.value;
        if (!measured[name]) throw new Error(`${job.name}: nothing matches ${selector}`);
      }
      measurements[job.name] = measured;
    }

    let clip;
    if (job.clip) clip = job.clip;
    if (job.clipSelector) {
      const box = (await session.send('Runtime.evaluate', { expression: rectangleExpression(job.clipSelector), returnByValue: true })).result.value;
      if (!box) throw new Error(`${job.output}: nothing matches ${job.clipSelector}`);
      clip = { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
    }
    if (job.clipBottomSelector) {
      const box = (await session.send('Runtime.evaluate', { expression: rectangleExpression(job.clipBottomSelector), returnByValue: true })).result.value;
      if (!box) throw new Error(`${job.output}: nothing matches ${job.clipBottomSelector}`);
      clip = { x: 0, y: 0, width: job.width, height: Math.ceil(box.bottom + (job.clipBottomPadding ?? 0)) };
    }
    if (job.fullPage && !clip) {
      const metrics = await session.send('Page.getLayoutMetrics');
      clip = { x: 0, y: 0, width: job.width, height: Math.ceil(metrics.cssContentSize.height) };
    }
    if (job.output) {
      const capture = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: Boolean(clip), ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      mkdirSync(dirname(job.output), { recursive: true });
      writeFileSync(job.output, Buffer.from(capture.data, 'base64'));
    }
    for (const identifier of injectedScripts) await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  socket.close();
} finally {
  if (measurementsPath) writeFileSync(measurementsPath, `${JSON.stringify(measurements, null, 2)}\n`);
  server.stop(true);
  chromeProcess.kill();
  await chromeProcess.exited;
  rmSync(userDataDirectory, { recursive: true, force: true });
}
console.log(`shot ${jobs.filter((job) => job.output).length} image(s) from ${jobsPath}`);
