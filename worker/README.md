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
- `POST /highscores/reset` — empties the board, if you have set a key (below).
- `POST /highscores/remove` — takes named rows off and keeps them off.
- A new entry is posted to Discord, if you have set a webhook (below).
- `POST /highscores` — send yours, get everyone's back merged. The merge is the
  same function the browser runs (`src/highscores.js`), so the two cannot
  disagree about what a board is, and results that are not real results - a
  defeat, a made up row - do not survive it.

It all lives in one Durable Object. A plain Worker is stateless and cannot hold
two players' sockets together, and one object for the whole game is plenty here.
The migration in `wrangler.toml` uses `new_sqlite_classes`, which is the storage
class Durable Objects offer on the free plan; check Cloudflare's current limits
if you expect a crowd.

## Telling Discord about it

Every result that lands on the board can be posted to a Discord channel. It uses
a webhook rather than a bot: no gateway connection to keep alive, no token to
rotate, nothing else to host - and the channel still shows whatever name and
avatar you gave the webhook, so it reads as your own app.

In Discord: **Channel settings → Integrations → Webhooks → New webhook**, give it
a name and a picture, and copy the URL. Then:

```sh
npx wrangler secret put DISCORD_WEBHOOK    # paste the URL
```

That is all. Posts look like:

> 🏆 **MJC** beat **HARD** 5-1 — top of the table

The Worker works out what to announce from the board itself, not from what the
browser sent, so a result that missed the top ten stays quiet and the same score
arriving from a second device is not announced twice. Discord being slow or down
never costs anybody their score: the message is sent alongside the answer, not
before it, and a failure is dropped.

Set no webhook and nothing is sent, which is the default.

## Sweeping the board

A public list with no accounts on it will eventually collect something you would
rather not have on it. Set a key once:

```sh
npx wrangler secret put ADMIN_KEY     # type any long password
```

and you can empty it whenever you like:

```sh
curl -X POST -H "x-admin-key: your-password" \
  https://websoccer.your-name.workers.dev/highscores/reset
```

Emptying it remembers *when* it was emptied and refuses anything older, because
wiping the server does not wipe anybody's browser: without that, the next sync
posts the old rows straight back and the board refills itself. This is not
hypothetical - it is what happened the first time.

To take one row off instead of all of them, which is what you want when the board
also holds scores people earned:

```sh
curl https://websoccer.your-name.workers.dev/highscores      # find the id
curl -X POST -H "x-admin-key: your-password" -H "content-type: application/json" \
  -d '{"ids":["mt2w0p0c-1fwwy"]}' \
  https://websoccer.your-name.workers.dev/highscores/remove
```

Those ids are remembered too, for the same reason.

With no `ADMIN_KEY` set neither door is there at all, which is the safe default
if you deploy this and never read this file.

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
