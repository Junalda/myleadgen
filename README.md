# Website Prospector

Interne lead-generatie web-app voor het webbureau. Je vult een **stad** en
**branche** in; de app vindt bedrijven via Google Places, beoordeelt hun
website uitgebreid (eigen checks + Google PageSpeed Insights) en toont een
sorteerbare tabel met contactgegevens die je als CSV kunt downloaden.

De zwakste websites staan standaard bovenaan — dat zijn je beste leads.

## Kernprincipe (belangrijk)

Dit is een **interne tool voor één gebruiker, lokaal gedraaid**. De Google
API-keys komen **NOOIT** in de frontend. Alle externe API-calls (Google Places,
PageSpeed Insights) en het scrapen van websites gebeuren in Next.js **API
routes** (server-side). De frontend praat alleen met de eigen `/api/...`
endpoints.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS — donker navy thema met cyaan accenten
- Geen database; resultaten leven in de browser tijdens de sessie
- Streaming resultaten via Server-Sent Events (bedrijven verschijnen live)

## Installeren

```bash
npm install
```

## API-keys instellen

1. Kopieer het voorbeeldbestand:

   ```bash
   cp .env.example .env.local
   ```

2. Vul in `.env.local` je eigen keys in:

   ```
   GOOGLE_PLACES_KEY=...
   GOOGLE_PSI_KEY=...
   ```

> `.env.local` staat in `.gitignore` en wordt nooit gecommit.

### Google API's activeren (Google Cloud Console)

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com/) en
   maak (of kies) een project.
2. Open **APIs & Services → Library** en activeer:
   - **Places API** (voor het vinden van bedrijven)
   - **PageSpeed Insights API** (voor de Lighthouse-scores)
3. Ga naar **APIs & Services → Credentials → Create credentials → API key**.
   - Je kunt één key voor beide gebruiken, of twee aparte keys
     (`GOOGLE_PLACES_KEY` en `GOOGLE_PSI_KEY`).
   - Optioneel: beperk de key per API onder *API restrictions*.
4. Zorg dat **billing** aan staat op het project — Places werkt anders niet.

## Draaien

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Hoe het werkt (pipeline)

`POST /api/scan` voert de hele pipeline server-side uit en **streamt** de
resultaten terug:

1. **Bedrijven vinden** — Google Places *Text Search* op `"{branche} in {stad}"`
   met paginering via `next_page_token` tot het gewenste aantal. Daarna per
   bedrijf *Place Details* (naam, adres, telefoon, website, Google-URL, rating,
   aantal reviews). Taal = `nl`.
2. **Contact schrapen** — de website wordt server-side bezocht; `mailto`-links
   en e-mailadressen (regex) worden van de homepage gehaald. Geen mail? Dan
   wordt de contactpagina geprobeerd. Afbeeldings-/asset-"mails" worden
   gefilterd. Max 3 mails per bedrijf.
3. **Website beoordelen** — combinatie van:
   - **Eigen fetch:** HTTPS, geldig SSL, `<title>`, meta description,
     viewport-meta (mobiel-responsief), bereikbaarheid.
   - **PageSpeed Insights** (`strategy=mobile`): Lighthouse-scores voor
     performance, SEO, accessibility en best-practices.
   - **Totaalscore 0–100** = gemiddelde van de Lighthouse-scores. Faalt PSI,
     dan een fallback met puntenaftrek voor basis-zwaktes.
   - **Zwaktes** — leesbare lijst zoals `geen HTTPS`, `trage site`,
     `geen meta description`, `niet mobielvriendelijk`,
     `GEEN WEBSITE GEVONDEN`.

Bedrijven worden met **concurrency 3** verwerkt: snel genoeg, zonder de
PageSpeed-API te overbelasten. Een onbereikbare site of mislukte PSI-call laat
de scan niet crashen — dat bedrijf wordt gemarkeerd en de scan gaat door.

## De interface

- **Formulier**: Stad, Branche, Max bedrijven (default 20), optionele Max score
  (toon alleen sites met score ≤ X; leeg = alles).
- **Voortgang**: live teller ("12 / 20 beoordeeld") + balk terwijl de tabel zich
  vult.
- **Tabel**: standaard gesorteerd op totaalscore oplopend (zwakste bovenaan).
  Score is gekleurd (rood < 50, oranje 50–70, groen > 70). Elke kolomkop met een
  ↕-pijl is klikbaar sorteerbaar. Bedrijven zonder website tonen **GEEN
  WEBSITE** als sterkste lead.
- **Kolom "Mogelijk jong"**: een ruwe leeftijds-proxy op basis van het aantal
  Google-reviews (`< 10` → *mogelijk jong/nieuw*, `10–40` → *gevestigd-ish*,
  `> 40` → *waarschijnlijk gevestigd*). Sorteerbaar, zodat je mogelijk-jongere
  bedrijven bovenaan kunt zetten. **Dit is geen oprichtingsdatum** — alleen een
  hint om op te prioriteren; verifieer handmatig (KvK/LinkedIn).
- **Filter "alleen weinig reviews"**: een checkbox boven de tabel met een
  instelbaar getal (default 10) om snel waarschijnlijk-jongere bedrijven te
  isoleren. Dit filtert client-side de getoonde rijen (en dus ook de CSV-export).
- **Download CSV**: exporteert de huidige (gefilterde/gesorteerde) tabel met
  UTF-8 BOM, zodat Excel Nederlandse tekens goed toont.

> De B2B-richting stuur je zelf via je zoekterm (bv. *"facility schoonmaak
> zakelijk"* i.p.v. *"schoonmaak"*) — daar is geen aparte instelling voor.

## Belangrijke caveats

- **Google levert geen e-mailadressen.** Die worden van de site geschraapt en
  lukken bij ~50–70%.
- **"Lelijk design" wordt niet gemeten** — alleen meetbare technische signalen.
- **Leeftijds-/B2B-inschatting zijn ruwe proxies, geen feiten.** De
  "Mogelijk jong"-hint is afgeleid van het aantal reviews, niet van een
  oprichtingsdatum. Gebruik het om te prioriteren, niet om automatisch te
  selecteren.
- Bedoeld voor **gerichte, warme B2B-benadering**, niet voor massale koude mail
  (denk aan AVG/GDPR).

## Gemaakte aannames

- Het oorspronkelijke `website_prospector.py` was niet bijgevoegd; de logica is
  1-op-1 overgenomen uit de gedetailleerde beschrijving in de opdracht.
- Voor het parsen van HTML is bewust gekozen voor lichte regex i.p.v. een extra
  dependency (cheerio), passend bij de simpele e-mail/meta-extractie.
- `Max bedrijven` is begrensd op 60 (Google Places levert max ~60 resultaten via
  3 pagina's).
- De `Max score`-filter wordt server-side toegepast; bedrijven zonder website
  (score 0) passeren de filter altijd, omdat dat juist de sterkste leads zijn.
```
