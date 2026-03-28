// ── New memory modal ───────────────────────────────────────────────────────
function openNewFileModal() {
  document.getElementById('new-file-modal').style.display = 'flex';
  document.getElementById('nf-filename').focus();
}
document.getElementById('nf-cancel').onclick = () => {
  document.getElementById('new-file-modal').style.display = 'none';
};
document.getElementById('nf-create').onclick = async () => {
  const filename = document.getElementById('nf-filename').value.trim();
  const name = document.getElementById('nf-name').value.trim();
  const desc = document.getElementById('nf-desc').value.trim();
  const type = document.getElementById('nf-type').value;
  const body = document.getElementById('nf-body').value.trim();
  if (!filename || !name) { alert('Filename and name are required.'); return; }
  const content = `---\nname: ${name}\ndescription: ${desc}\ntype: ${type}\n---\n\n${body}\n`;
  await api('POST', `/api/projects/${activeProjectId}/memories`, { filename, content });
  document.getElementById('new-file-modal').style.display = 'none';
  ['nf-filename','nf-name','nf-desc','nf-body'].forEach(id => document.getElementById(id).value = '');
  await selectProject(activeProjectId);
};
document.getElementById('new-file-modal').onclick = e => {
  if (e.target === e.currentTarget) document.getElementById('new-file-modal').style.display = 'none';
};

// ── New command modal ──────────────────────────────────────────────────────
function openNewCommandModal() {
  document.getElementById('new-command-modal').style.display = 'flex';
  document.getElementById('nc-name').focus();
}
document.getElementById('nc-cancel').onclick = () => {
  document.getElementById('new-command-modal').style.display = 'none';
};
document.getElementById('nc-create').onclick = async () => {
  const name = document.getElementById('nc-name').value.trim();
  const body = document.getElementById('nc-body').value.trim();
  if (!name) { alert('Command name is required.'); return; }
  await api('POST', '/api/commands', { name, content: body + '\n' });
  document.getElementById('new-command-modal').style.display = 'none';
  document.getElementById('nc-name').value = '';
  document.getElementById('nc-body').value = '';
  commands = await api('GET', '/api/commands');
  renderCommandsMiddlePanel();
  renderCommandSidebar();
};
document.getElementById('new-command-modal').onclick = e => {
  if (e.target === e.currentTarget) document.getElementById('new-command-modal').style.display = 'none';
};
