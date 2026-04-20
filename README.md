# Pano Preisrechner

Frontend-only Preisrechner für Palettensendungen.

## Dateien
- `index.html`
- `style.css`
- `app.js`
- `rates.csv`
- `zones.csv`
- `floater.json`
- `ancillary.json`

## Logik
- Zone über `zones.csv`
- Tarif über `rates.csv`
- `PLL` = Preis pro Palette × eingegebene Paletten
- `SHP` = fixer Sendungspreis
- Floater in `%` auf Basispreis
- Palettentausch/Nebenkosten zusätzlich aus `ancillary.json`

## Transportarten
- `Teilladung` = Standard
- `FTL` = setzt automatisch 34 Paletten

## Nebenkosten-Datei
`ancillary.json` Beispiel:

```json
{
  "Voigt": { "enabled": true, "mode": "per_psp", "value": 0 },
  "Mordhorst": { "enabled": true, "mode": "fixed", "value": 25 }
}
```

## Hinweis
Beim lokalen Doppelklick kann der Browser `fetch()` blockieren. Dann das Projekt über einen kleinen lokalen Webserver oder direkt auf Webspace testen.
