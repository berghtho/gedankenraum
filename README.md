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

- **Sofort ablegen:** Erst wird der Gedanke gespeichert, dann laufen Linklesen und Analyse im Hintergrund. Du kannst sofort den nächsten Gedanken eingeben. Auch nicht erreichbare Links bleiben gespeichert und lassen sich erneut analysieren. Nach einem Neustart geht ausstehende Analyse weiter. Ist ein Link schon gespeichert, auch in anderer Schreibweise (www, Tracking-Parameter, YouTube-Kurzlink), öffnet Gedankenraum den vorhandenen Gedanken; im Raum landet er dort mit. Ein zweites Ablegen speichert ihn trotzdem neu.
- **Bearbeiten:** Titel, Text, Zusammenfassung und eigene Ergänzungen ändern. Selbst bearbeitete Titel, Zusammenfassungen und Themen werden von späteren Analysen nicht überschrieben. Änderungen am Ausgangstext stoßen eine neue Analyse an. Bei Links bleibt die URL als Quelle erhalten; eigene Texte gehören in die Ergänzungen.
- **Rückgängig und Papierkorb:** `⋯ → Rückgängig` oder Strg+Z außerhalb eines Textfelds nimmt die letzte Änderung zurück, bis zu 50 Schritte pro Server-Sitzung. Gelöschte Gedanken bleiben über das Menü im Papierkorb wiederherstellbar, auch nach einem Neustart. Untergedanken werden nicht mitgelöscht. Ein Speicherwechsel leert die Rückgängig-Historie.
- **Verbindungen:** Im Detail Gedanken mit „baut auf“, „widerspricht“ oder „Beispiel für“ verbinden. Verbindungen erscheinen an beiden Gedanken; die Pfeilrichtung zeigt, welcher Gedanke sich auf welchen bezieht. In der Mindmap werden die Verbindungen des ausgewählten Gedankens gestrichelt gezeigt.
- **Mindmap:** Ein Knoten kann eigene Untergedanken haben. Auf einem fokussierten Knoten erzeugt Tab einen Untergedanken, Enter einen Nachbarn, F2 öffnet den Editor. Pfeiltasten wechseln den Fokus; Shift+Tab verlässt den Knoten rückwärts. Alle Erstellaktionen gibt es auch als Schaltflächen. Zweige per Ziehen auf einen anderen Knoten oder über `Mehr → Verschieben` umhängen, ein-/ausklappen und zoomen. Freie Fläche ziehen zum Schwenken. Beim Filtern erscheinen Gedanken mit ausgeblendeten Eltern eigenständig. Zoom und eingeklappte Zweige gelten für den geöffneten Tab. Untergedanken stehen rechts neben ihrem Elternknoten. Übernommene Vorschläge und Recherche-Befunde stehen von selbst rechts neben dem Gedanken, auf dem sie aufbauen (bei mehreren Quellen neben der ersten), verbunden mit einer violetten Linie; gespeichert wird dafür nichts. Ein selbst gesetzter Elternknoten geht vor; wer die Verbindung „baut auf“ entfernt, löst den Vorschlag von seiner Quelle.

