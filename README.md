# Gedankenraum

Ein lokaler Ort für Links und kurze Notizen. Gedankenraum liest Links, lässt sie durch Codex
verdichten, ordnet sie nach Themen und speichert alles als einfache JSON-Datei.

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

Mit `GEDANKENRAUM_HOME` kann ein anderer Ordner gewählt werden. Gedankenraum speichert selbst keine
Daten in einer Cloud. Beim Erfassen werden Notiz oder gelesener Linkinhalt sowie die Namen bereits
vorhandener Themen für die Analyse an Codex übertragen. Verwendet werden `gpt-5.6-luna` und
Reasoning Effort `xhigh`. Dafür muss die Codex-CLI installiert und über `codex login` angemeldet
sein. Ist Codex nicht verfügbar, wird sichtbar auf die einfache lokale Analyse zurückgefallen.

### Bestehende OpBoard-Gedanken übernehmen

Gedankenraum verwendet dasselbe Dateiformat wie das frühere IdeaBoard. Gedankenraum zuerst über
`BEENDEN` schließen und dann die bisherige `ideas.json` nach
`%LOCALAPPDATA%\Gedankenraum\ideas.json` kopieren. Beim nächsten Start ist die Sammlung vorhanden.

Die alte Datei findet sich normalerweise in einem Unterordner von:

```text
%LOCALAPPDATA%\OpBoard\repositories
```

## Entwicklung

Voraussetzung ist Node.js 22.5 oder neuer. Für KI-Zusammenfassungen wird zusätzlich eine angemeldete
Codex-CLI benötigt. Die Anwendung selbst hat keine Paketabhängigkeiten.

```powershell
npm test
```
