# Ricky's poker app

Een eenvoudige scrum-poker app in een rustige cozy casino stijl.

## Wat zit erin

- Naam invullen zonder login.
- Gedeelde tafels via `?room=...`.
- Scrum-pokerkaarten `0`, `0.5`, `1`, `2`, `3`, `5`, `8`, `13`, `20`, `40`, plus `?` en koffie.
- Eerste actieve speler is leider en krijgt een kroon.
- Leider kan kaarten omdraaien, punten wissen, iemand leider maken en spelers kicken.
- Mediaan en modus verschijnen pas na het omdraaien.

## Development

```bash
npm install
npm run dev
npm run build
```

## Cloudflare Pages via GitHub

De app gebruikt een D1 binding met de naam `DB` voor minimale room-state, niet
voor accounts of gebruikersprofielen.

1. Maak een GitHub repository aan en upload deze bestanden naar de root van de repo.
2. Maak in Cloudflare een D1 database aan, bijvoorbeeld `rickys-poker-app-db`.
3. Maak in Cloudflare Pages een project vanuit GitHub.
4. Gebruik deze build settings:
   - Framework preset: `None` / custom
   - Build command: `npm run build:pages`
   - Build output directory: `dist-pages`
   - Node version: `22.13.0`
5. Voeg bij Pages > Settings > Functions > D1 database bindings een binding toe:
   - Variable name: `DB`
   - D1 database: de database uit stap 2
6. Zet bij Pages compatibility flags `nodejs_compat` aan.
7. Deploy de `main` branch.

De API maakt de tabellen zelf aan bij de eerste request. Wil je liever vooraf
migreren, gebruik dan de SQL-bestanden in `drizzle/`.

## Belangrijke scripts

```bash
npm run dev          # lokale ontwikkeling
npm run build        # Cloudflare Worker-compatible build
npm run build:pages  # GitHub/Cloudflare Pages build naar dist-pages
npm run db:generate  # Drizzle migraties genereren
```

`dist/`, `dist-pages/`, `node_modules/`, `work/` en `outputs/` horen niet in GitHub.
