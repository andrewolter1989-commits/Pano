# Pano Preisrechner

Änderungen in dieser Version:
- Eingabe `Stellplätze`
- daneben automatisch berechnetes Feld `Paletten`
- Tarifprüfung läuft über `Stellplätze`
- Nebenkosten/Palettentausch laufen über `Paletten`
- Floaterwerte wie `5` werden als `5 %` interpretiert, nicht als Faktor `5`

## Wichtiger Hinweis zur Paletten-Automatik
Aktuell ist die automatische Umrechnung bewusst auf eine neutrale Standardregel gesetzt:

`Paletten = aufgerundete Stellplätze`

Die exakte Formel aus deiner Offertenlogik war aus dem Screenshot allein nicht sicher ableitbar.
Die Umrechnung sitzt zentral in `app.js` in der Funktion:

`calculatePalletsFromSlots(slots)`

Sobald du mir die genaue Regel nennst, kann das dort direkt 1:1 eingebaut werden.
