# Gedankenraum - Wohin mit dem guten Zeug?

Ein lokaler Ort für Links und kurze Notizen. Gedankenraum liest Links, lässt sie durch Codex
verdichten, ordnet sie nach Themen und speichert alles als einfache JSON-Datei.

## Gedanken weiterentwickeln

Die Grundansicht lässt die Gedanken im Vordergrund: oben Titel, Suche, Ansicht und Menü, in der Mitte
kompakte Karten, unten die Eingabe. Beim Start steht der Cursor bereits in der Eingabe. `Sammlung` öffnet
Räume, Tags und Themen. Jede dieser Gruppen lässt sich über ihre Überschrift ein- und ausklappen; das bleibt
im Browser gespeichert. Die Ansichtsauswahl wechselt zwischen Gedanken, Mindmap und Zeitachse.
`Links als Text aufbewahren` liegt im Menü.

Ein Klick auf eine Karte öffnet den Gedanken zum Lesen: zuerst der eigene Wortlaut, darunter Ergänzungen
und Kernpunkte. Thema, Tags, Analyse, Verbindungen, das vollständige Bearbeiten und der Papierkorb liegen
unter `Mehr`. `Weiterschreiben`, Doppelklick oder F2 öffnet einen Editor direkt in der Karte. Speichern mit
Strg+Enter, Verwerfen mit Escape. Escape schließt den geöffneten Gedanken; ein zweites Escape hebt die
Auswahl auf.

Die Suche durchsucht immer die ganze Sammlung: Titel, Wortlaut, Zusammenfassung, Ergänzungen, Tags und
Schlagwörter. Jeder Begriff muss vorkommen, die Reihenfolge ist egal; „huette“, „hutte“ und „Hütte“ finden
dasselbe. Karten zeigen die Stelle, an der es passt, und markieren den Treffer; Titeltreffer stehen vor
Tag- und Texttreffern. `/` springt in die Suche, Enter öffnet den ersten Treffer, ↓ wechselt in die Liste,
`n` springt in die Eingabe. `#tag` (der Anfang genügt) und `thema:Name` suchen gezielt nach Tag und Thema.

Mehrere Gedanken lassen sich per Shift-Klick, Shift+Enter oder über `⋯ → Gedanken auswählen` markieren.
Erst dann erscheinen Checkboxen und `Zusammen denken`. Die Auswertung öffnet eine Seitenansicht;
die Eingabe bleibt bedienbar.

- **Sofort ablegen:** Erst wird der Gedanke gespeichert, dann laufen Linklesen und Analyse im Hintergrund. Du kannst sofort den nächsten Gedanken eingeben. Auch nicht erreichbare Links bleiben gespeichert und lassen sich erneut analysieren. Nach einem Neustart geht ausstehende Analyse weiter.
- **Bearbeiten:** Titel, Text, Zusammenfassung und eigene Ergänzungen ändern. Selbst bearbeitete Titel, Zusammenfassungen und Themen werden von späteren Analysen nicht überschrieben. Änderungen am Ausgangstext stoßen eine neue Analyse an. Bei Links bleibt die URL als Quelle erhalten; eigene Texte gehören in die Ergänzungen.
- **Rückgängig und Papierkorb:** `⋯ → Rückgängig` oder Strg+Z außerhalb eines Textfelds nimmt die letzte Änderung zurück, bis zu 50 Schritte pro Server-Sitzung. Gelöschte Gedanken bleiben über das Menü im Papierkorb wiederherstellbar, auch nach einem Neustart. Untergedanken werden nicht mitgelöscht. Ein Speicherwechsel leert die Rückgängig-Historie.
- **Verbindungen:** Im Detail Gedanken mit „baut auf“, „widerspricht“ oder „Beispiel für“ verbinden. Verbindungen erscheinen an beiden Gedanken; die Pfeilrichtung zeigt, welcher Gedanke sich auf welchen bezieht. In der Mindmap werden die Verbindungen des ausgewählten Gedankens gestrichelt gezeigt.
- **Mindmap:** Ein Knoten kann eigene Untergedanken haben. Auf einem fokussierten Knoten erzeugt Tab einen Untergedanken, Enter einen Nachbarn, F2 öffnet den Editor. Pfeiltasten wechseln den Fokus; Shift+Tab verlässt den Knoten rückwärts. Alle Erstellaktionen gibt es auch als Schaltflächen. Zweige per Ziehen auf einen anderen Knoten oder über `Mehr → Verschieben` umhängen, ein-/ausklappen und zoomen. Freie Fläche ziehen zum Schwenken. Beim Filtern erscheinen Gedanken mit ausgeblendeten Eltern eigenständig. Zoom und eingeklappte Zweige gelten für den geöffneten Tab.

