/**
 * The one thing you have to fill in yourself.
 *
 * Both online play and the shared high score board need a server: two browsers
 * cannot find each other on their own, and a list that lives in one browser is
 * not a list anybody else can see. Everything else in this game runs off static
 * files, and this is the single line that changes that.
 *
 * Put the address of your relay here - a Cloudflare Worker (see worker/README.md,
 * free and about two commands) or your own `node server/relay.js` somewhere with
 * a public address. Leave it empty and the game still plays: one player, two
 * players, your own high score table. Only the shared parts go quiet.
 *
 *   export const DEFAULT_RELAY = 'wss://websoccer.your-name.workers.dev';
 */
export const DEFAULT_RELAY = '';

/**
 * Which relay this page should talk to. A `?relay=` in the address always wins,
 * so you can point a tab at a different one without editing anything. On
 * localhost the page assumes the server that served it, because that is what
 * `npm start` gives you.
 */
export function relayFor(location) {
  const override = new URLSearchParams(location.search || '').get('relay');
  if (override) return override;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local && DEFAULT_RELAY) return DEFAULT_RELAY;
  return `${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}`;
}

/**
 * The board lives on the same server as the relay, over plain HTTP. Returns
 * null when there is nowhere to ask, which is the signal to stay local.
 */
export function boardFor(location) {
  const relay = relayFor(location);
  if (!relay) return null;
  const url = relay.replace(/^ws/, 'http').replace(/\/+$/, '');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // On a static host with nothing configured, the page's own origin has no
  // board behind it and asking would only produce a console full of 404s.
  if (!local && !DEFAULT_RELAY && !new URLSearchParams(location.search || '').get('relay')) {
    return null;
  }
  return `${url}/highscores`;
}
