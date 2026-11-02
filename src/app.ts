const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginPanel = $('loginPanel'), appPanel = $('appPanel'), message = $('message');
const jsonInput = $<HTMLTextAreaElement>('jsonInput');
const confirm = $<HTMLInputElement>('confirm');
const importButton = $<HTMLButtonElement>('import');
let previewed = '';
function showMessage(text: string, error = false) {
  message.textContent = text;
  message.classList.remove('hidden');
  message.classList.toggle('error', error);
}
function loggedIn(value: boolean) {
  loginPanel.classList.toggle('hidden', value);
  appPanel.classList.toggle('hidden', !value);
}
async function request(path: string, body?: unknown) {
  const response = await fetch('/.netlify/functions/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function init() {
  try { loggedIn((await request('auth')).loggedIn); }
  catch { showMessage('Kunne ikke kontakte serveren. Prøv igjen.', true); }
}
$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('auth', { action: 'login', password: $<HTMLInputElement>('password').value });
    $<HTMLInputElement>('password').value = '';
    message.classList.add('hidden'); loggedIn(true);
  } catch (error) { showMessage((error as Error).message, true); }
});
$('logout').addEventListener('click', async () => {
  try { await request('auth', { action: 'logout' }); loggedIn(false); $('previewPanel').classList.add('hidden'); }
  catch (error) { showMessage((error as Error).message, true); }
});
function resetPreview() { previewed = ''; $('previewPanel').classList.add('hidden'); confirm.checked = false; importButton.disabled = true; }
jsonInput.addEventListener('input', resetPreview);
$('example').addEventListener('click', () => {
  jsonInput.value = JSON.stringify({ week: '2026-W45', activities: [{ date: '2026-11-03', start: '15:30', end: '16:00', title: 'Testaktivitet', description: 'Test fra MEMOplanner Import' }] }, null, 2);
  resetPreview();
});
$('preview').addEventListener('click', async () => {
  try {
    const value = JSON.parse(jsonInput.value);
    const result = await request('import', value);
    const list = $('items'); list.replaceChildren();
    for (const item of result.classification) {
      const a = item.activity;
      const el = document.createElement('div'); el.className = 'item';
      const name = document.createElement('strong'); name.textContent = a.title;
      const date = document.createElement('small'); date.textContent = `${a.date} · ${a.start}–${a.end}${a.description ? ' · ' + a.description : ''}`;
      const status = document.createElement('small');
      status.textContent = item.status === 'new' ? 'NY' : item.status === 'existing' ? 'FINNES ALLEREDE' : 'MULIG KONFLIKT';
      status.className = 'status ' + item.status;
      if (item.reason) status.title = item.reason;
      el.append(name, date, status); list.append(el);
    }
    showMessage(`${result.counts.new} nye · ${result.counts.existing} finnes allerede · ${result.counts.conflict} mulige konflikter`);
    previewed = jsonInput.value;
    confirm.checked = false; importButton.disabled = true;
    $('previewPanel').classList.remove('hidden');
  } catch (error) { resetPreview(); showMessage('Kunne ikke validere: ' + (error as Error).message, true); }
});
confirm.addEventListener('change', () => { importButton.disabled = !confirm.checked || !previewed; });
$('import').addEventListener('click', async () => {
  if (!confirm.checked || !previewed || jsonInput.value !== previewed) return;
  importButton.disabled = true;
  try {
    const result = await request('import', { ...JSON.parse(previewed), confirm: true });
    const lines = result.results.map((r: any) => `${r.status === 'created' ? '✓' : r.status === 'skipped' ? '–' : '!'} ${r.date}: ${r.title} – ${r.status}${r.detail ? ' (' + r.detail + ')' : ''}`);
    showMessage(`Forsøkt ${result.attempted} av ${result.total} aktiviteter.\n${lines.join('\n')}\n\n${result.warning}`, result.results.some((r: any) => ['error', 'unknown', 'conflict'].includes(r.status)));
    confirm.checked = false;
  } catch (error) { showMessage((error as Error).message, true); }
});
void init();
