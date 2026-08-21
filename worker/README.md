# The relay, on Cloudflare

Two things in this game need a server: pairing two browsers up for an online
match, and keeping the high score board everyone shares. Everything else is
static files. This directory is that server, small enough to read in one sitting
and free to run.

## Putting it live

You need a Cloudflare account (free, no card) and node.

```sh
cd worker
npx wrangler login     # opens a browser once
npx wrangler deploy
```

Wrangler prints an address like `https://websoccer.your-name.workers.dev`. Take
that address, and in `src/config.js` set:

```js
export const DEFAULT_RELAY = 'wss://websoccer.your-name.workers.dev';
```

Note `wss://`, not `https://`. Commit that and the game starts using it: online
matches find each other, and every browser sees the same high score table.

## What it does

- `GET /` — a line of text, so you can see it is alive.
- `websocket upgrade` — the room protocol: `create`, `join`, and everything else
  passed straight through to the other player. Identical to `server/relay.js`,
  which is what `npm start` runs locally.
- `GET /highscores` — the board.
- `POST /highscores` — send yours, get everyone's back merged. The merge is the
  same function the browser runs (`src/highscores.js`), so the two cannot
  disagree about what a board is, and results that are not real results - a
  defeat, a made up row - do not survive it.

It all lives in one Durable Object. A plain Worker is stateless and cannot hold
two players' sockets together, and one object for the whole game is plenty here.
The migration in `wrangler.toml` uses `new_sqlite_classes`, which is the storage
class Durable Objects offer on the free plan; check Cloudflare's current limits
if you expect a crowd.

## What it does not do

It does not know the rules of football. The simulation is deterministic and runs
on the players' own machines - the relay only carries their inputs. And it does
not check that a score is *true*: anyone who can read `src/highscores.js` can
post a made up result. That is the price of a board with no accounts on it. It
refuses nonsense and defeats, caps every table at ten, and beyond that it trusts
the people you gave the address to.

## Testing it

```sh
node tools/workercheck.js
```

Runs the whole thing in node with the Cloudflare bits stubbed: rooms, pairing,
disconnects, the board, storage. No account needed.
