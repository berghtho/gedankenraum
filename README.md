# Gedankenraum - Wohin mit dem guten Zeug?

Ein lokaler Ort für Links und kurze Notizen. Gedankenraum liest Links, lässt sie durch Codex
verdichten, ordnet sie nach Themen und speichert alles als einfache JSON-Datei.

<img width="1210" height="709" alt="gedankenraum" src="https://github.com/user-attachments/assets/abe6b602-abd3-4559-b20e-fad154527cee" />

## Starten und beenden

Unter Windows genügt ein Doppelklick auf `Gedankenraum.cmd`. Die Anwendung startet und öffnet sich
automatisch im Browser. Mit `BEENDEN` oben rechts wird der lokale Server wieder geschlossen.

Alternativ:

```powershell
npm start
```

## Textnotizen aufbewahren

Mit `TEXT AUFBEWAHREN` in der Erfassungsleiste wird die Eingabe wortgetreu gespeichert, inklusive
Zeilenumbrüchen und bis zu 60.000 Zeichen. Das eignet sich für Texte, die später wieder nachgelesen
werden sollen, etwa gute Erklärungen aus einer Agenten-Sitzung. Titel, Thema und Zusammenfassung werden
trotzdem erzeugt, damit sich die Notiz einordnen und finden lässt. In der Detailansicht erscheint der
vollständige Wortlaut mit `KOPIEREN`; die Suche durchsucht auch den Wortlaut. Links werden in diesem
Modus nicht gelesen, sondern als Text übernommen.

## Daten

Standardmäßig liegen alle Gedanken hier:

```text
%LOCALAPPDATA%\Gedankenraum\ideas.json
```

Über `SPEICHER` oben rechts kann ein anderer lokaler Ordner gewählt werden, etwa ein synchronisierter
OneDrive-Ordner. Ist dort bereits eine `ideas.json` vorhanden, fragt Gedankenraum, ob beide Sammlungen
zusammengeführt oder die Zieldatei ersetzt werden soll. Ist noch keine vorhanden, wird die aktuelle
Sammlung dorthin übernommen. Die Auswahl gilt auch nach einem Neustart.

Über `IMPORT` kann eine bestehende `ideas.json` ausgewählt werden. Ihre Gedanken werden mit der
aktuellen Sammlung zusammengeführt; bereits vorhandene IDs werden übersprungen.

Alternativ kann mit `GEDANKENRAUM_HOME` ein anderer Ordner fest vorgegeben werden. In diesem Fall ist
die Auswahl in der UI deaktiviert. Gedankenraum speichert selbst keine
Daten in einer Cloud. Beim Erfassen werden Notiz oder gelesener Linkinhalt sowie die Namen bereits
vorhandener Themen für die Analyse an Codex übertragen. Verwendet werden `gpt-5.6-luna` und
Reasoning Effort `xhigh`. Dafür muss die Codex-CLI installiert und über `codex login` angemeldet
sein. Ist Codex nicht verfügbar, wird sichtbar auf die einfache lokale Analyse zurückgefallen.

### Bestehende OpBoard-Gedanken übernehmen

Gedankenraum verwendet dasselbe Dateiformat wie das frühere IdeaBoard bzw. OpBoard. Die bisherige
`ideas.json` kann direkt über `IMPORT` übernommen werden.

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
