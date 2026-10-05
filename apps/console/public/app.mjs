const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const icons = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  payments: 'M3 6h18v14H3z M3 10h18 M6 15h4 M6 3h12',
  policy: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z M8 12l3 3 5-6',
  recovery: 'M4 9a8 8 0 1 1 0 6 M4 3v6h6 M12 8v5l3 2',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v11H5z M12 14v3',
  license: 'M6 3h12v18l-6-3-6 3z M9 8h6 M9 12h6',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', icons[name] || icons.payments);
  svg.append(path);
  return svg;
}
$$('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)));
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}
function text(selector, content) { $(selector).textContent = String(content ?? '—'); }
function pretty(value) { return String(value || 'unresolved').replaceAll(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()); }
function number(value) { try { return BigInt(value).toLocaleString('en-US'); } catch { return String(value ?? '—'); } }
function fact(label, value, mono = false) {
  const row = element('div', 'fact');
  row.append(element('dt', '', label), element('dd', mono ? 'mono' : '', value));
  return row;
}
let state = null;
let connected = false;
let failures = 0;
let pollTimer;
let pollController;
let mutationPending = false;
let selectedId = null;
let filter = 'all';
let view = 'overview';
let preparedDraft = null;
let confirmation = null;
let toastTimer;
const actionLabels = {
  'approve-query': 'Approve private query',
  'approve-payment': 'Approve payment',
  'recover-query': 'Recover query',
  'recover-payment': 'Recover payment',
  'submit-query': 'Submit retained query',
  'submit-payment': 'Submit retained payment',
  refresh: 'Refresh observation',
};
const actionCopy = {
  'approve-query': ['Approve the private query?', 'Authorize the owner and administrator to sign and submit one query for this exact intent.', 'The policy check may disclose an allow or deny result. It does not pay, reserve capacity or issue an entitlement.'],
  'approve-payment': ['Approve this payment?', 'Authorize the owner to sign and submit settlement for this exact intent.', 'The native payment and bound application effect must commit together. Current authorization can become stale before settlement.'],
  'submit-query': ['Submit the retained query?', 'Submit the original signed query bytes for this intent.', 'This does not replace the transaction, renew its expiry or recompute the policy. Submission is allowed only within the retained delivery bounds.'],
  'submit-payment': ['Submit the retained payment?', 'Submit the original signed payment bytes for this intent.', 'This does not create a new charge or replace the transaction. A missing receipt alone does not establish failure.'],
};
const operations = () => Array.isArray(state?.operations) ? state.operations : [];
const currentOperation = id => operations().find(op => op.id === id);
const superseded = op => Boolean(op.supersededBy) || op.phase === 'superseded';
const paid = op => !superseded(op) && (op.observation?.status === 'committed' || op.paymentCommitted === true);
const attention = op => !superseded(op) && !op.busy && (op.actions || []).some(action => action !== 'refresh');
const locked = () => !connected || mutationPending || Boolean(state?.busy);
const canPrepare = () => !locked() && state?.project?.signingEnabled === true && state.project.administratorConfigured === true && state.project.sources?.some(source => source.canSign);
const sourceLabel = id => state?.project?.sources?.find(source => source.id === id)?.label || `Source ${String(id || '').toUpperCase()}`;
function status(op) {
  if (superseded(op)) return { label: 'Superseded', className: '' };
  if (paid(op)) return { label: op.observation?.status === 'committed' ? 'Paid' : 'Paid · previously confirmed', className: 'paid' };
  if (op.busy) return { label: 'Working', className: 'attention' };
  const observed = op.observation?.status;
  if (observed === 'authorized') return { label: 'Authorized · unpaid', className: 'attention' };
  if (['denied', 'stale', 'expired'].includes(observed)) return { label: pretty(observed), className: 'issue' };
  if (op.error) return { label: 'Needs review', className: 'issue' };
  return { label: pretty(observed || op.phase || 'prepared'), className: '' };
}
function toast(message) {
  clearTimeout(toastTimer);
  text('#toast', message);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
function switchView(next) {
  if (!['overview', 'payments', 'policy', 'recovery'].includes(next)) return;
  view = next;
  $$('.view').forEach(node => { node.hidden = node.id !== `view-${next}`; });
  $$('.nav-item').forEach(node => {
    const active = node.dataset.view === next;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  text('#breadcrumb', { overview: 'Overview', payments: 'Payment inbox', policy: 'Policy & runtime', recovery: 'Recovery' }[next]);
  $('#main').focus({ preventScroll: true });
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  $$('[data-filter]').forEach(node => {
    const active = node.dataset.filter === filter;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  });
  renderLists();
}));
$$('[data-close]').forEach(button => button.addEventListener('click', () => {
  if (!mutationPending) button.closest('dialog').close();
}));
$$('dialog').forEach(dialog => dialog.addEventListener('cancel', event => {
  if (mutationPending) event.preventDefault();
}));
function emptyState(filtered = false, recovery = false) {
  const box = element('div', 'empty-state');
  const symbol = element('span', 'empty-symbol');
  symbol.append(icon(recovery ? 'recovery' : 'payments'));
  box.append(symbol, element('h3', '', filtered ? 'Nothing in this view' : recovery ? 'Your recovery history starts here' : 'Your first intent starts here'), element('p', '', filtered ? 'Other intents are available in the All intents view.' : recovery ? 'Prepared operations stay available here for observation and recovery.' : 'Prepare a local payment and follow it through each explicit approval.'));
  if (!filtered && !recovery) {
    const button = element('button', 'text-button', 'Prepare a payment →');
    button.disabled = !canPrepare();
    button.addEventListener('click', openCreate);
    box.append(button);
  }
  return box;
}
function operationRow(op, recovery = false) {
  const row = element('button', 'operation-row');
  row.type = 'button';
  row.dataset.operationId = op.id;
  const symbol = element('span', 'operation-icon');
  symbol.append(icon(op.consumer?.kind === 'license' ? 'license' : 'payments'));
  const name = element('span');
  const effect = op.consumer?.kind === 'license' ? 'License' : `SKU ${op.consumer?.sku ?? '—'}`;
  const created = new Date(op.createdAt);
  const date = Number.isNaN(created.getTime()) ? '' : ` · ${created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  name.append(element('span', 'operation-name', op.title || 'Untitled intent'), element('span', 'operation-description', recovery ? deliverySummary(op) : `${sourceLabel(op.sourceId)} · ${effect}${date}`));
  const meta = element('span', 'operation-meta');
  const amount = element('span', 'operation-amount', number(op.amount));
  amount.append(element('small', '', 'base units'));
  const result = status(op);
  meta.append(amount, element('span', `status ${result.className}`, result.label));
  row.append(symbol, name, meta, element('span', 'chevron', '›'));
  row.setAttribute('aria-label', `${op.title || 'Payment intent'}, ${number(op.amount)} base units, ${result.label}. View details`);
  row.addEventListener('click', () => openDetails(op.id));
  return row;
}
function deliverySummary(op) {
  const items = Object.entries(op.deliveries || {}).filter(([, delivery]) => delivery);
  if (!items.length) return 'No retained delivery reported';
  return items.map(([role, delivery]) => `${role === 'commit' ? 'Payment' : 'Query'}: ${pretty(delivery.status)}`).join(' · ');
}
function renderLists() {
  const all = [...operations()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const selected = all.filter(op => filter === 'all' || (filter === 'paid' ? paid(op) : attention(op)));
  $('#recent-list').replaceChildren(...(all.length ? all.slice(0, 4).map(op => operationRow(op)) : [emptyState()]));
  $('#payment-list').replaceChildren(...(selected.length ? selected.map(op => operationRow(op)) : [emptyState(filter !== 'all')]));
  $('#recovery-list').replaceChildren(...(all.length ? all.map(op => operationRow(op, true)) : [emptyState(false, true)]));
  text('#inbox-count', `${selected.length} ${selected.length === 1 ? 'intent' : 'intents'}`);
}
function renderProject() {
  const project = state.project;
  text('#sidebar-project', project.name || 'Local policy');
  text('#hero-project', project.name || 'Local policy connected');
  text('#policy-name', project.name || 'Local policy');
  $('#project-details').replaceChildren(fact('Network', 'Local Solana · synthetic assets'), fact('Profile', project.profile || 'Not reported', true), fact('Release', project.release || 'Not reported', true), fact('Signing', project.signingEnabled ? 'Enabled locally · consent required' : 'Disabled · observe and recover'), fact('Administrator', project.administratorConfigured ? 'Configured for explicit admission' : 'Not configured'), fact('Observed slot', project.slot === undefined ? 'Not reported' : number(project.slot)));
  $('#source-list').replaceChildren(...(project.sources || []).map(source => {
    const row = element('div', 'source-row');
    row.append(element('span', '', source.label || `Source ${source.id}`), element('span', 'status', source.canSign ? 'Signer configured' : 'Read-only'));
    return row;
  }));
  const banner = $('#signing-banner');
  banner.hidden = Boolean(project.signingEnabled && project.administratorConfigured && project.sources?.some(source => source.canSign));
  banner.textContent = !project.signingEnabled ? 'Observation mode. Signing is disabled for this console. You can inspect retained intents and use available recovery actions.' : !project.administratorConfigured ? 'Administrator signer not configured. New intents and private-query approval require explicit administrator admission.' : 'No source signer is configured. Retained intents remain available for observation and recovery.';
  $('#suggest-expiry').hidden = project.slot === undefined || project.slot === null;
  text('#slot-help', project.slot === undefined || project.slot === null ? 'The immutable expiry allows at most 1,000 slots of validity at settlement.' : `Last observed slot: ${number(project.slot)}. Expiry is immutable and must be within 1,000 slots at settlement.`);
}
function render() {
  const focused = document.activeElement;
  const focusKey = focused?.dataset?.operationId ? { operationId: focused.dataset.operationId, listId: focused.closest('.operation-list')?.id } : focused?.dataset?.action ? { action: focused.dataset.action } : null;
  text('#connection', connected ? 'Connected' : 'Disconnected');
  $('#connection').classList.toggle('offline', !connected);
  $$('[data-new]').forEach(button => { button.disabled = !canPrepare(); });
  if (!state) return;
  renderProject();
  text('#nav-count', operations().length);
  text('#stat-total', operations().length);
  text('#stat-attention', operations().filter(attention).length);
  text('#stat-paid', operations().filter(paid).length);
  renderLists();
  if ($('#detail-dialog').open && selectedId) renderDetails();
  if ($('#confirm-dialog').open && confirmation) {
    const op = currentOperation(confirmation.id);
    $('#confirm-submit').disabled = locked() || !op || superseded(op) || op.busy || !op.actions?.includes(confirmation.action) || op.planHash !== confirmation.planHash;
  }
  if ($('#create-dialog').open) $('#create-submit').disabled = !canPrepare();
  if (focusKey?.operationId && focusKey.listId) {
    const replacement = $$('.operation-row', document.getElementById(focusKey.listId)).find(node => node.dataset.operationId === focusKey.operationId);
    replacement?.focus({ preventScroll: true });
  } else if (focusKey?.action) {
    const replacement = $$('#detail-body button[data-action]').find(node => node.dataset.action === focusKey.action);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  }
}
async function parseResponse(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`The console returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error((typeof body.error === 'string' ? body.error : body.error?.message) || body.message || `Request failed (${response.status}).`);
  return body;
}
function acceptState(next) {
  if (!next || !next.project || !Array.isArray(next.operations)) throw new Error('The console returned an invalid workspace state.');
  state = next;
  connected = true;
  failures = 0;
  $('#connection-banner').hidden = true;
  render();
}
function schedulePoll(delay = 2000) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(loadState, delay);
}
async function loadState() {
  clearTimeout(pollTimer);
  if (mutationPending) return;
  pollController?.abort();
  const controller = new AbortController();
  pollController = controller;
  const timeout = setTimeout(() => controller.abort('timeout'), 15000);
  try {
    const response = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const next = await parseResponse(response);
    if (controller !== pollController || mutationPending) return;
    acceptState(next);
    schedulePoll();
  } catch (error) {
    if (controller !== pollController || mutationPending) return;
    connected = false;
    failures += 1;
    text('#connection-message', `${state ? 'Showing the last observed state. ' : ''}${failures >= 8 ? 'Automatic reconnect paused. Retry when the local console is available.' : 'The local console is unavailable. Reconnecting…'}${error.name === 'AbortError' ? '' : ` ${error.message}`}`);
    $('#connection-banner').hidden = false;
    if (!state) {
      $$('.operation-list').forEach(node => node.replaceChildren(element('div', 'loading-state', 'Connect to the local console to load your workspace.')));
    }
    render();
    if (failures < 8) schedulePoll(Math.min(30000, 2000 * 2 ** (failures - 1)));
  } finally { clearTimeout(timeout); }
}
$('#retry').addEventListener('click', () => { failures = 0; loadState(); });
async function mutate(path, body) {
  if (locked()) throw new Error('Wait for the active task or reconnect before continuing.');
  mutationPending = true;
  clearTimeout(pollTimer);
  pollController?.abort();
  pollController = null;
  render();
  $$('dialog [data-close], dialog #create-back').forEach(button => { button.disabled = true; });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'console' }, body: JSON.stringify(body) });
    const next = await parseResponse(response);
    acceptState(next);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out and may already have been accepted.');
    throw error;
  } finally {
    clearTimeout(timeout);
    mutationPending = false;
    $$('dialog [data-close], dialog #create-back').forEach(button => { button.disabled = false; });
    render();
    schedulePoll(250);
  }
}
function openCreate() {
  if (!canPrepare()) return;
  preparedDraft = null;
  $('#create-form').reset();
  $('#create-fields').hidden = false;
  $('#create-review').hidden = true;
  $('#create-back').hidden = true;
  $('#create-cancel').hidden = false;
  $('#create-error').hidden = true;
  text('#create-title', 'Make the intent precise.');
  text('#create-submit', 'Review intent →');
  $('#source').replaceChildren(...state.project.sources.map(source => {
    const option = element('option', '', source.label || `Source ${source.id}`);
    option.value = source.id;
    option.disabled = !source.canSign;
    return option;
  }));
  $('#source').value = state.project.sources.find(source => source.canSign)?.id || '';
  toggleConsumer();
  $('#create-dialog').showModal();
}
$$('[data-new]').forEach(button => button.addEventListener('click', openCreate));
function toggleConsumer() {
  const license = $('#consumer').value === 'license';
  $('#merchant-fields').hidden = license;
  $('#license-fields').hidden = !license;
  $('#sku').disabled = license;
  $('#sku').required = !license;
  for (const id of ['product', 'expiry']) { $(`#${id}`).disabled = !license; $(`#${id}`).required = license; }
}
$('#consumer').addEventListener('change', toggleConsumer);
$('#suggest-expiry').addEventListener('click', () => {
  try { $('#expiry').value = String(BigInt(state.project.slot) + 900n); } catch { toast('An observed slot is required to suggest an expiry.'); }
});
function summaryRows(intent) {
  const rows = [fact('Label', intent.title), fact('Amount', `${number(intent.amount)} base units`), fact('Source', sourceLabel(intent.sourceId)), fact('Application effect', intent.consumer.kind === 'license' ? 'Time-limited license' : 'Merchant purchase')];
  if (intent.consumer.kind === 'license') rows.push(fact('Product', intent.consumer.productHex32, true), fact('Absolute expiry slot', intent.consumer.expirySlot));
  else rows.push(fact('One-time SKU', intent.consumer.sku));
  return rows;
}
function readDraft() {
  const form = new FormData($('#create-form'));
  const amount = String(form.get('amount') || '').trim();
  if (!/^[1-9][0-9]*$/.test(amount) || BigInt(amount) >= 2n ** 48n) throw new Error('Amount must be a positive integer below 281,474,976,710,656 base units.');
  const title = String(form.get('title') || '').trim();
  if (!title) throw new Error('Add a label to identify this payment intent.');
  const sourceId = String(form.get('sourceId'));
  if (!state.project.sources.some(source => source.id === sourceId && source.canSign)) throw new Error('Choose a source with a configured signer.');
  let consumer;
  if (form.get('consumer') === 'license') {
    const productHex32 = String(form.get('productHex32') || '').trim().toLowerCase();
    const expirySlot = String(form.get('expirySlot') || '').trim();
    if (!/^[0-9a-f]{64}$/.test(productHex32)) throw new Error('The product identifier must contain exactly 64 hexadecimal characters.');
    if (!/^[1-9][0-9]*$/.test(expirySlot) || BigInt(expirySlot) > 2n ** 64n - 1n) throw new Error('Enter a valid absolute expiry slot as a decimal u64 integer.');
    if (state.project.slot !== undefined && state.project.slot !== null) {
      const remaining = BigInt(expirySlot) - BigInt(state.project.slot);
      if (remaining <= 0n || remaining > 1000n) throw new Error('Expiry must be after the observed slot and no more than 1,000 slots ahead. Review the immutable expiry before preparing.');
    }
    consumer = { kind: 'license', productHex32, expirySlot };
  } else {
    const sku = String(form.get('sku') || '').trim();
    if (!/^(0|[1-9][0-9]*)$/.test(sku) || BigInt(sku) > 2n ** 64n - 1n) throw new Error('SKU must be a canonical decimal u64 integer.');
    consumer = { kind: 'merchant', sku };
  }
  return { requestId: crypto.randomUUID(), title, amount, sourceId, consumer, consent: 'prepare-native' };
}
$('#create-back').addEventListener('click', () => {
  preparedDraft = null;
  $('#create-fields').hidden = false;
  $('#create-review').hidden = true;
  $('#create-back').hidden = true;
  $('#create-cancel').hidden = false;
  text('#create-title', 'Make the intent precise.');
  text('#create-submit', 'Review intent →');
  $('#title').focus();
});
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canPrepare()) return;
  $('#create-error').hidden = true;
  if (!preparedDraft) {
    try {
      preparedDraft = readDraft();
      $('#create-summary').replaceChildren(...summaryRows(preparedDraft));
      $('#create-fields').hidden = true;
      $('#create-review').hidden = false;
      $('#create-back').hidden = false;
      $('#create-cancel').hidden = true;
      text('#create-title', 'Review native preparation');
      text('#create-submit', 'Approve & prepare');
      $('#create-submit').focus();
    } catch (error) { text('#create-error', error.message); $('#create-error').hidden = false; }
    return;
  }
  const draft = preparedDraft;
  preparedDraft = null;
  try {
    await mutate('/api/operations', draft);
    $('#create-dialog').close();
    switchView('payments');
    toast('Native preparation requested. Follow this intent in the inbox.');
  } catch (error) {
    $('#create-dialog').close();
    switchView('payments');
    toast(`${error.message} The request was not retried. Check the inbox before preparing another intent.`);
  }
});
function openDetails(id) {
  selectedId = id;
  renderDetails();
  $('#detail-dialog').showModal();
}
function renderDetails() {
  const op = currentOperation(selectedId);
  if (!op) { $('#detail-dialog').close(); return; }
  text('#detail-title', op.title || 'Payment intent');
  const body = $('#detail-body');
  const result = status(op);
  const statuses = element('div', 'detail-status-grid');
  const statusCard = (label, value, explanation) => {
    const card = element('div', 'detail-status-card');
    card.append(element('span', '', label), element('strong', '', value), element('p', '', explanation));
    return card;
  };
  const historical = superseded(op);
  const displayedObservation = historical ? op.historicalObservation : op.observation;
  const currentCommitted = !historical && op.observation?.status === 'committed';
  const paymentLabel = historical ? 'Superseded · historical intent' : paid(op) ? currentCommitted ? 'Paid · committed effect' : 'Paid · previously confirmed' : op.observation?.status === 'authorized' ? 'Authorized · unpaid' : `Not confirmed paid · ${result.label}`;
  const license = op.consumer?.kind === 'license';
  const active = currentCommitted ? op.observation?.licenseActive : undefined;
  statuses.append(statusCard('Payment / effect', paymentLabel, historical ? 'This terminal unpaid intent was superseded by a separately prepared intent. Its historical observation is retained.' : currentCommitted ? 'Established by the bound account effect.' : paid(op) ? 'Retained committed effect. A current committed observation is unavailable.' : 'Query authorization and signatures alone do not establish payment.'), statusCard(historical ? 'Historical receipt delivery' : 'Receipt delivery', deliverySummary(op), historical ? 'Original delivery records are retained. No further submission is available for this intent.' : 'Receipt availability is independent of the payment effect.'), statusCard(historical ? 'Current entitlement' : 'Use at observed slot', historical ? 'Not assessed by this record' : license ? active === true ? 'License active at observation' : active === false ? 'License not active at observation' : 'License unresolved' : paid(op) ? currentCommitted ? 'Merchant effect issued' : 'Merchant effect previously confirmed' : 'Not confirmed issued', historical ? 'Inspect the successor intent for its own payment and application effect.' : license ? 'Refresh to observe again. A paid license may expire without changing its payment status.' : 'The merchant effect is bound to this exact purchase.'));
  const facts = element('dl', 'facts');
  facts.append(...summaryRows(op), fact('Intent ID', op.id, true), fact('Plan hash', op.planHash || 'Available after preparation', true), fact(historical ? 'Historical observation' : 'Current observation', displayedObservation ? pretty(displayedObservation.status) : 'Unavailable'), fact(historical ? 'Historical observed slot' : 'Observed slot', displayedObservation?.slot === undefined ? 'Not reported' : number(displayedObservation.slot)));
  if (op.supersededBy) facts.append(fact('Successor intent ID', op.supersededBy, true));
  body.replaceChildren(statuses, facts);
  if (historical) {
    const note = element('div', 'inline-note', 'A separately authorized fresh intent superseded this unpaid operation. This record is preserved and is no longer observed or submitted. A successor’s payment is never attributed to this intent.');
    if (op.supersededBy && currentOperation(op.supersededBy)) {
      const successor = element('button', 'text-button successor-link', 'View successor intent →');
      successor.type = 'button';
      successor.dataset.action = 'view-successor';
      successor.addEventListener('click', () => { selectedId = op.supersededBy; renderDetails(); $('#detail-dialog [data-close]').focus(); });
      note.append(successor);
    }
    body.append(note);
  }
  if (op.error) body.append(element('p', 'form-error', `${historical ? 'Historical error: ' : ''}${op.error.code ? `${op.error.code}: ` : ''}${op.error.message || 'The operation needs review.'}`));
  const deliveries = Object.entries(op.deliveries || {}).filter(([, delivery]) => delivery);
  if (deliveries.length) body.append(element('h3', 'detail-subhead', 'Original delivery records'));
  for (const [role, delivery] of deliveries) {
    const record = element('div', 'delivery-block');
    record.append(element('h4', '', role === 'commit' ? 'Payment delivery' : 'Query delivery'), element('p', '', `Status: ${pretty(delivery.status)} · ${!historical && delivery.canBroadcast === true ? 'Retained bytes may be eligible for explicit submission' : 'Broadcast unavailable'}`));
    if (delivery.signature) record.append(element('p', 'delivery-signature', `Signature: ${delivery.signature}`));
    body.append(record);
  }
  if (paid(op) && license && active === false) body.append(element('div', 'inline-note', 'The payment remains paid. This license is not currently active; recovery does not renew its expiry.'));
  if (op.busy && !historical) body.append(element('p', 'busy-indicator', 'Local operation in progress. Observing for updates…'));
  const actions = element('div', 'detail-actions');
  for (const action of historical ? [] : op.actions || []) {
    if (!actionLabels[action]) continue;
    const button = element('button', `button ${action.startsWith('approve') ? 'primary' : 'secondary'}`, actionLabels[action]);
    button.type = 'button';
    button.dataset.action = action;
    button.disabled = locked() || Boolean(op.busy);
    button.addEventListener('click', () => runAction(op.id, action));
    actions.append(button);
  }
  if (historical || (!(op.actions || []).length && !op.busy)) actions.append(element('span', 'small-muted', historical ? 'This superseded intent is preserved as a historical record.' : 'No further actions are currently available for this intent.'));
  body.append(actions);
}
async function runAction(id, action) {
  const op = currentOperation(id);
  if (locked() || !op || superseded(op) || op.busy || !op.actions?.includes(action)) return;
  if (actionCopy[action]) {
    confirmation = { id, action, planHash: op.planHash };
    const [title, copy, note] = actionCopy[action];
    text('#confirm-title', title);
    text('#confirm-copy', copy);
    text('#confirm-note', note);
    text('#confirm-submit', actionLabels[action]);
    $('#confirm-summary').replaceChildren(...summaryRows(op), fact('Plan hash', op.planHash || 'Not reported', true));
    $('#confirm-error').hidden = true;
    $('#confirm-submit').disabled = false;
    $('#confirm-dialog').showModal();
    return;
  }
  try {
    await mutate(`/api/operations/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { consent: action, planHash: op.planHash });
    toast(action === 'refresh' ? 'Observation requested.' : 'Read-only recovery requested. Original signed bytes are retained.');
  } catch (error) { toast(`${error.message} No automatic retry was sent.`); }
}
$('#confirm-submit').addEventListener('click', async () => {
  if (!confirmation) return;
  const { id, action, planHash } = confirmation;
  const op = currentOperation(id);
  if (locked() || !op || superseded(op) || op.busy || !op.actions?.includes(action) || op.planHash !== planHash) {
    text('#confirm-error', 'The intent or its available actions changed. Close this review and inspect the latest state.');
    $('#confirm-error').hidden = false;
    return;
  }
  confirmation = null;
  $('#confirm-submit').disabled = true;
  try {
    await mutate(`/api/operations/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { consent: action, planHash });
    $('#confirm-dialog').close();
    toast(`${actionLabels[action]} requested. Observe the intent for its actual outcome.`);
  } catch (error) {
    $('#confirm-dialog').close();
    toast(`${error.message} The action was not retried. Inspect the current intent before continuing.`);
  }
});
render();
loadState();
