// Takes the screenshots in the README, by driving a real browser.
//
//   npm start                 # in another terminal
//   node tools/screenshot.js
//
// Chrome is started headless and steered over the DevTools protocol, which node
// can speak with its built-in WebSocket - no puppeteer, no dependency. What ends
// up in the PNGs is the real page rendering a real match, not a mock-up: the
// tool clicks the menu and waits, exactly as a player would.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.env.URL || 'http://localhost:5173/';
const PORT = 9223;
const OUT = 'docs/screenshots';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Devtools {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true });
    return res?.result?.value;
  }

  /** A real key press, so the blue side is not a statue in the pictures. */
  async key(code, key, down) {
    await this.send('Input.dispatchKeyEvent', {
      type: down ? 'keyDown' : 'keyUp', code, key, windowsVirtualKeyCode: 0,
    });
  }

  /** Waits for the match to reach a moment worth photographing. */
  async waitForAction(seconds = 40) {
    for (let i = 0; i < seconds * 5; i++) {
      const near = await this.evaluate(`(() => {
        const g = window.__game;
        if (!g?.state) return false;
        const b = g.state.ball;
        // Within shooting range of either goal, and someone is on the ball.
        const top = Math.hypot(b.x - 400, b.y - 80);
        const bottom = Math.hypot(b.x - 400, b.y - 1080);
        return (Math.min(top, bottom) < 260) && !!b.owner;
      })()`);
      if (near) return true;
      await sleep(200);
    }
    return false;
  }

  async shot(file) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, file), Buffer.from(res.data, 'base64'));
    console.log(`wrote ${OUT}/${file}`);
  }
}

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://localhost:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* browser still starting */ }
    await sleep(250);
  }
  throw new Error('Chrome never came up on the debugging port');
}

async function main() {
  const chrome = CHROME.find((p) => existsSync(p));
  if (!chrome) throw new Error(`No Chrome found. Looked in:\n  ${CHROME.join('\n  ')}`);

  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'websoccer-shot-'));
  const browser = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1400,960',
    // The tune and the crowd would otherwise wait for a gesture that never comes;
    // this lets the page make sound without one, which also unblocks the loop.
    '--autoplay-policy=no-user-gesture-required',
    URL_UNDER_TEST,
  ], { stdio: process.env.DEBUG_CHROME ? 'inherit' : 'ignore' });

  try {
    const page = await findPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('could not attach to the page'));
    });
    const dt = new Devtools(ws);
    await dt.send('Page.enable');
    await dt.send('Runtime.enable');
    await sleep(1200); // modules load and the menu paints

    // 1. The menu.
    await dt.shot('menu.png');

    // 2. A match in progress: hold a direction so the human side plays, then
    //    wait until the ball is actually somewhere interesting.
    await dt.evaluate("document.getElementById('start').click()");
    await sleep(500);
    await dt.key('KeyW', 'w', true);
    await dt.waitForAction();
    await dt.shot('gameplay.png');
    await dt.key('KeyW', 'w', false);

    // 3. The moment you earn a place on the board: win the match, then type two
    //    of the three letters so the picker is caught mid-signature.
    //
    //    Nine nil on purpose. The page merges in whatever board the server it is
    //    talking to already holds, and a modest win against a board with ten
    //    rows on it does not qualify - which is exactly how this shot came out
    //    empty the first time.
    await dt.evaluate(`(() => {
      const s = window.__game.state;
      s.score[0] = 9;
      s.score[1] = 0;
      s.phase = 'fulltime';
    })()`);
    await sleep(400);
    for (const letter of ['M', 'J']) {
      await dt.key(`Key${letter}`, letter, true);
      await dt.key(`Key${letter}`, letter, false);
      await sleep(150);
    }
    await sleep(300);
    await dt.shot('highscore.png');

    // 4. A phone, held sideways, with the on-screen controls.
    await dt.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
    });
    await dt.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await dt.send('Page.navigate', { url: URL_UNDER_TEST });
    await sleep(2000);
    await dt.evaluate("document.getElementById('start').click()");
    await sleep(7000);
    await dt.shot('mobile.png');

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
