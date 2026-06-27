---
name: run-online-match
description: Smoke-test a GlitchGoal online 1v1 match end-to-end — start the signaling server + Vite client, drive two headless Chromium tabs through matchmaking + WebRTC, and verify rollback inputs flow between peers. Use when verifying netcode/client/server changes actually work in a real browser.
---

# Run an online 1v1 smoke test

Launches the real servers and drives two browser tabs through a full match. This
is the verified path — it confirms matchmaking, the WebRTC DataChannel, and
rollback netcode all work together, which the unit tests cannot (no headless
WebRTC in the test runner).

## Prerequisites (one-time)

Playwright + headless Chromium must be installed:

```bash
cd /home/joe/projects/glitchgoal
npm install -D playwright
npx playwright install chromium
```

The driver script below must run from the repo root (so Node resolves the
`playwright` package from `node_modules`) — do NOT put it in `/tmp`.

## 1. Start both servers (background)

```bash
cd /home/joe/projects/glitchgoal
PORT=8080 npx tsx packages/server/src/main.ts > /tmp/gg-server.log 2>&1 &
echo $! > /tmp/gg-server.pid
npm --workspace @glitchgoal/client run dev > /tmp/gg-vite.log 2>&1 &
echo $! > /tmp/gg-vite.pid
# Poll, don't sleep:
timeout 30 bash -c 'until grep -q listening /tmp/gg-server.log; do sleep 0.5; done'
timeout 40 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 0.5; done'
```

## 2. Drive two tabs

Write this to `gg-smoke.mjs` **in the repo root** and run `node gg-smoke.mjs`:

```js
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:5173';
const errors = { A: [], B: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const pageA = await ctx.newPage();
const pageB = await ctx.newPage();
pageA.on('console', (m) => m.type() === 'error' && errors.A.push(m.text()));
pageB.on('console', (m) => m.type() === 'error' && errors.B.push(m.text()));
pageA.on('pageerror', (e) => errors.A.push(String(e)));
pageB.on('pageerror', (e) => errors.B.push(String(e)));

await pageA.goto(URL);
await pageB.goto(URL);
await pageA.getByRole('button', { name: 'Find online match' }).click();
await pageB.getByRole('button', { name: 'Find online match' }).click();
await pageA.waitForSelector('canvas', { timeout: 15000 });
await pageB.waitForSelector('canvas', { timeout: 15000 });
await pageA.waitForTimeout(3000); // let the DataChannel open

const before = await pageB.locator('canvas').screenshot();
writeFileSync('/tmp/gg-B-before.png', before);

// Hold "D" in tab A; if netcode works, tab B re-renders the remote skater.
await pageA.bringToFront();
await pageA.keyboard.down('KeyD');
await pageA.waitForTimeout(1500);
await pageA.keyboard.up('KeyD');
await pageA.waitForTimeout(300);

const after = await pageB.locator('canvas').screenshot();
writeFileSync('/tmp/gg-B-after.png', after);
writeFileSync('/tmp/gg-A.png', await pageA.locator('canvas').screenshot());

const changed = Buffer.compare(before, after) !== 0;
console.log('pageB changed after pageA input:', changed);
console.log('errors A/B:', errors.A.length, errors.B.length, ...errors.A, ...errors.B);
await browser.close();
process.exit(changed ? 0 : 2);
```

## 3. Check the result

- **Exit 0 + `pageB changed after pageA input: true`** → netcode works end to end.
- **Look at the screenshots** (`/tmp/gg-A.png`, `/tmp/gg-B-after.png`): both tabs
  must show the SAME state (deterministic sim + rollback). The red skater
  (player 0 / first tab) should be driven to the right boards in both.
- `errors A/B` must be `0 0`.

## 4. Clean up

```bash
kill "$(cat /tmp/gg-server.pid)" "$(cat /tmp/gg-vite.pid)" 2>/dev/null
pkill -9 -f 'packages/server/src/main.ts'; pkill -9 -f 'vite/bin/vite'
rm -f /home/joe/projects/glitchgoal/gg-smoke.mjs
```

## Gotchas

- **Run the driver from the repo root**, not `/tmp` — otherwise
  `ERR_MODULE_NOT_FOUND: playwright`.
- **No TURN needed locally**: two tabs in one browser connect over loopback host
  ICE candidates even if STUN is unreachable.
- **`localhost` is a secure context**, so WebRTC is permitted over plain http.
- **Idle skaters don't move**, so you must inject input (the `KeyD` hold) to
  prove the loop+netcode are live — a static screenshot alone won't.
- Both `pkill` lines can exit non-zero if nothing matched; that's fine.
