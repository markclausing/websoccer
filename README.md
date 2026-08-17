# WebSoccer

Arcade-voetbal in de browser, in de geest van de 16-bit klassiekers: verticaal
scrollend veld, kleine spelertjes, één knop, en aftertouch om de bal te laten
krullen.

Drie manieren om te spelen: **1 speler tegen de CPU**, **2 spelers op één
toetsenbord**, en **online tegen elkaar** via een kamercode.

Geen dependencies, geen buildstap. HTML, CSS en JavaScript zoals de browser ze
krijgt aangeleverd.

## Starten

```bash
git clone https://github.com/markclausing/websoccer.git
cd websoccer
npm start
```

Open daarna http://localhost:5173/ — dat is alles. Er is geen `npm install`
nodig; er zijn geen packages om te installeren.

Die ene server doet twee dingen: de pagina serveren en online wedstrijden
koppelen. Uitgebreidere uitleg (andere poort, spelen over het netwerk of over
internet, problemen oplossen) staat in [INSTALL.md](INSTALL.md).

Wil je meebouwen? Lees [CONTRIBUTING.md](CONTRIBUTING.md) — daar staat vooral
waarom de simulatie deterministisch moet blijven.

## Besturing

|                | Speler 1 (blauw) | Speler 2 (rood) |
| -------------- | ---------------- | --------------- |
| Lopen          | `W A S D`        | Pijltjes        |
| Trap / sliding | `Spatie`         | `Enter`         |
| Pauze          | `Esc`            | (niet online)   |

Online bestuur je één team en werken beide toetsenbordhelften voor jouw speler.
Gamepads werken ook.

Spelgevoel:

- **Kort tikken** = pass over de grond, **ingedrukt houden** = harder en hoger.
  Het balkje onder je speler toont de kracht; op maximum schiet hij vanzelf.
- **Aftertouch**: blijf ná de trap sturen. Zijwaarts laat de bal krullen,
  in de balrichting geeft lift, tegen de balrichting in laat hem duiken.
- Knop **zonder bal** = sliding.
- Je bestuurt automatisch de speler die het dichtst bij de bal is.

Er zijn doelpunten, inworpen, hoekschoppen, doeltrappen, rust en een eindsignaal.
Geen buitenspel en geen overtredingen — bewust, net als het origineel.

## Online spelen

1. Beide spelers openen de pagina van dezelfde server.
2. De één kiest **Online → NIEUWE WEDSTRIJD OPENEN** en krijgt een code van vier
   tekens. Die speler speelt blauw.
3. De ander vult de code in en klikt op **DEELNEMEN**. Die speelt rood.
4. Zodra de tweede speler binnen is, begint de wedstrijd bij beiden.

Waar dat werkt:

- **Twee tabbladen** op dezelfde computer (handig om te testen).
- **Twee computers in hetzelfde netwerk**: de tweede opent
  `http://<ip-van-de-host>:5173/`. De pagina verbindt automatisch terug naar de
  server waar hij vandaan komt. Let op de firewall van je Mac.
- **Over internet**: zet `server/relay.js` op een server (of tunnel poort 5173
  naar buiten). Achter HTTPS gebruikt de client vanzelf `wss://`.

Linksonder in beeld staat de ping. Wacht je op de tegenstander, dan verschijnt
er "WACHTEN OP TEGENSTANDER" in plaats van dat het spel gaat gokken.

## Architectuur

Alles hangt aan één regel:

```js
step(state, [maskTeam0, maskTeam1]); // dezelfde state + inputs -> altijd hetzelfde resultaat
```

De simulatie is puur en deterministisch: vaste tijdstap van 60 Hz, geen DOM, geen
`Math.random()` (alle toeval loopt via `state.rng`), en input is niets meer dan
een bitmask van 5 bits per speler.

Daardoor hoefde er voor online multiplayer **niets** aan de simulatie te
veranderen. De twee machines sturen elkaar alleen hun knoppen — nooit posities,
snelheden of standen — en rekenen ieder dezelfde wedstrijd uit.

```
index.html            menu (lokaal + online) en canvas
styles.css
src/
  constants.js        alle afmetingen, snelheden en spelregelconstanten
  util.js             wiskunde + deterministische PRNG (mulberry32)
  input.js            toetsenbord/gamepad -> bitmask
  main.js             menu, vaste-tijdstap game-loop
  game/
    state.js          wedstrijdtoestand, formaties, aftrap, clone + hash
    sim.js            step(): de enige plek waar de wedstrijd verandert
    ai.js             CPU-logica (draait binnen de simulatie)
    kick.js           gedeelde trapfunctie voor mens én CPU
  render/
    pitch.js          veld wordt één keer naar een offscreen canvas getekend
    renderer.js       camera, spelers, bal, HUD, radar, netwerkstatus
  net/
    signal.js         WebSocket-client: kamers en berichtroutering
    transport.js      LocalTransport (lokaal) en OnlineTransport (lockstep)
server/
  relay.js            statische bestanden + kamers + inputs doorgeven
  ws.js               WebSocket-protocol met de hand (geen dependencies)
tools/
  simtest.js          headless wedstrijd + determinisme-check
  netcheck.js         twee echte spelers via de echte server tegen elkaar
  uicheck.js          main.js tegen een namaak-DOM, inclusief online-flow
```

