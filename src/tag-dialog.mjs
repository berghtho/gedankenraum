import { lower, tagsOf } from './util.mjs';

// Einen Tag umbenennen; heißt das Ziel schon so, werden beide Tags zusammengelegt.
export function initTagDialog({ root, snapshot, request, render, notify, showTag }) {
  const q = (selector) => root.querySelector(selector);
  const tagDialog = q('[data-tag-dialog]');
  const tagName = q('[data-tag-name]');
  const tagHint = q('[data-tag-hint]');
  const tagSave = q('[data-tag-save]');
  const tagHeading = q('[data-tag-heading]');
  let editingTag = null;

  const openTagDialog = (tag) => {
    editingTag = tag;
    tagName.value = tag;
    tagHeading.textContent = `#${tag}`;
    updateTagHint();
    tagDialog.showModal();
    tagName.select();
  };
  const updateTagHint = () => {
    const { ideas } = snapshot();
    const target = tagName.value.trim().replace(/^#/, '');
    const affected = ideas.filter((idea) => tagsOf(idea).includes(editingTag)).length;
    const exists = target && lower(target) !== lower(editingTag) && ideas.some((idea) => tagsOf(idea).some((tag) => lower(tag) === lower(target)));
    tagSave.disabled = !target || target === editingTag;
    tagSave.textContent = exists ? 'ZUSAMMENLEGEN' : 'UMBENENNEN';
    tagHint.textContent = exists
      ? `#${target} existiert bereits. Beide Tags werden zusammengelegt (${affected} Gedanken betroffen).`
      : target && target !== editingTag ? `${affected} Gedanke${affected === 1 ? '' : 'n'} ${affected === 1 ? 'wird' : 'werden'} umbenannt.` : '';
  };
  tagName.addEventListener('input', updateTagHint);
  tagName.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !tagSave.disabled) tagSave.click(); });
  for (const button of root.querySelectorAll('[data-tag-cancel]')) button.addEventListener('click', () => tagDialog.close());
  tagSave.addEventListener('click', async () => {
    const target = tagName.value.trim().replace(/^#/, '');
    if (!target || !editingTag) return;
    tagSave.disabled = true;
    try {
      const result = await request('/api/ideas/execute', { type: 'renametag', from: editingTag, to: target });
      showTag(result.tag);
      tagDialog.close();
      notify(result.merged ? `#${editingTag} wurde in #${result.tag} zusammengelegt.` : `#${editingTag} heißt jetzt #${result.tag}.`);
      render();
    } catch (error) {
      tagHint.textContent = error.message;
      tagSave.disabled = false;
    }
  });
  return { open: openTagDialog };
}
