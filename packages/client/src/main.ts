/**
 * Entry point + menu. Choose local hot-seat or an online 1v1 match. When
 * Supabase is configured, online play signs in (anonymously, with a username),
 * shows the player's MMR + a leaderboard, and records ranked results.
 */

import { Renderer } from './renderer.js';
import { startLocalGame } from './localGame.js';
import { startOnlineGame } from './net/onlineGame.js';
import { isSupabaseConfigured, leaderboard, signIn, type Session } from './auth.js';
import type { Identity } from './net/protocol.js';

const DEFAULT_SERVER = 'ws://localhost:8080';
let session: Session | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

async function startGame(
  start: (r: Renderer, setStatus: (t: string) => void) => void | Promise<void>,
): Promise<void> {
  const mount = document.getElementById('app')!;
  mount.innerHTML = '';
  const renderer = new Renderer();
  await renderer.init(mount);
  // Persistent status line below the canvas (survives the match, unlike the menu).
  const statusEl = el('div', { className: 'game-status' });
  statusEl.style.cssText = 'font-size:13px;opacity:0.9;margin-top:8px;min-height:18px;text-align:center;';
  mount.append(statusEl);
  await start(renderer, (t) => (statusEl.textContent = t));
}

function showMenu(): void {
  const mount = document.getElementById('app')!;
  mount.innerHTML = '';

  const menu = el('div');
  menu.style.cssText = 'display:flex;flex-direction:column;gap:10px;align-items:center;min-width:260px;';

  const status = el('div');
  status.style.cssText = 'font-size:12px;opacity:0.85;min-height:16px;text-align:center;';

  const who = el('div');
  who.style.cssText = 'font-size:13px;';
  who.textContent = session ? `${session.profile.username} — MMR ${session.profile.mmr}` : '';

  const serverInput = el('input', { value: DEFAULT_SERVER });
  serverInput.style.cssText = 'width:240px;text-align:center;';

  const localBtn = el('button', { textContent: 'Local hot-seat' });
  const onlineBtn = el('button', { textContent: 'Find online match' });

  localBtn.onclick = () => void startGame((r) => startLocalGame(r));
  onlineBtn.onclick = () => {
    status.textContent = 'connecting / waiting for opponent…';
    const identity: Identity | undefined = session?.identity;
    void startGame((r, setStatus) => {
      setStatus('connecting / waiting for opponent…');
      return startOnlineGame(serverInput.value, r, { identity, onStatus: setStatus, onEnd: showMenu });
    }).catch((err: unknown) => {
      status.textContent = `failed: ${String(err)}`;
      showMenu();
    });
  };

  menu.append(who, localBtn, el('div', { textContent: 'or' }), serverInput, onlineBtn, status);

  if (session) {
    const board = el('div');
    board.style.cssText = 'font-size:11px;opacity:0.8;margin-top:8px;white-space:pre;';
    board.textContent = 'loading leaderboard…';
    menu.append(board);
    void leaderboard(session.data)
      .then((rows) => {
        board.textContent =
          'LEADERBOARD\n' +
          rows.map((r, i) => `${i + 1}. ${r.username}  ${r.mmr}`).join('\n') || 'no players yet';
      })
      .catch(() => (board.textContent = ''));
  }

  mount.append(menu);
}

async function boot(): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      session = await signIn(async () => window.prompt('Choose a username:') ?? '');
    } catch (err) {
      // Fall back to anonymous play if sign-in fails.
      // eslint-disable-next-line no-console
      console.warn('sign-in failed, playing anonymously:', err);
    }
  }
  showMenu();
}

void boot();
