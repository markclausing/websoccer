# Bijdragen aan WebSoccer

Leuk dat je meedoet. Dit document beschrijft hoe het project in elkaar zit, welke
regels er zijn, en hoe je een wijziging ingediend krijgt.

Nieuw hier? Begin bij [INSTALL.md](INSTALL.md) om het draaiend te krijgen, en
speel eerst een paar wedstrijden — de meeste vragen over de code beantwoorden
zichzelf zodra je het spel gevoeld hebt.

## De vorm van het project

Twee dingen bepalen bijna elke beslissing in deze codebase:

**1. Geen dependencies, geen buildstap.** Je klont het project en `npm start`
werkt. Geen bundler, geen transpiler, geen `node_modules`. De browser laadt de
ES-modules rechtstreeks. Dat betekent ook dat er geen framework in komt; als iets
alleen met een library kan, is het waarschijnlijk het overwegen waard of we het
wel willen.

**2. De simulatie is deterministisch.** Dat is geen nettigheid maar de spil van
de online multiplayer. Zie hieronder.

## De belangrijkste regel: determinisme

Online multiplayer werkt met **lockstep**: beide machines draaien dezelfde
simulatie en sturen elkaar alleen hun knoppen door. Als dezelfde begintoestand
plus dezelfde inputs op twee machines een verschillende uitkomst geven, gaan de
spelers stilletjes een andere wedstrijd spelen. Alles in `src/game/**` moet dus
puur zijn.

In `src/game/**` mag niet:

- `Math.random()` — gebruik `randRange(state, lo, hi)` of `nextRandom(state)` uit
  `src/util.js`, die trekken uit `state.rng`;
- `Date.now()` of `performance.now()`;
- iteratie waarvan de volgorde niet vastligt (`Set`, `Object.keys()` over
  dynamische sleutels);
- iets uit de DOM of het netwerk lezen.

En verder:

- **Rendering leest alleen.** `src/render/**` mag nooit in `state` schrijven.
  Camera-smoothing en schermschudden staan daarom bewust buiten de simulatie —
  cosmetica mag per machine verschillen, de wedstrijd niet.
- **Nieuwe willekeur hoort in de simulatie**, niet in de aanroeper.
- **De AI hoort ín de simulatie.** Zou de CPU buiten `step()` beslissen, dan
  nemen twee machines verschillende beslissingen.
- **Eén tick verloopt in drie fases**: eerst bepalen alle 22 spelers hun intentie
  op dezelfde snapshot, dan worden trappen uitgevoerd, dan wordt er bewogen. Zet
  je een beslissing per ongeluk vóór de intentiefase, dan reageert het ene team
  op verse posities en het andere op verouderde. Dat is niet theoretisch: het gaf
  team 1 meetbaar meer doelpunten (114 om 66 over 60 CPU-wedstrijden).

`npm run test:sim` en `npm run test:net` vangen overtredingen hiervan, maar niet
altijd meteen — determinismebugs kunnen zeldzaam zijn. Denk er dus even bij na.

## Waar staat wat

```
src/constants.js      afmetingen, snelheden, spelregelconstanten - begin hier
                      als je aan het spelgevoel wilt sleutelen
src/util.js           wiskunde + deterministische PRNG
src/input.js          toetsenbord/gamepad -> bitmask van 5 bits
src/main.js           menu, vaste-tijdstap game-loop
src/game/state.js     wedstrijdtoestand, formaties, aftrap, clone + hash
src/game/sim.js       step(): de enige plek waar de wedstrijd verandert
src/game/ai.js        CPU-logica
src/game/kick.js      gedeelde trapfunctie voor mens en CPU
src/render/pitch.js   het veld (één keer getekend naar een offscreen canvas)
src/render/renderer.js camera, spelers, bal, HUD, radar, netwerkstatus
src/net/signal.js     WebSocket-client: kamers en berichtroutering
src/net/transport.js  LocalTransport en OnlineTransport (lockstep)
server/relay.js       statische bestanden + kamers + inputs doorgeven
server/ws.js          WebSocket-protocol met de hand
tools/                de tests
```

