# Digest-Job: wohin mit dem Ergebnis

Jeden Digest als JSON-Datei in den Ordner `inbox/` des privaten Repos `berghtho/work` legen. Mehr nicht.
GitHub übernimmt ihn dann in Gedankenraum; analysiert wird er beim nächsten Start der App.

## Datei

Name: `inbox/<YYYY-MM-DD>-<kurzname>.json`, jedes Mal neu, z.B. `inbox/2026-10-20-youtube-ai.json`.

```json
{
  "format": "gedankenraum-inbox",
  "version": 1,
  "type": "digest",
  "title": "YouTube AI digest – 2026-10-20",
  "text": "## Kanal A\n\n- Punkt 1",
  "sourceUrls": ["https://www.youtube.com/watch?v=abc123"]
}
```

`title` und `text` (Markdown) sind Pflicht, `sourceUrls` ist optional.

## Ablegen

```bash
NAME="$(date -u +%F)-youtube-ai.json"
jq -n --arg m "Digest $NAME" --arg c "$(base64 -w0 digest.json)" '{message:$m, content:$c}' \
  | gh api -X PUT "repos/berghtho/work/contents/inbox/$NAME" --input -
```

Zugang: ein Fine-grained Token nur für `berghtho/work` mit „Contents: Read and write“.

## Prüfen

Auf GitHub unter `berghtho/work` → Actions → „Gedankenraum-Sync“ ist der Lauf grün, die Datei liegt
danach in `inbox/done/`. Beim nächsten Lauf wird sie dort gelöscht, weil ihr Digest dann gepusht in
`ideas.json` steht; in der Git-Historie bleibt sie erhalten.