### Waar de lagen elkaar raken

- **Rendering leest alleen.** De renderer past nooit `state` aan. Camera-smoothing
  en schermschudden staan expres buiten de simulatie: cosmetica mag per machine
  verschillen, de wedstrijd niet.
- **Input is een integer.** De game-loop kent alleen
  `sample(tick)` / `ready(tick)` / `poll(tick)` / `afterStep(state)`. Lokaal en
  online implementeren dezelfde vier methodes; de loop weet niet wat eronder zit.
- **De AI zit ín de simulatie.** Anders zouden twee machines verschillende
  CPU-beslissingen nemen en meteen uit elkaar lopen.
- **Eén tick = drie fases.** Eerst bepalen alle 22 spelers hun intentie op dezelfde
  snapshot, daarna worden trappen uitgevoerd, daarna wordt er bewogen. Zonder die
  splitsing reageert team 1 op verse posities en team 0 op verouderde; dat gaf
  team 1 meetbaar meer doelpunten (114 om 66 over 60 CPU-wedstrijden, nu 74 om 62).

### Hoe de netcode werkt

**Lockstep met input-delay.** De input van tick T wordt een aantal ticks van
tevoren verstuurd, zodat hij op tijd aan de overkant is. Is hij er toch niet, dan
wacht de simulatie ("stall") in plaats van te gokken — daardoor kan hij niet uit
de pas lopen.

- **Gelijke start.** De host verzint de seed en stuurt die mee; beide kanten doen
  `createMatch({ seed, humans: [true, true] })`.
- **Pakketverlies repareert zichzelf.** Elk bericht bevat de laatste acht ticks
  aan inputs, dus er hoeft nooit iets opnieuw gevraagd te worden.
- **De delay past zich aan.** Bij veel wachtbeurten gaat hij omhoog (tot 12 ticks),
  bij een rustige verbinding weer omlaag (tot 3). Dat mag per speler verschillen:
  elke input draagt zijn eigen ticknummer, dus de uitkomst blijft gelijk. De
  netwerktest laat dat ook zien — de twee kanten eindigen met een verschillende
  delay en toch dezelfde wedstrijdstand.
- **Desync-detectie.** Elke seconde gaat er een `hashState()` over en weer. Wijken
  ze af, dan stopt de wedstrijd met een duidelijke melding in plaats van dat de
  twee spelers stilletjes een andere wedstrijd zitten te spelen.
- **De server is dom.** Hij koppelt twee spelers aan een code en geeft berichten
  door. Hij kent de spelregels niet en houdt geen stand bij.

Let bij het uitbreiden op deze regels, anders sneuvelt het determinisme:

- geen `Math.random()` in `src/game/**` (gebruik `randRange(state, ...)`);
- geen `Date.now()` of `performance.now()` in de simulatie;
- geen iteratie over `Set`/`Object.keys()` waarvan de volgorde kan verschillen;
- rendering mag nooit in `state` schrijven.

## Tests

```bash
npm test           # alle drie
npm run test:sim   # speelt hele wedstrijden headless, controleert determinisme
npm run test:net   # start de relay, koppelt twee echte clients, speelt 100s
                   # en controleert of beide kanten dezelfde stand berekenen
npm run test:ui    # draait main.js tegen een namaak-DOM: menu, lokale wedstrijd,
                   # online wedstrijd openen, tegenstander laten binnenkomen,
                   # spelen, en het afvangen van een weggevallen tegenstander
```

Bij het uitzoeken van netwerkgedrag: `__game.transport` in de browserconsole
geeft `ping`, `delay`, `stalls` en `desync`.

## Wat er nog niet is

- Geen overtredingen, vrije trappen, strafschoppen of buitenspel.
- Eén formatie (4-3-3) en twee teams; nog geen teamkeuze of competitie.
- Keeper is simpel: hij loopt naar de bal en trapt uit, hij duikt niet.
- Geen geluid.
- Online: geen revanche-knop (terug naar het menu en opnieuw), geen herverbinden
  na een wegval, en berichten gaan als JSON over de lijn. Rond de 4 kB/s per
  speler — prima, maar binair zou een stuk zuiniger zijn.
- Alles loopt via de relay-server. Voor lagere latency zou WebRTC (peer-to-peer)
  beter zijn; de relay blijft dan nodig om de twee spelers te koppelen.

Zin om er iets van op te pakken? [CONTRIBUTING.md](CONTRIBUTING.md) beschrijft
per onderwerp waar je moet beginnen.

## Licentie

[MIT](LICENSE).

Dit is een zelfgeschreven eerbetoon aan de topdown-voetbalspellen van de jaren
negentig. Het project staat op zichzelf: geen code, beeldmateriaal of andere
onderdelen van een bestaand spel, en geen enkele band met de makers of
rechthebbenden daarvan.
