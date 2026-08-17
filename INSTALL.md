# Installation guide

WebSoccer has **no dependencies** and **no build step**. All you need is Node.js
to run the server; the game itself just runs in the browser.

## 1. Requirements

| What    | Version                                                |
| ------- | ------------------------------------------------------ |
| Node.js | 20 or newer (22+ recommended, required for `npm test`) |
| Browser | Any modern browser (Chrome, Firefox, Safari, Edge)     |

Check your version:

```bash
node --version
```

No Node yet? Get it from [nodejs.org](https://nodejs.org/) or, on macOS with
Homebrew: `brew install node`.

> **Why 22+ for the tests?** The network test uses the `WebSocket` that ships
> built into Node from version 22. The game and the server run fine on Node 20.

## 2. Getting the code

With git:

```bash
git clone https://github.com/markclausing/websoccer.git
cd websoccer
```

Or download the ZIP from the green **Code** button on GitHub and unpack it.

There is **no `npm install`** — there are no packages to install.

## 3. Running it

```bash
npm start
```

You will see:

```
WebSoccer running at http://localhost:5173/
```

Open that link in your browser and hit **KICK OFF**. Done.

Prefer to skip npm? `node server/relay.js` does exactly the same thing.

### Using a different port

```bash
PORT=8080 npm start
```

## 4. Playing online

The server that serves the page also pairs up the players. Nothing else is
needed.

**Pointing at a relay somewhere else**
The page connects to whatever server served it. To use a relay running elsewhere
(handy if you host the static files separately, for instance on GitHub Pages),
add it to the URL: `?relay=wss://your-relay.example`.

**On one computer (to try it out)**
Open http://localhost:5173/ in two tabs. In one tab: *Online → Open a new match*.
Copy the code into the other tab and click *Join*.

**Two computers on the same network**
Find the IP address of the machine running the server:

```bash
ipconfig getifaddr en0     # macOS (wifi)
hostname -I                # Linux
ipconfig                   # Windows
```

The second player opens `http://<that-ip>:5173/`. The page automatically connects
back to the server it came from. Allow port 5173 through the firewall if you are
asked to.

**Over the internet**
Put the project on a server (a small VPS is plenty) and run `npm start` there. If
you put a reverse proxy in front of it, make sure it passes WebSocket traffic
through. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Behind HTTPS the client switches to `wss://` by itself.

If you only want to let someone join quickly without setting up a server, a
tunnel works too: `ssh -R 80:localhost:5173 serveo.net` or `ngrok http 5173`.

## 5. Running the tests

```bash
npm test           # all three suites
npm run test:sim   # simulation + determinism
npm run test:net   # two real players through the real server
npm run test:ui    # the browser side against a fake DOM
```

They all run without a browser and without dependencies.

## Troubleshooting

**`Error: listen EADDRINUSE: address already in use :::5173`**
Something is already running on that port. Stop it:

```bash
lsof -ti:5173 | xargs kill     # macOS / Linux
```

Or pick another port: `PORT=8080 npm start`.

**I opened `index.html` directly and got a blank screen**
That cannot work: browsers block ES modules over `file://`, and playing online
needs the server anyway. Use `npm start`.

**The other computer cannot load the page**
Usually the firewall. Also check that you are using the right IP address and that
both computers really are on the same network (router guest networks are often
isolated).

**"WAITING FOR OPPONENT" stays on screen**
Your opponent's inputs are not arriving. A brief hiccup sorts itself out; if it
stays, the connection is gone. That is by design, not a bug: the game would
rather wait than guess and have the two of you playing different matches.

**A `SyntaxError` or `ReferenceError` on startup**
Almost always an outdated Node. Check `node --version`.
