# Installatiehandleiding

WebSoccer heeft **geen dependencies** en **geen buildstap**. Je hebt alleen
Node.js nodig om de server te draaien; de game zelf draait gewoon in de browser.

## 1. Vereisten

| Wat            | Versie                                                       |
| -------------- | ------------------------------------------------------------ |
| Node.js        | 20 of nieuwer (22+ aanbevolen, nodig voor `npm test`)         |
| Browser        | Elke moderne browser (Chrome, Firefox, Safari, Edge)          |

Controleer je versie:

```bash
node --version
```

Heb je nog geen Node? Haal het op bij [nodejs.org](https://nodejs.org/) of, op
macOS met Homebrew: `brew install node`.

> **Waarom 22+ voor de tests?** De netwerktest gebruikt de `WebSocket` die sinds
> Node 22 standaard ingebouwd zit. De game en de server werken prima op Node 20.

## 2. Ophalen

Met git:

```bash
git clone https://github.com/markclausing/websoccer.git
cd websoccer
```

Of download de ZIP via de groene **Code**-knop op GitHub en pak hem uit.

Er is **geen `npm install`** nodig — er zijn geen packages om te installeren.

## 3. Starten

```bash
npm start
```

Je ziet:

```
WebSoccer draait op http://localhost:5173/
```

Open die link in je browser en klik op **AFTRAP**. Klaar.

Liever zonder npm? `node server/relay.js` doet precies hetzelfde.

### Een andere poort gebruiken

```bash
PORT=8080 npm start
```

## 4. Online tegen elkaar spelen

De server die de pagina serveert, koppelt ook de spelers. Er is verder niets
nodig.

**Op één computer (om te testen)**
Open http://localhost:5173/ in twee tabbladen. In het ene tabblad: *Online →
Nieuwe wedstrijd openen*. Neem de code over in het andere tabblad en klik op
*Deelnemen*.

**Twee computers in hetzelfde netwerk**
Zoek het IP-adres van de computer waar de server draait:

```bash
ipconfig getifaddr en0     # macOS (wifi)
hostname -I                # Linux
ipconfig                   # Windows
```

De tweede speler opent `http://<dat-ip>:5173/`. De pagina verbindt automatisch
terug naar de server waar hij vandaan komt. Laat de firewall poort 5173 toe als
je erom gevraagd wordt.

**Over internet**
Zet het project op een server (een kleine VPS is ruim voldoende) en draai daar
`npm start`. Zet je er een reverse proxy voor, zorg dan dat die WebSocket-
verkeer doorlaat. Voor nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Achter HTTPS schakelt de client vanzelf over op `wss://`.

Wil je alleen even snel iemand laten meespelen zonder server, dan werkt een
tunnel ook: `ssh -R 80:localhost:5173 serveo.net` of `ngrok http 5173`.

## 5. Tests draaien

```bash
npm test           # alle drie de suites
npm run test:sim   # simulatie + determinisme
npm run test:net   # twee echte spelers via de echte server
npm run test:ui    # de browserkant tegen een namaak-DOM
```

Ze draaien allemaal zonder browser en zonder dependencies.

## Problemen oplossen

**`Error: listen EADDRINUSE: address already in use :::5173`**
Er draait al iets op die poort. Stop het:

```bash
lsof -ti:5173 | xargs kill     # macOS / Linux
```

Of kies een andere poort: `PORT=8080 npm start`.

**Ik open `index.html` rechtstreeks en zie een leeg scherm**
Dat kan niet werken: browsers blokkeren ES-modules via `file://`, en online
spelen heeft de server sowieso nodig. Gebruik `npm start`.

**De andere computer krijgt de pagina niet te zien**
Meestal de firewall. Controleer ook of je het juiste IP-adres gebruikt en of
beide computers echt in hetzelfde netwerk zitten (gastennetwerken van routers
zijn vaak afgeschermd).

**"WACHTEN OP TEGENSTANDER" blijft in beeld staan**
De inputs van je tegenstander komen niet aan. Bij een korte hapering lost dat
zichzelf op; blijft het staan, dan is de verbinding weg. Dat is geen bug maar
opzet: het spel wacht liever even dan dat het gaat gokken en jullie twee
verschillende wedstrijden gaan spelen.

**`SyntaxError` of `ReferenceError` bij het starten**
Vrijwel altijd een te oude Node. Check `node --version`.
