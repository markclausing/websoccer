# Contributing to WebSoccer

Good to have you here. This document covers how the project fits together, what
the rules are, and how to get a change merged.

New here? Start with [INSTALL.md](INSTALL.md) to get it running, and play a few
matches first — most questions about the code answer themselves once you have
felt the game.

## The shape of the project

Two things drive almost every decision in this codebase:

**1. No dependencies, no build step.** You clone the project and `npm start`
works. No bundler, no transpiler, no `node_modules`. The browser loads the ES
modules directly. That also means no framework is going in; if something can only
be done with a library, it is worth asking whether we want it at all.

**2. The simulation is deterministic.** That is not tidiness, it is the pivot the
online multiplayer turns on. See below.

## The most important rule: determinism

Online multiplayer runs on **lockstep**: both machines run the same simulation
and only send each other their buttons. If the same starting state plus the same
inputs produce a different outcome on two machines, the players quietly end up
playing different matches. So everything in `src/game/**` must be pure.

Inside `src/game/**` you may not use:

- `Math.random()` — use `randRange(state, lo, hi)` or `nextRandom(state)` from
  `src/util.js`, which draw from `state.rng`;
- `Date.now()` or `performance.now()`;
- iteration whose order is not fixed (`Set`, `Object.keys()` over dynamic keys);
- anything read from the DOM or the network.

And beyond that:

- **Rendering only reads.** `src/render/**` must never write to `state`. Camera
  smoothing and screen shake sit outside the simulation for exactly this reason —
  cosmetics may differ per machine, the match may not.
- **New randomness belongs in the simulation**, not in the caller.
- **The AI belongs inside the simulation.** If the CPU decided outside `step()`,
  two machines would make different decisions.
- **One tick runs in three phases**: first all 22 players decide their intent from
  the same snapshot, then kicks are carried out, then everyone moves. Move a
  decision in front of the intent phase by accident and one team reacts to fresh
  positions while the other reacts to stale ones. That is not theoretical: it
  measurably won team 1 more goals (114 to 66 across 60 CPU matches).

`npm run test:sim` and `npm run test:net` catch violations of this, though not
always straight away — determinism bugs can be rare. So give it a thought.

## Where things live

```
src/constants.js      dimensions, speeds, rule constants - start here if you
                      want to tune how the game feels
src/util.js           maths + deterministic PRNG
src/input.js          keyboard/gamepad -> 5-bit mask
src/main.js           menu, fixed-timestep game loop
src/game/state.js     match state, formations, kickoff, clone + hash
src/game/sim.js       step(): the only place where the match changes
src/game/ai.js        CPU logic
src/game/kick.js      shared kick function for human and CPU
src/render/pitch.js   the pitch (drawn once onto an offscreen canvas)
src/render/renderer.js camera, players, ball, HUD, radar, network status
src/net/signal.js     WebSocket client: rooms and message routing
src/net/transport.js  LocalTransport and OnlineTransport (lockstep)
server/relay.js       static files + rooms + passing inputs along
server/ws.js          WebSocket protocol by hand
tools/                the tests
```

The game loop talks to a transport through four methods: `sample(tick)`,
`ready(tick)`, `poll(tick)` and `afterStep(state)`. Local and online both
implement those same four. If you want to add a new way of playing (replays, say,
or an AI-versus-AI mode), a new transport is usually the answer — not a change in
`sim.js`.

## Tests

```bash
npm test           # all three
npm run test:sim   # plays whole matches headless; checks determinism
npm run test:net   # starts the relay, connects two real clients, plays 100s and
                   # checks both sides compute the same match
npm run test:ui    # runs main.js against a fake DOM: menu, local match, online
                   # match, and an opponent who disappears
```

Which one to run when:

| You touched...                     | Run at least            |
| ---------------------------------- | ----------------------- |
| `src/game/**`, `src/constants.js`  | `test:sim` + `test:net` |
| `src/net/**`, `server/**`          | `test:net` + `test:ui`  |
| `src/main.js`, `src/render/**`     | `test:ui`               |
| anything else                      | `npm test`              |

If you change how the game feels (speeds, kick power, AI), run `test:sim` and see
whether the goals per match stay sane — around 2 to 3 per 2×2 minute match. A
balance that collapses completely is usually a sign something is broken, not just
that it plays differently.

`test:sim` also plays each CPU difficulty against HARD and checks the easier
levels stay measurably weaker. If you add a knob to `AI_LEVELS`, measure it: run
it against HARD on its own first. Several plausible-sounding handicaps turned out
to do nothing, and holding the keeper back made his team *stronger*, which is why
the keeper plays the same at every level.

Measure with territory, not goals. Two goals a match is far too coarse a signal:
consecutive runs of the same settings came out anywhere between 0% and 60% of the
goals, while territory lands within a point or two every time.

Watch out for tipping points in the team shape. Making the defending side drop
off by 0.15 of the distance to their own goal scores 2.4 goals a match; 0.20 tips
the whole side behind the ball, the formation never comes back up, and it scores
0.5. Small changes around positioning are not safely small.

## Code style

There is deliberately no linter in your way; keep it simple and consistent with
what is already there:

- ES modules, 2-space indentation, semicolons, single quotes.
- Everything in English: identifiers, comments and player-facing text.
- Comments explain *why*, not *what*. The line explaining why a tick splits into
  three phases earns its keep; `// increment the counter` does not.
- Magic numbers that shape how the game feels belong in `src/constants.js`, with
  a name.

## Submitting a change

1. Fork the project and make a branch: `git checkout -b short-description`.
2. Make your change and run the relevant tests (see the table above).
3. Commit with a short descriptive line in the imperative: `add penalties`, not
   `added penalties`.
4. Open a pull request. Describe **what** you are changing and **why**, and for a
   change in how the game feels: how it plays. A short recording or a few lines
   of `test:sim` output say more than a long explanation.

Not sure whether something fits? Open an issue first. That saves work on both
sides.

## Open ideas

The README closes with a list of "What is not there yet". The most obvious chunks
of work:

- **Fouls and free kicks.** There is no referee right now; slide tackles are
  allowed to do anything. Penalties could decide matches too.
- **The keeper.** He walks to the ball and hoofs it clear, and that is it. Diving,
  catching and positioning on the line are all wide open.
- **Teams and formations.** There is one formation (4-3-3) and there are two
  teams. Team selection, other formations or a league: all welcome.
- **A binary network protocol.** Inputs currently go over the wire as JSON, around
  4 kB/s per player. That could be ten times leaner.
- **WebRTC.** Everything goes through the relay right now. Peer to peer would
  lower latency; the relay would still be needed to introduce the players.
- **Rematch and reconnect.** After a match you have to go back to the menu, and a
  dropped connection is final.
- **Sound.** There is none at all.

## Licence

Contributions fall under the same [MIT licence](LICENSE) as the rest of the
project.