- **Arbeitsräume:** Eine eigene Frage hält zusammengehörige Gedanken zusammen. Gedanken auf einen Raum in der Seitenleiste ziehen, über `Sammlung → Gedanken zuordnen` auswählen oder mehrere markierte Gedanken mit `In Raum …` zuordnen. Ein Gedanke kann in mehreren Räumen liegen. Neue Gedanken landen im aktiven Raum. Der aktive Raum steht oben als Titel und lässt sich dort mit `×` verlassen; gewechselt wird über `Sammlung → Arbeitsräume`. Der Raum ordnet, die Suche findet: Getipptes durchsucht die ganze Sammlung, Treffer außerhalb des Raums sind mit „nicht im Raum“ markiert und stehen hinter den Raumtreffern. Entfernen ändert nur die Zuordnung; Räume lassen sich archivieren und wiederherstellen.
- **KI-Auswertungen:** 2 bis 12 Gedanken per Checkbox markieren und Gemeinsamkeiten, Widersprüche oder offene Fragen auswerten lassen. Die Arbeitsfrage und die verwendeten Textstände bleiben am Ergebnis gespeichert und anklickbar. Die Auswertung läuft im Hintergrund und setzt nach einem Neustart fort. Vorschläge verändern keine Originale. `ALS GEDANKEN ÜBERNEHMEN` speichert einen Vorschlag einmalig mit Quellenverbindungen im zugehörigen Raum.

Die vorhandene Sammlung bleibt im Format `version: 1`. Hierarchie, Verbindungen, eigene Ergänzungen, Papierkorb, Räume und Auswertungen werden in derselben `ideas.json` gespeichert und beim Import mit übernommen. Alte Dateien ohne Räume oder Auswertungen bleiben kompatibel.

<img width="1210" height="709" alt="gedankenraum" src="https://github.com/user-attachments/assets/abe6b602-abd3-4559-b20e-fad154527cee" />

## Starten und beenden

Unter Windows genügt ein Doppelklick auf `Gedankenraum.cmd`. Die Anwendung startet und öffnet sich
automatisch im Browser. Mit `BEENDEN` oben rechts wird der lokale Server wieder geschlossen.

Alternativ:

```powershell
npm start
```

## Textnotizen aufbewahren

Texteingaben werden automatisch wortgetreu gespeichert, inklusive
Zeilenumbrüchen und bis zu 60.000 Zeichen. Das eignet sich für Texte, die später wieder nachgelesen
werden sollen, etwa gute Erklärungen aus einer Agenten-Sitzung. Titel, Thema und Zusammenfassung werden
trotzdem erzeugt, damit sich die Notiz einordnen und finden lässt. In der Detailansicht erscheint der
vollständige Wortlaut mit `KOPIEREN`; die Suche durchsucht auch den Wortlaut. Links werden in diesem
Fall über `⋯ → Links als Text aufbewahren` nicht gelesen, sondern als Text übernommen.

## Daten

Standardmäßig liegen alle Gedanken hier:

```text
%LOCALAPPDATA%\Gedankenraum\ideas.json
```

Über `⋯ → SPEICHERORT` kann ein anderer lokaler Ordner gewählt werden, etwa ein synchronisierter
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
sein. Ist Codex nicht verfügbar, wird beim Erfassen sichtbar auf die einfache lokale Analyse zurückgefallen.

Für eine KI-Auswertung werden die ausgewählten Gedanken samt Arbeitsfrage an Codex übertragen.
Pro Gedanke umfasst der Auszug höchstens 4.000 Zeichen Ausgangstext, 2.000 Zeichen eigene Ergänzungen,
1.200 Zeichen Zusammenfassung, 160 Zeichen Titel und vier Kernpunkte mit je 240 Zeichen.
Kürzungen werden angezeigt. Unfertige Auswertungen aus importierten oder zusammengeführten Dateien
warten auf `ERNEUT VERSUCHEN`; der Import allein startet sie nicht. Bei Links nutzt die Auswertung den gespeicherten Inhalt und liest die
Originalseite nicht erneut. Ergebnisse enthalten bis zu sechs Vorschläge mit geprüften Quellenverweisen.
Bei Ausfall der KI erscheint ein Fehler mit Wiederholen-Schaltfläche; dafür gibt es keine lokale Ersatz-Auswertung.

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
