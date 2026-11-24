# Standkasse für Home Assistant

Custom Integration für kleine Marktstände (z. B. Weihnachtsmarkt): eine schnelle **Rechenhilfe mit Becherpfand** für Tablets, dazu ein **Bon-Protokoll mit Auswertung** in Home Assistant, um verkaufte Mengen und Schwund zu erkennen.

> Keine Registrierkasse: Es wird nichts fiskalisiert, abgerechnet wird bar. Ob ihr eine Registrierkasse braucht, klärt bitte mit eurem Steuerberater.

## Funktionen

**Kassenseite für die Stände** (öffentlich unter `/kasse/`, ohne HA-Login)
- Große Kacheln für Produkte und Pfand-Rückgaben, lesbar aus ca. 1 m Entfernung (iPad, Android-Tablets, quer und hoch)
- Pfand wird verrechnet: „4 raus · 2 zurück = +2 × 3,00 €“, negative Summen werden als **Auszahlen** angezeigt
- Optionaler Rückgeld-Rechner pro Stand: Scheine nacheinander antippen (z. B. 20 + 5), zeigt „Fehlt noch“ bzw. „Rückgeld“
- „Nächster Kunde“ mit Rückgängig; Gerät direkt am Tablet benennen
- Bon und Produktliste bleiben bei Neuladen oder WLAN-Ausfall erhalten; Bons werden gepuffert und nachgeschickt
- Bildschirm bleibt an (Wake Lock)

**Panel »Standkasse«** (nur für angemeldete HA-Nutzer)
- **Stände** mit Betreiber, Produkt- und Pfandliste in einem Tabellen-Editor mit Prüfung beim Tippen (doppelte Namen, ungültige Preise, unplausible Beträge, Pfand ohne Rückgabe-Kachel) und Live-Vorschau der Kacheln
- Jeder Stand hat einen eigenen Link mit eigenem Schlüssel, der sich sperren oder neu erzeugen lässt
- **Auswertung getrennt pro Betreiber** (für Stände, die finanziell nicht zusammengehören): Kassa, Waren, Pfand netto, Tassen draußen, Stück je Produkt, Geräte, Umsatz pro Stunde; Markttag von 06:00 bis 06:00; CSV-Export
- **Bon-Liste** mit Positionen; Admins können Bons löschen (z. B. Testdaten)
- **Einstellungen**: Geräte zentral benennen, alle Bons löschen oder alles zurücksetzen

> Integration löschen und neu einrichten setzt die Daten **nicht** zurück – dafür gibt es die Knöpfe unter *Einstellungen*.

## Installation

1. Dieses Repository nach `config/custom_components/standkasse/` kopieren (oder per HACS als benutzerdefiniertes Repository hinzufügen).
2. Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Standkasse*.
4. Im Panel **Standkasse → Stände** die Stände anlegen und den jeweiligen Link mit „Kopieren“ an den Stand schicken.

## Am Tablet

- Link öffnen und zum Home-Bildschirm hinzufügen (Vollbild). Auf dem iPad empfiehlt sich zusätzlich der *Geführte Zugriff*.
- Über »Gerät benennen« unter dem Standnamen einen Namen vergeben (z. B. „iPad 2“) – oder zentral im Panel unter *Einstellungen → Geräte*.
- Die Tablets müssen Home Assistant im Netzwerk erreichen; kurze Aussetzer überbrückt der Offline-Puffer.

## Listenformat

Im Tabellen-Editor muss man sich darum nicht kümmern. Für den Textmodus (z. B. Einfügen aus Excel) gilt eine Zeile pro Produkt:

```
Glühwein,4.00,3.00
Punsch;3,50;3,00
Bier,4.00,0
```

Komma-getrennt mit Dezimalpunkt oder Strichpunkt-getrennt mit Dezimalkomma. Pfand-Rückgaben: `Name,Betrag`, z. B. `Tasse,3.00`.

Ohne Integration funktioniert die Kassenseite auch als reiner Rechner mit CSV-Dateien: `index.html?productlist=getraenke.csv&depositlist=deposit.csv&stand=Getränke`.

## Daten

- Stände: HA-Speicher (`.storage/standkasse.stands`)
- Bons: eigene SQLite-Datei `standkasse.db` im Konfigurationsordner, getrennt von der HA-Datenbank, in HA-Backups enthalten
- Jeder Bon speichert Stand, Betreiber und Preise zum Verkaufszeitpunkt; die Summen werden serverseitig neu berechnet

## API

| Methode | Pfad | Zugriff |
|---|---|---|
| GET | `/kasse/` | öffentlich |
| GET | `/api/standkasse/client?s=…&k=…` | Stand-Schlüssel |
| POST | `/api/standkasse/sales` | Stand-Schlüssel |
| GET | `/api/standkasse/report?start=…&end=…` | HA-Nutzer |
| GET / DELETE | `/api/standkasse/bons` | HA-Nutzer / Admin |
| GET / POST / DELETE | `/api/standkasse/stands` | HA-Nutzer / Admin |
| POST | `/api/standkasse/device` | Stand-Schlüssel |
| GET / POST | `/api/standkasse/devices` | HA-Nutzer / Admin |
| POST | `/api/standkasse/reset` | Admin |

## Lizenz

MIT
