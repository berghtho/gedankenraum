# Gedankenraum

Ein lokaler Ort für Links und kurze Notizen. Gedankenraum liest Links, verdichtet Inhalte lokal,
ordnet sie nach Themen und speichert alles als einfache JSON-Datei.

## Starten und beenden

Unter Windows genügt ein Doppelklick auf `Gedankenraum.cmd`. Die Anwendung startet und öffnet sich
automatisch im Browser. Mit `BEENDEN` oben rechts wird der lokale Server wieder geschlossen.

Alternativ:

```powershell
npm start
```

## Daten

Standardmäßig liegen alle Gedanken hier:

```text
%LOCALAPPDATA%\Gedankenraum\ideas.json
```

Mit `GEDANKENRAUM_HOME` kann ein anderer Ordner gewählt werden. Gedankenraum speichert keine Daten
in einer Cloud. Beim Erfassen eines Links wird dessen öffentlich erreichbare Seite abgerufen; die
anschließende Verdichtung findet lokal statt.

### Bestehende OpBoard-Gedanken übernehmen

Gedankenraum verwendet dasselbe Dateiformat wie das frühere IdeaBoard. Gedankenraum zuerst über
`BEENDEN` schließen und dann die bisherige `ideas.json` nach
`%LOCALAPPDATA%\Gedankenraum\ideas.json` kopieren. Beim nächsten Start ist die Sammlung vorhanden.

Die alte Datei findet sich normalerweise in einem Unterordner von:

```text
%LOCALAPPDATA%\OpBoard\repositories
```

## Entwicklung

Voraussetzung ist Node.js 22.5 oder neuer. Die Anwendung selbst hat keine Paketabhängigkeiten.

```powershell
npm test
```