De game-loop praat met een transport via vier methodes: `sample(tick)`,
`ready(tick)`, `poll(tick)` en `afterStep(state)`. Lokaal en online implementeren
allebei diezelfde vier. Wil je een nieuwe manier van spelen toevoegen (denk aan
replays of een AI-tegen-AI-modus), dan is een nieuw transport meestal het
antwoord — niet een aanpassing in `sim.js`.

## Tests

```bash
npm test           # alle drie
npm run test:sim   # speelt hele wedstrijden headless; controleert determinisme
npm run test:net   # start de relay, koppelt twee echte clients, speelt 100s en
                   # controleert of beide kanten dezelfde stand berekenen
npm run test:ui    # draait main.js tegen een namaak-DOM: menu, lokale wedstrijd,
                   # online wedstrijd, en een weggevallen tegenstander
```

Welke draai je wanneer:

| Je raakt aan...                    | Draai minimaal    |
| ---------------------------------- | ----------------- |
| `src/game/**`, `src/constants.js`  | `test:sim` + `test:net` |
| `src/net/**`, `server/**`          | `test:net` + `test:ui`  |
| `src/main.js`, `src/render/**`     | `test:ui`               |
| iets anders                        | `npm test`              |

Verander je het spelgevoel (snelheden, trapkracht, AI), draai dan `test:sim` en
kijk of het aantal doelpunten per wedstrijd redelijk blijft — rond de 2 à 3 per
wedstrijd van 2×2 minuten. Een balans die volledig instort is meestal een teken
dat er iets stuk is en niet alleen dat het "anders speelt".

## Codestijl

Er staat bewust geen linter in de weg; houd het simpel en consistent met wat er
al staat:

- ES-modules, 2 spaties inspringen, puntkomma's, enkele aanhalingstekens.
- Namen van variabelen en functies in het Engels, **commentaar en gebruikersteksten
  in het Nederlands** — dat is nu consistent zo.
- Commentaar legt uit *waarom*, niet *wat*. De regel die uitlegt waarom een tick
  in drie fases uiteenvalt is nuttig; `// verhoog de teller` niet.
- Magische getallen die het spelgevoel bepalen horen in `src/constants.js`, met
  een naam.

## Een wijziging indienen

1. Fork het project en maak een branch: `git checkout -b korte-beschrijving`.
2. Maak je wijziging en draai de relevante tests (zie de tabel hierboven).
3. Commit met een korte beschrijvende regel in de gebiedende wijs: `voeg
   strafschoppen toe`, niet `strafschoppen toegevoegd`.
4. Open een pull request. Beschrijf **wat** je verandert en **waarom**, en bij
   een wijziging in het spelgevoel: hoe het speelt. Een korte opname of een paar
   regels uit `test:sim` zeggen meer dan een lange uitleg.

Weet je niet zeker of iets past? Open eerst een issue. Dat scheelt werk aan
allebei de kanten.

## Ideeën die openstaan

De README sluit af met een lijstje "Wat er nog niet is". De meest voor de hand
liggende brokken werk:

- **Overtredingen en vrije trappen.** Er is nu geen scheidsrechter; slidings
  mogen alles. Strafschoppen zouden ook wedstrijden kunnen beslissen.
- **De keeper.** Die loopt naar de bal en trapt uit, meer niet. Duiken, vangen en
  positiespel op de lijn zijn allemaal open.
- **Teams en formaties.** Er is één formatie (4-3-3) en er zijn twee teams. Een
  teamkeuze, andere formaties of een competitie: allemaal welkom.
- **Binair netwerkprotocol.** De inputs gaan nu als JSON over de lijn, ongeveer
  4 kB/s per speler. Dat kan een factor tien zuiniger.
- **WebRTC.** Alles loopt nu via de relay. Peer-to-peer zou de latency verlagen;
  de relay blijft dan nodig om spelers te koppelen.
- **Revanche en herverbinden.** Na een wedstrijd moet je nu terug naar het menu,
  en een weggevallen verbinding is definitief.
- **Geluid.** Er is helemaal niets.

## Licentie

Bijdragen vallen onder dezelfde [MIT-licentie](LICENSE) als de rest van het
project.