- **Arbeitsräume:** Eine eigene Frage hält zusammengehörige Gedanken zusammen. Gedanken auf einen Raum in der Seitenleiste ziehen, über `Sammlung → Gedanken zuordnen` auswählen oder mehrere markierte Gedanken mit `In Raum …` zuordnen. Ein Gedanke kann in mehreren Räumen liegen. Neue Gedanken landen im aktiven Raum. Der aktive Raum steht oben als Titel und lässt sich dort mit `×` verlassen; gewechselt wird über `Sammlung → Arbeitsräume`. Der Raum ordnet, die Suche findet: Getipptes durchsucht die ganze Sammlung, Treffer außerhalb des Raums sind mit „nicht im Raum“ markiert und stehen hinter den Raumtreffern. Entfernen ändert nur die Zuordnung; Räume lassen sich archivieren und wiederherstellen.
- **KI-Auswertungen:** 2 bis 12 Gedanken per Checkbox markieren und Gemeinsamkeiten, Widersprüche oder offene Fragen auswerten lassen. Die Arbeitsfrage und die verwendeten Textstände bleiben am Ergebnis gespeichert und anklickbar. Die Auswertung läuft im Hintergrund und setzt nach einem Neustart fort. Vorschläge verändern keine Originale. `ALS GEDANKEN ÜBERNEHMEN` speichert einen Vorschlag einmalig mit Quellenverbindungen im zugehörigen Raum. Übernommene Vorschläge sind violett hinterlegt und damit von ihren Quellen zu unterscheiden.
- **Recherche:** `RECHERCHIEREN` lässt Codex einen Gedanken im Web recherchieren. Bei Fragen steht der Knopf direkt im Gedanken, sonst unter `Mehr`. Das Ergebnis erscheint als Abschnitt „Recherche“ mit Kurzantwort, Befunden und Quellenlinks; der eigene Wortlaut bleibt unverändert. Die Recherche läuft im Hintergrund nach anstehenden Analysen, lässt sich wiederholen und setzt nach einem Neustart fort. Ein früheres Ergebnis bleibt sichtbar, bis das neue da ist. Änderungen am recherchierten Text während des Laufs erfordern eine neue Recherche. `ALS GEDANKEN ÜBERNEHMEN` speichert den angezeigten Befund einmalig als eigenen, violett hinterlegten Gedanken mit seinen Quellenlinks; er baut auf der Frage auf und liegt in ihren Räumen. Wurde das Ergebnis inzwischen ersetzt, muss der aktuelle Befund neu ausgewählt werden.
- **Fragen:** Eigene Gedanken, die mit „?“ enden, sind offene Fragen, bis sie als beantwortet markiert werden, von Hand oder direkt nach einer Recherche. `Sammlung → Fragen` filtert offene oder beantwortete Fragen, im Raum nur dessen Fragen. Der Status lässt sich rückgängig machen.
- **Raumübersicht:** `Übersicht` neben dem Raumtitel fasst einen Raum auf einer Seite zusammen: offene und beantwortete Fragen mit Antworten, Erkenntnisse aus übernommenen Vorschlägen und Auswertungen, übrige Gedanken und alle Quellen ohne Dopplungen. Die Seite lässt sich als Markdown kopieren oder speichern, oder als Folien-Gliederung mit `---` zwischen den Folien (etwa für Marp).
- **Tags:** Tag-Vorschläge der Analyse greifen bevorzugt auf bestehende Tags zurück, wenn sie dasselbe meinen. Groß-/Kleinschreibung, Umlaute und Trennzeichen werden automatisch angeglichen, etwa „Coding-Agents“ und „coding agents“. Mögliche Mehrzahlformen bleiben getrennt, weil etwa „Reis“ und „Reisen“ verschiedene Bedeutungen haben. `Sammlung → Tags aufräumen` zeigt ähnliche Schreibweisen zur Prüfung und lässt Codex auf Wunsch gleichbedeutende Tags vorschlagen. Jede Gruppe wird erst per Klick zusammengelegt, mit wählbarem Ziel-Tag, als ein rückgängig machbarer Schritt. Beim Zusammenlegen und Umbenennen ziehen Schlagwort-Vorschläge mit; Rückgängig stellt sie wieder her, sofern keine neuere Analyse sie ersetzt hat.
- **Alles neu analysieren:** `⋯ → Alle neu analysieren` analysiert nach einem Modellwechsel alle Gedanken noch einmal im Hintergrund, Links werden neu gelesen. Eigene Titel, Zusammenfassungen und Themen bleiben. Schlägt eine Analyse fehl oder ist Codex nicht erreichbar, bleibt die bisherige Analyse erhalten. Über denselben Menüpunkt lässt sich die Neu-Analyse abbrechen.

Die vorhandene Sammlung bleibt im Format `version: 1`. Hierarchie, Verbindungen, eigene Ergänzungen, Papierkorb, Räume und Auswertungen werden in derselben `ideas.json` gespeichert und beim Import mit übernommen. Alte Dateien ohne Räume oder Auswertungen bleiben kompatibel.

<img width="1210" height="709" alt="gedankenraum" src="https://github.com/user-attachments/assets/abe6b602-abd3-4559-b20e-fad154527cee" />

## Starten und beenden

Unter Windows genügt ein Doppelklick auf `Gedankenraum.cmd`. Die Anwendung startet und öffnet sich
automatisch im Browser. Mit `BEENDEN` oben rechts wird der lokale Server wieder geschlossen.

