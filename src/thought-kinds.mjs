// Arten von Gedanken, die Liste, Mindmap und Raumübersicht gleich erkennen.
// Eine Frage ist ein eigener Gedanke, der mit „?“ endet; Links sind Quellen, keine Fragen.
export const isQuestion = (idea) => idea.source !== 'link' && [idea.title, idea.input].some((text) => /\?\s*$/.test(text ?? ''));

// Übernommene Vorschläge aus Auswertungen oder Recherchen.
export const isDerived = (idea) => !!(idea.reflectionOrigin || idea.researchOrigin);
