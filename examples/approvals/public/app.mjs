const $ = selector => document.querySelector(selector);
const labels = {
  preparing: ['Preparing', 'neutral', 'Preparing the exact native payment and its application effect. No private query has been authorized.'],
  'awaiting-query-approval': ['Query approval needed', 'attention', 'The buyer and policy administrator must explicitly authorize this private policy check.'],
  'private-computation': ['Private check in progress', 'neutral', 'Waiting for an authenticated policy result. This has not paid the application.'],
  authorized: ['Policy authorized', 'attention', 'The private check allowed this request. Final payment still needs the buyer’s approval.'],
  'awaiting-final-approval': ['Payment approval needed', 'attention', 'The policy allowed this request. Approve the exact payment and application effect to continue.'],
  committed: ['Paid & fulfilled', 'success', 'The observed payment and exact application entitlement are committed together.'],
  denied: ['Policy denied', 'negative', 'The private policy declined this request. No paid entitlement was issued for it.'],
  stale: ['Authorization stale', 'attention', 'The shared allowance or source state changed. A fresh request needs fresh, explicit authorization.'],
  cancelled: ['Cancelled', 'neutral', 'This operation has been cancelled. A new request requires new approval.'],
  expired: ['Expired', 'attention', 'This authorization expired. Its signed transaction cannot be refreshed automatically.'],
  'unresolved-delivery': ['Delivery unresolved', 'attention', 'A missing response does not mean failure. Recover the saved operation before deciding what to do next.'],
  error: ['Needs attention', 'negative', 'Review the retained evidence. An error alone does not establish whether a payment completed.'],
};
const actionNames = {
  'approve-query': 'Approve private query', 'approve-commit': 'Approve exact payment', observe: 'Observe state',
  recover: 'Recover saved operation', 'resubmit-query': 'Resubmit identical query', 'resubmit-commit': 'Resubmit identical payment', cancel: 'Cancel',
};
let view = 'owner', state = null, fetching = false, generation = 0, lastRendered = '', posting = false, dialogAction = null, connectionHealthy = false;
const node = (tag, className, text) => {
  const element = document.createElement(tag); if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text); return element;
};
const display = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
const consumerName = op => op.consumer === 'license' ? 'Software license' : 'Merchant purchase';
function message(text, error = false) {
  const target = $('#notification'); target.hidden = !text; target.textContent = text;
  target.classList.toggle('error-message', error);
}
function detail(list, term, value, code = false) {
  list.append(node('dt', '', term)); const dd = node('dd');
  dd.append(node(code ? 'code' : 'span', '', display(value))); list.append(dd);
}
function verifiedPaid(op) { return Boolean(op.paidEffect && (op.sdkStatus === 'committed' || op.observation?.status === 'committed')); }
function phaseFor(op) { return op.phase === 'committed' && !verifiedPaid(op) ? 'unresolved-delivery' : op.phase; }
function operationCard(op) {
  const phase = phaseFor(op), [status, tone, description] = labels[phase] ?? [display(phase), 'neutral', 'Waiting for the next observed lifecycle state.'];
  const article = node('article', 'operation-card'); article.dataset.operationId = op.id;
  const heading = node('div', 'operation-head'); heading.append(node('span', `consumer-icon ${op.consumer === 'license' ? 'license-icon' : ''}`, op.consumer === 'license' ? 'L' : 'M'));
  const title = node('div'); title.append(node('h3', '', op.purpose || consumerName(op)), node('p', '', op.label || op.id));
  heading.append(title, node('span', `badge ${tone}`, status)); article.append(heading);
  const body = node('div', 'operation-body'), amount = node('div', 'request-amount', view === 'owner' && op.amount !== undefined ? display(op.amount) : 'Confidential amount');
  if (view === 'owner' && op.amount !== undefined) amount.append(node('span', '', 'synthetic units'));
  body.append(amount, node('p', 'operation-message', description));
  if (verifiedPaid(op)) {
    const paid = node('div', 'paid-effect'); paid.append(node('span', '', '✓'));
    const copy = node('div'); copy.append(node('strong', '', op.paidEffect.label || 'Exact paid entitlement observed'));
    if (op.paidEffect.kind === 'license' || op.consumer === 'license') {
      copy.append(node('p', '', `${op.paidEffect.licenseActive === false ? 'The paid license has now expired.' : op.paidEffect.licenseActive === true ? 'Product access is active.' : 'Paid license issuance is recorded.'}${op.paidEffect.expirySlot !== undefined ? ` Expiry slot ${display(op.paidEffect.expirySlot)}.` : ''}`));
    } else copy.append(node('p', '', 'The merchant entitlement is issued to this buyer.'));
    paid.append(copy); body.append(paid);
  }
  if (op.error) body.append(node('p', 'operation-error', typeof op.error === 'string' ? op.error : op.error.message || 'The operation reported an error; review its evidence.'));
  if (view === 'owner') {
    const controls = node('div', 'operation-actions');
    for (const action of Array.isArray(op.actions) ? op.actions : []) {
      if (!actionNames[action]) continue;
      const button = node('button', `button ${action.startsWith('approve-') ? 'primary' : 'secondary'}`, actionNames[action]);
      button.type = 'button'; button.dataset.action = action; button.dataset.operation = op.id;
      button.disabled = Boolean(state?.busy || posting || !connectionHealthy);
      button.addEventListener('click', () => requestAction(op, action)); controls.append(button);
    }
    if (['stale', 'denied', 'expired', 'cancelled'].includes(phase)) {
      const fresh = node('button', 'text-button', 'Start a fresh request'); fresh.type = 'button'; fresh.disabled = Boolean(state?.busy || posting || !connectionHealthy);
      fresh.addEventListener('click', () => {
        const radio = $(`input[name=consumer][value=${op.consumer === 'license' ? 'license' : 'merchant'}]`); radio.checked = true;
        if (op.amount !== undefined) $('#amount').value = op.amount;
        $('#prepare-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#amount').focus({ preventScroll: true });
        message('Review the new request, then choose Prepare. No new query has been created.');
      }); controls.append(fresh);
    }
    if (controls.children.length) body.append(controls);
    if (op.actions?.includes('recover')) body.append(node('p', 'field-help', 'Recovery reads retained evidence. It requests no new signatures or private query.'));
  }
  article.append(body);
  const details = node('details', 'operation-details'); details.append(node('summary', '', 'Operation & receipt details'));
  const dl = node('dl', 'details-list');
  for (const [label, value] of [['Operation', op.id], ['Buyer', op.owner], ['Source', op.source], ['Destination', op.destination], ['Effect account', op.effect], ['SDK status', op.sdkStatus || op.observation?.status], ['Observed slot', op.observation?.slot], ['Delivery', op.delivery?.status], ['Signed role', op.delivery?.role], ['Signature', op.delivery?.signature]]) if (value !== undefined && value !== null) detail(dl, label, value, ['Buyer', 'Source', 'Destination', 'Effect account', 'Signature'].includes(label));
  details.append(dl); article.append(details); return article;
}
function render() {
  const operations = Array.isArray(state?.operations) ? state.operations : [];
  $('#prepare-panel').hidden = view !== 'owner'; $('#public-panel').hidden = view !== 'public';
  $('#prepare-button').disabled = !state?.session || Boolean(state?.busy || posting || !connectionHealthy);
  $('#dialog-confirm').disabled = Boolean(state?.busy || posting || !connectionHealthy);
  $('#prepare-button').textContent = state?.busy?.action === 'prepare' ? 'Preparing request…' : 'Prepare request ↗';
  $('#request-count').textContent = state ? String(operations.length) : '—';
  const amount = $('#allowance-value'); amount.replaceChildren(); $('#allowance-label').textContent = view === 'owner' ? 'SHARED ALLOWANCE' : 'PUBLIC OBSERVER PROJECTION';
  const allowanceDetail = $('#allowance-detail'); allowanceDetail.replaceChildren();
  if (view === 'public') {
    amount.append(node('span', '', 'Amounts private'));
    allowanceDetail.textContent = 'Account identities, timing and disclosed policy decisions remain visible.';
    $('#disclosure').textContent = 'Public observer projection, not an access-control boundary. Local execution uses synthetic assets. No real funds or public-network transactions.';
  } else if (state?.session) {
    const initial = state.observerDisclosures?.initialAllowance ?? state.session.initialAllowance;
    amount.append(node('span', '', initial === undefined ? 'Not disclosed' : display(initial)), node('span', 'unit', 'synthetic units initially'));
    const remaining = state.observerDisclosures?.inferredRemaining;
    if (remaining !== undefined) {
      allowanceDetail.append(node('strong', '', display(remaining)), node('span', '', ' units inferred remaining'), document.createElement('br'), node('span', '', 'From known synthetic inputs'));
    } else allowanceDetail.textContent = 'One private allowance shared by independent source owners.';
    $('#disclosure').textContent = `Test-observer disclosure: shown amounts and remaining allowance use synthetic inputs. Remaining allowance is inferred, not a decrypted account balance or MXE state. ${state.observerDisclosures?.note || 'Local execution only; no real funds.'}`;
  } else {
    amount.append(node('span', '', 'Connecting'), node('span', 'unit', 'to local session')); allowanceDetail.textContent = 'Waiting for the actual session state.';
    $('#disclosure').textContent = 'Local demonstration only. No real funds or public-network transactions.';
  }
  const container = $('#operations'), openDetails = new Set([...container.querySelectorAll('details[open]')].map(item => item.closest('article').dataset.operationId));
  const focused = document.activeElement?.dataset;
  container.replaceChildren(); container.setAttribute('aria-busy', String(!state));
  if (!operations.length) {
    const empty = node('div', 'empty-state'); empty.append(node('span', 'empty-icon', '↗'), node('h3', '', state ? 'A request is where it starts' : 'Connecting to your workspace'), node('p', '', state ? view === 'owner' ? 'Prepare a merchant purchase or software license. You’ll approve the private check and final payment separately.' : 'This session has no spending requests yet.' : 'Requests will appear when the local session is available.')); container.append(empty);
  } else for (const op of operations) {
    const card = operationCard(op); if (openDetails.has(op.id)) card.querySelector('details').open = true; container.append(card);
  }
  if (focused?.action && focused?.operation) [...container.querySelectorAll('button[data-action]')].find(button => button.dataset.action === focused.action && button.dataset.operation === focused.operation)?.focus({ preventScroll: true });
  const events = $('#events'); events.replaceChildren();
  const entries = Array.isArray(state?.events) ? state.events.slice(-12).reverse() : [];
  if (!entries.length) events.append(node('li', 'activity-empty', state ? 'No recorded activity yet.' : 'No session events loaded.'));
  for (const event of entries) {
    const row = node('li'), date = new Date(event.at), time = node('time', '', Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    if (!Number.isNaN(date.getTime())) { time.dateTime = date.toISOString(); time.title = date.toLocaleString(); }
    row.append(time, node('span', '', event.message || event.type || 'Operation updated')); events.append(row);
  }
  const session = $('#session-details'); session.replaceChildren();
  if (state?.session) {
    for (const [term, value] of [['Session', state.session.id], ['Genesis', state.session.genesis], ['Profile', state.session.profile], ['Loaded programs', state.session.loadedPrograms], ['Scope', state.session.scope]]) if (value !== undefined) detail(session, term, typeof value === 'object' ? JSON.stringify(value) : value);
  }
}
async function refresh(force = false) {
  if (fetching && !force) return;
  const current = ++generation, requestedView = view; fetching = true;
  try {
    const response = await fetch(`/api/state?view=${requestedView}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw Error(`Local session unavailable (${response.status}).`);
    const next = await response.json();
    if (current !== generation || requestedView !== view) return;
    if (next.schema !== 1 || next.view !== requestedView || next.session?.local !== true) throw Error('The server did not return the supported local session profile.');
    const reconnected = !connectionHealthy; connectionHealthy = true; $('#connection-message').hidden = true; state = next;
    const serialized = JSON.stringify(next);
    if (serialized !== lastRendered || force || reconnected) { lastRendered = serialized; render(); }
  } catch (error) {
    if (current !== generation) return;
    connectionHealthy = false;
    $('#connection-message').textContent = `${error.message} No new action will be submitted until the connection is restored.`; $('#connection-message').hidden = false;
    $('#prepare-button').disabled = true; $('#operations').querySelectorAll('button').forEach(button => { button.disabled = true; });
    $('#dialog-confirm').disabled = true;
  } finally { if (current === generation) fetching = false; }
}
async function post(path, payload) {
  if (posting || state?.busy || view !== 'owner' || !$('#connection-message').hidden) return;
  posting = true; render();
  try {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'local-approvals' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(typeof body.error === 'string' ? body.error : body.error?.message || body.message || `Action rejected (${response.status}).`);
    message(response.status === 202 ? 'Action accepted. Follow the actual lifecycle below; acceptance is not confirmation of payment.' : 'Action recorded. Refreshing the observed state.');
  } catch (error) { message(`${error.message} If delivery is uncertain, recover the saved operation. Do not assume it failed.`, true); }
  finally { posting = false; await refresh(true); render(); }
}
function requestAction(op, action) {
  if (['observe', 'recover'].includes(action)) { void post(`/api/operations/${encodeURIComponent(op.id)}/${action}`, {}); return; }
  dialogAction = { op, action }; $('#dialog-facts').replaceChildren(); $('#lose-response').checked = false; $('#loss-option').hidden = action !== 'approve-commit';
  const descriptions = {
    'approve-query': ['Authorize this private check', 'The buyer and policy administrator approve this exact query. Its result may disclose allow or deny. This does not pay the application.'],
    'approve-commit': ['Approve this exact payment', 'The buyer approves the confidential payment and its requested application effect together. Completion requires an observed paid entitlement.'],
    'resubmit-query': ['Resubmit the saved query', 'Send the identical signed bytes again. This cannot create a new query, change its scope or refresh an expired approval.'],
    'resubmit-commit': ['Resubmit the saved payment', 'Send the identical signed payment bytes again. This does not create a replacement payment or authorize different terms.'],
    cancel: ['Cancel this operation', 'Request cancellation of this retained operation. The observed lifecycle will confirm its outcome; cancellation does not undo a completed payment.'],
  };
  const [title, description] = descriptions[action]; $('#dialog-title').textContent = title; $('#dialog-description').textContent = description;
  detail($('#dialog-facts'), 'Application', op.purpose || consumerName(op));
  if (op.amount !== undefined) detail($('#dialog-facts'), 'Amount', `${display(op.amount)} synthetic units`);
  for (const [term, value] of [['Buyer', op.owner], ['Recipient', op.destination], ['Effect', op.effect], ['Operation', op.id]]) if (value) detail($('#dialog-facts'), term, value);
  $('#dialog-confirm').textContent = actionNames[action]; $('#dialog-confirm').disabled = Boolean(state?.busy || posting || !connectionHealthy);
  $('#approval-dialog').showModal(); $('#dialog-cancel').focus();
}
$('#dialog-confirm').addEventListener('click', () => {
  if (!dialogAction) return;
  const { op, action } = dialogAction;
  const payload = action === 'approve-query' ? { approvalDigest: op.approvalDigest } : action === 'approve-commit' ? { approvalDigest: op.commitApprovalDigest, loseResponse: $('#lose-response').checked } : {};
  if (action.startsWith('approve-') && !payload.approvalDigest) { message('The retained approval digest is unavailable. Refresh and recover the operation before approving.', true); $('#approval-dialog').close(); return; }
  $('#approval-dialog').close(); dialogAction = null; void post(`/api/operations/${encodeURIComponent(op.id)}/${action}`, payload);
});
$('#dialog-cancel').addEventListener('click', () => $('#approval-dialog').close());
$('#approval-dialog').addEventListener('close', () => { dialogAction = null; });
$('#prepare-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const amount = Number($('#amount').value); if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100) { message('Choose a whole synthetic amount from 1 to 100.', true); return; }
  void post('/api/prepare', { consumer: new FormData(form).get('consumer'), amount, requestId: crypto.randomUUID() });
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  if (button.dataset.view === view) return;
  view = button.dataset.view; state = null; lastRendered = ''; connectionHealthy = false; $('#approval-dialog').close(); $('#dialog-facts').replaceChildren(); message('');
  for (const choice of document.querySelectorAll('[data-view]')) choice.setAttribute('aria-pressed', String(choice.dataset.view === view));
  render(); void refresh(true);
});
$('#refresh').addEventListener('click', () => { void refresh(true); });
$('#session-details-button').addEventListener('click', event => {
  const open = $('#session-details').hidden; $('#session-details').hidden = !open; event.currentTarget.setAttribute('aria-expanded', String(open));
});
void refresh(); setInterval(() => { void refresh(); }, 1500);
