// Liegt ideas.json eingecheckt in einem Git-Repository, bietet das Menü bei Änderungen „Push“ an.
// Geprüft wird kurz nach jeder Änderung der Sammlung und beim Öffnen des Menüs.
export function initGitPush({ root, request, notify }) {
  const gitPush = root.querySelector('[data-git-push]');
  let gitTimer = null;
  let gitCheck = 0;
  const showGit = (git) => {
    const pending = !!git?.available && (git.changed || git.ahead > 0);
    gitPush.hidden = !pending;
    if (!pending) return;
    // Push nimmt alle lokalen Commits des Branches mit, auch solche, die nicht von Gedankenraum stammen.
    const foreign = git.foreign > 0 ? git.foreign : 0;
    const others = `${foreign} fremde${foreign === 1 ? 'r' : ''} Commit${foreign === 1 ? '' : 's'}`;
    gitPush.textContent = git.changed ? `PUSH · ideas.json geändert${foreign ? ` (+ ${others})` : ''}` : `PUSH · ${git.ahead} Commit${git.ahead === 1 ? '' : 's'} offen${foreign ? ` (${foreign} fremde)` : ''}`;
    gitPush.title = `Committet ideas.json und pusht ${git.branch}${git.upstream ? ` nach ${git.upstream}` : ''}`
      + (foreign ? `. Dabei ${foreign === 1 ? 'wird' : 'werden'} auch ${others} gepusht, ${foreign === 1 ? 'der' : 'die'} nicht von Gedankenraum ${foreign === 1 ? 'stammt' : 'stammen'}.` : '');
  };
  const loadGit = async () => {
    clearTimeout(gitTimer);
    const check = ++gitCheck;
    try {
      const response = await fetch('/api/git');
      const git = await response.json();
      if (check === gitCheck) showGit(response.ok ? git : null);
      return response.ok ? git : null;
    } catch { if (check === gitCheck) showGit(null); return null; }
  };
  // Was der Start aus dem Remote-Repository geholt hat, erscheint einmal beim Laden.
  const announceUpdate = (update) => {
    if (update?.error) notify(`Nicht aktualisiert: ${update.error}`, true);
    else if (update?.pulled) notify(`Aktualisiert: ${update.pulled} Commit${update.pulled === 1 ? '' : 's'} aus ${update.upstream} geholt.`);
  };
  gitPush.addEventListener('click', async () => {
    gitPush.disabled = true;
    notify('ideas.json wird committet und gepusht …');
    try {
      const git = await request('/api/git/push');
      gitCheck += 1; showGit(git);
      notify(git.pushed ? `ideas.json wurde nach ${git.upstream ?? git.branch} gepusht.` : 'Keine Änderungen zum Pushen.');
    } catch (error) {
      notify(error.message, true);
      loadGit();
    } finally {
      gitPush.disabled = false;
    }
  });
  return {
    check: loadGit,
    checkSoon: () => { clearTimeout(gitTimer); gitTimer = setTimeout(loadGit, 1000); },
    stop: () => clearTimeout(gitTimer),
    load: () => loadGit().then((git) => announceUpdate(git?.update)),
  };
}
