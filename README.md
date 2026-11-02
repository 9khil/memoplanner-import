# MEMOplanner Import

En liten webapp for å lime inn ukeplan-JSON fra ChatGPT og opprette aktiviteter i myAbilia.

**Teknologi:** vanlig HTML, CSS, TypeScript, esbuild (kun bygging) og to Netlify Functions i TypeScript. Ingen React, database eller Node-RED.

## Oppsett

1. Legg prosjektet i et GitHub-repository (offentlig er mulig når ingen hemmeligheter er commitet) og koble det til Netlify.
2. Netlify bruker `npm run build`, publiserer `dist` og oppdager Functions i `netlify/functions` fra `netlify.toml`.
3. I Netlify: **Project configuration → Environment variables**. Opprett verdiene fra `.env.example` med **Functions**-tilgang. Bruk to forskjellige sterke hemmeligheter for `APP_PASSWORD` (minst 16 tegn) og `SESSION_SECRET` (minst 32 tegn). Aldri legg dem i Git.
4. `MYABILIA_ENTITY_ID` og `MYABILIA_CALENDAR_ID` er identifikatorene fra nettverkskallet i nettleseren. `MYABILIA_AUTH_TOKEN` må hentes fra din egen aktive myAbilia-sesjon. Bekreft cookie-navnet i DevTools; eksempelet bruker `X-Auth-Token`.
5. Deploy (eller redeploy etter miljøvariabelendringer). Åpne nettsiden og logg inn med `APP_PASSWORD`.
6. Lim inn JSON fra ChatGPT. Klikk **Kontroller og forhåndsvis**, kontroller aktivitetene, kryss av og trykk **Importer aktivitetene**.

## ChatGPT-instruks

> Les bildet av skoleukeplanen. Returner kun gyldig JSON med `week` (ISO uke) og `activities`: en liste av objekter med `date` (YYYY-MM-DD), `start` og `end` (HH:mm, Europe/Oslo), `title` og `description`. Ikke gjett uklare datoer eller tider; spør meg først. Ingen markdown-kodegjerder. Ta bare med aktiviteter som faktisk skal inn i kalenderen.

Eksempel:

```json
{
  "week": "2026-W45",
  "activities": [
    { "date": "2026-11-03", "start": "15:30", "end": "16:00", "title": "Testaktivitet", "description": "" }
  ]
}
```

## Lokal utvikling

```bash
npm install
npm run build
npm run typecheck
npm run dev
```

Netlify CLI kan simulere Functions lokalt, men HTTPS-only cookie krever HTTPS for en reell innlogget test. Test helst på en Netlify test-deploy med HTTPS.

## Viktige begrensninger

- myAbilia-API-et er **udokumentert**. PUT-URL og payload er basert på én observert nettleserforespørsel, og server-til-server-kall er **ikke bekreftet å fungere**. Test én aktivitet først.
- Cookie-tokenet kan utløpe. Da må det fornyes manuelt. Ikke del token i ChatGPT, GitHub eller klientkode.
- Appen henter eksisterende aktiviteter via GET med `fromDate` og `toDate`, sammenligner tittel/dato/tid og hopper over treff. Den tar hensyn til enkle daglige/ukentlige gjentakelser og `deleted: true`. Usikre konflikter hoppes over. Dette er ikke en transaksjonell garanti mot duplikater ved samtidige importer.
- Ved timeout er det uklart om myAbilia opprettet aktiviteten. Sjekk kalenderen før nytt forsøk.
- En enkel delt passordløsning uten rate-limiting. Bruk et langt tilfeldig passord, del ikke URL-en, og vurder Netlify Identity eller ekstern adgangskontroll for mer robust sikkerhet.
- API-forespørsler går fra Netlify Functions til myAbilia; undersøk databehandler-/personvernhensyn før bruk med barns informasjon.
- Aktivitetene må starte og slutte på **samme dag**. Maks 40 aktiviteter per import.
- Alarmer er kopiert fra testpayloaden: ved start og slutt. Juster dette i `netlify/functions/import.mts` ved behov.

## Duplikatkontroll

Forhåndsvisning og import gjør begge GET mot myAbilia. Samme tittel, dato og tid blir hoppet over. Samme tittel på annen tid, eller annen tittel på nøyaktig samme tid, markeres som konflikt og hoppes over. Eksisterende aktiviteter slettes eller endres aldri. Ved feil i GET stoppes hele importen. Gjentakelser med avanserte regler eller unntak kan kreve manuell kontroll.

## Standardinnstillinger fra v3

- Importerte aktiviteter har **aldri alarmer** (`alarms: []`).
- `alignment` veksler `LEFT`, `RIGHT` i kronologisk rekkefølge for hele JSON-uken (også aktiviteter som allerede finnes). Dette gjør resultatet stabilt ved ny import av samme ukeplan.
- `config/image-mapping.json` kobler normaliserte aktivitetsnavn til en eksisterende myAbilia `image.uri`. Eksempel: `"svømming": {"uri":"https://myabilia.com/api/v1/data/.../storage/file/id/..."}`.
- Mappen `images/` kan brukes til å organisere kildebildene, men **filer i mappen lastes ikke automatisk opp**. Vi mangler fortsatt myAbilias bildeopplastingsendepunkt. Opprett en aktivitet med bildet manuelt i myAbilia, hent `image.uri` fra GET-svaret og legg det i mappingen. Tom URI betyr ingen bilde.
- Ikke legg private bilder i et offentlig Git-repo.

Den eldre teksten over om alarmer fra testpayloaden er erstattet av v3-regelen: ingen alarmer.
