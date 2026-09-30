// Speicherort von ideas.json: anzeigen, wählen und wechseln. Liegt am Ziel schon eine Sammlung, wird gefragt.
export function initStorageDialog({ root, request, render, notify, closeMenu, reset }) {
  const q = (selector) => root.querySelector(selector);
  const storageOpen = q('[data-storage-open]');
  const storageDialog = q('[data-storage-dialog]');
  const storageDirectory = q('[data-storage-directory]');
  const storageFile = q('[data-storage-file]');
  const storageBrowse = q('[data-storage-browse]');
  const storageSave = q('[data-storage-save]');
  const storageMessage = q('[data-storage-message]');
  const storageDecision = q('[data-storage-decision]');
  const storageMerge = q('[data-storage-merge]');
  const storageReplace = q('[data-storage-replace]');

  const showStorageMessage = (text) => {
    storageMessage.textContent = text ?? '';
    storageMessage.hidden = !text;
  };
  const updateStorageFile = () => {
    storageDecision.hidden = true;
    const directory = storageDirectory.value.trim().replace(/[\\/]$/, '');
    storageFile.textContent = directory ? `${directory}${directory.includes('\\') ? '\\' : '/'}ideas.json` : 'ideas.json';
  };
  const loadStorage = async () => {
    const response = await fetch('/api/storage');
    const storage = await response.json();
    if (!response.ok) throw new Error(storage.error ?? 'Speicherort konnte nicht geladen werden.');
    storageDirectory.value = storage.directory;
    storageOpen.title = storage.filePath;
    storageBrowse.hidden = !storage.canBrowse;
    storageDirectory.disabled = !storage.configurable;
    storageSave.disabled = !storage.configurable;
    updateStorageFile();
    return storage;
  };

  storageOpen.addEventListener('click', async () => {
    closeMenu();
    showStorageMessage('');
    storageDecision.hidden = true;
    try {
      const storage = await loadStorage();
      if (!storage.configurable) showStorageMessage('Der Speicherort wird durch GEDANKENRAUM_HOME festgelegt.');
      storageDialog.showModal();
    } catch (error) {
      notify(error.message, true);
    }
  });
  storageDirectory.addEventListener('input', updateStorageFile);
  storageBrowse.addEventListener('click', async () => {
    storageBrowse.disabled = true;
    showStorageMessage('Windows-Ordnerauswahl ist geöffnet.');
    try {
      const result = await request('/api/storage/browse', { initialDirectory: storageDirectory.value.trim() });
      if (result.directory) {
        storageDirectory.value = result.directory;
        updateStorageFile();
      }
      showStorageMessage('');
    } catch (error) {
      showStorageMessage(error.message);
    } finally {
      storageBrowse.disabled = false;
    }
  });
  const switchStorage = async (mode) => {
    for (const button of [storageSave, storageMerge, storageReplace]) button.disabled = true;
    storageDecision.hidden = true;
    showStorageMessage('Speicherort wird geprüft.');
    try {
      const result = await request('/api/storage', { directory: storageDirectory.value.trim(), ...(mode && { mode }) });
      reset();
      storageOpen.title = result.filePath;
      storageDialog.close();
      const messages = {
        created: 'Sammlung wurde am neuen Speicherort angelegt.',
        merge: 'Sammlungen wurden zusammengeführt.',
        replace: 'Zieldatei wurde durch die aktuelle Sammlung ersetzt.',
        unchanged: 'Dieser Speicherort wird bereits verwendet.',
      };
      notify(messages[result.action] ?? 'Speicherort wurde geändert.');
      render();
    } catch (error) {
      showStorageMessage(error.message);
      storageDecision.hidden = !error.requiresDecision;
    } finally {
      for (const button of [storageSave, storageMerge, storageReplace]) button.disabled = false;
    }
  };
  storageSave.addEventListener('click', () => switchStorage());
  storageMerge.addEventListener('click', () => switchStorage('merge'));
  storageReplace.addEventListener('click', () => switchStorage('replace'));
  for (const selector of ['[data-storage-close]', '[data-storage-cancel]']) {
    q(selector).addEventListener('click', () => storageDialog.close());
  }
  return { load: loadStorage };
}