In T3 Code gibt es die Projektbefehle `Launch Gedankenraum` und `Stop Gedankenraum`
in der oberen Leiste. Die Befehle stehen in `t3.json`. Stop verwendet die laufende
Instanz, auch wenn sie auf einem anderen Port gestartet wurde; ohne laufende Instanz
ist der Befehl ohne Wirkung.

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

Liegt die `ideas.json` in einem Git-Repository und ist dort eingecheckt, erscheint im Menü `PUSH`, sobald
sie geändert wurde oder Commits noch nicht gepusht sind. Ein Klick committet nur die `ideas.json` und führt
`git push` aus; andere Dateien im Repository bleiben unberührt. Der Push nimmt aber alle noch nicht
gepushten Commits des Branches mit; wie viele davon nicht von Gedankenraum stammen, steht als „fremde“
Commits am Menüpunkt. Die Anmeldung übernimmt der in Git
eingerichtete Credential Helper. Hat das Remote-Repository neuere Änderungen, führt Gedankenraum nichts
zusammen: Der Commit bleibt lokal, und nach einem `git pull` im Repository lässt sich erneut pushen.

Beim Start holt Gedankenraum neue Commits aus dem Remote-Repository, bevor die Sammlung geladen wird, aber
nur per Fast-Forward. Gibt es hier und im Remote-Repository verschiedene neue Commits oder würde eine noch
nicht gepushte `ideas.json` überschrieben, bleibt alles unverändert und ein Hinweis erscheint. Ist das
Remote-Repository nicht erreichbar, startet Gedankenraum nach höchstens 15 Sekunden ohne Update.

Über `IMPORT` kann eine bestehende `ideas.json` ausgewählt werden. Ihre Gedanken werden mit der
aktuellen Sammlung zusammengeführt; bereits vorhandene IDs werden übersprungen.

Alternativ kann mit `GEDANKENRAUM_HOME` ein anderer Ordner fest vorgegeben werden. In diesem Fall ist
die Auswahl in der UI deaktiviert. Gedankenraum speichert selbst keine
Daten in einer Cloud. Beim Erfassen werden Notiz oder gelesener Linkinhalt sowie die Namen bereits
vorhandener Themen und Tags für die Analyse an Codex übertragen. Verwendet werden `gpt-6-sol` und
Reasoning Effort `xhigh`. Dafür muss die Codex-CLI installiert und über `codex login` angemeldet
sein. Ist Codex nicht verfügbar, wird beim Erfassen sichtbar auf die einfache lokale Analyse zurückgefallen.

Für eine KI-Auswertung werden die ausgewählten Gedanken samt Arbeitsfrage an Codex übertragen.
Pro Gedanke umfasst der Auszug höchstens 4.000 Zeichen Ausgangstext, 2.000 Zeichen eigene Ergänzungen,
1.200 Zeichen Zusammenfassung, 160 Zeichen Titel und vier Kernpunkte mit je 240 Zeichen.
Kürzungen werden angezeigt. Unfertige Auswertungen aus importierten oder zusammengeführten Dateien
warten auf `ERNEUT VERSUCHEN`; der Import allein startet sie nicht. Bei Links nutzt die Auswertung den gespeicherten Inhalt und liest die
Originalseite nicht erneut. Ergebnisse enthalten bis zu sechs Vorschläge mit geprüften Quellenverweisen.
Bei Ausfall der KI erscheint ein Fehler mit Wiederholen-Schaltfläche; dafür gibt es keine lokale Ersatz-Auswertung.

Für eine Recherche wird derselbe begrenzte Auszug des Gedankens an Codex übertragen. Codex sucht damit live
im Web; die Suchbegriffe formuliert das Modell aus dem Gedanken. Dafür ist der Code-Mode-Host von Codex
aktiv; Shell, Browser, Bilder und Memories bleiben ausgeschaltet. Damit hat Codex kein Werkzeug, um lokale
Dateien zu lesen oder zu ändern. Gespeichert werden nur http(s)-Quellen. Die Befunde sind Vorschläge zur Prüfung.
Unfertige Recherchen aus importierten oder zusammengeführten Dateien warten auf `ERNEUT VERSUCHEN`.

Für Tag-Vorschläge gehen nur die Namen der Tags und ihre Häufigkeit an Codex, keine Gedanken. Codex darf dabei
nur bestehende Tags gruppieren. Die Neu-Analyse überträgt jeden Gedanken noch einmal wie beim Erfassen.

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
