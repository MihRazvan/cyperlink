#!/usr/bin/env node
/** Real local reference-policy browser qualification. Requires an empty Console workspace.
 * Signs synthetic local actions through visible UI consent; never injects SDK results.
 * Browser tooling is an explicit external path, not a product dependency.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { validateOperation } from '../../packages/policy-client/src/sdk.mjs';
import { snapshot, callback } from '../../examples/policies/qualification/evidence.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(process.argv[i].startsWith('--') && process.argv[i + 1]);
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const key of ['playwright', 'browser', 'instance', 'workspace', 'output', 'remaining', 'amount', 'sku', 'product']) assert(options[key], `Missing --${key}`);
const url = options.url ?? 'http://127.0.0.1:4321';
assert.equal(new URL(url).hostname, '127.0.0.1');
const instancePath = resolve(options.instance), workspace = resolve(options.workspace), out = resolve(options.output);
assert(out.startsWith(resolve('.local') + '/') && workspace.startsWith(resolve('.local') + '/'));
await mkdir(out, { mode: 0o700 }); // Never overwrite a failed run.
const json = async path => JSON.parse(await readFile(path));
const instance = await json(instancePath), req = createRequire(resolve(instance.moduleRoot, 'package.json'));
const web3 = req('@solana/web3.js'), anchor = req('@anchor-lang/core');
const connection = new web3.Connection(instance.endpoint, 'confirmed');
const { convertIdlToCamelCase } = req('@anchor-lang/core/dist/cjs/idl.js');
const idl = convertIdlToCamelCase(await json(instance.idl));
const program = new anchor.Program(idl, { connection });
const { chromium } = await import(pathToFileURL(resolve(options.playwright)));
const browser = await chromium.launch({ executablePath: resolve(options.browser), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
const amount = Number(options.amount), remaining = Number(options.remaining);
assert(Number.isSafeInteger(amount) && amount > 0 && amount * 2 <= remaining && amount <= 40);
const evidence = { schema: 1, classification: 'real-local-browser-sdk-journey', passed: false, instancePath, workspace,
  observerDisclosures: { syntheticReferencePolicy: true, initialRemaining: remaining, purchaseCap: 40, amounts: [50, amount, amount, amount] },
  steps: [], browserErrors: [], operations: [], accountSnapshots: [], transactions: [], callbacks: [] };
page.on('pageerror', e => evidence.browserErrors.push(e.message));
const save = () => writeFile(resolve(out, 'journey.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
async function state() { const response = await page.request.get(`${url}/api/state`); assert.equal(response.status(), 200); return response.json(); }
async function wait(title, predicate) {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const op = (await state()).operations.find(o => o.title === title);
    if (op?.error) throw Error(`${title}: ${JSON.stringify(op.error)}`);
    if (op && predicate(op)) { evidence.steps.push({ title, at: new Date().toISOString(), operation: op }); await save(); console.log(title, op.phase); return op; }
    await page.waitForTimeout(1000);
  }
  throw Error(`Timed out: ${title}`);
}
async function closeDialogs() {
  for (const id of ['#confirm-dialog', '#detail-dialog', '#create-dialog']) if (await page.locator(id).evaluate(el => el.open)) await page.locator(`${id} [data-close]`).first().click();
}
async function create(title, value, source, license = false) {
  await closeDialogs(); await page.locator('[data-new]:visible').first().click();
  await page.locator('#title').fill(title); await page.locator('#amount').fill(String(value)); await page.locator('#source').selectOption(source);
  if (license) { await page.locator('#consumer').selectOption('license'); await page.locator('#product').fill(options.product); await page.locator('#suggest-expiry').click(); }
  else await page.locator('#sku').fill(String(BigInt(options.sku) + (value === 50 ? 0n : 1n)));
  await page.locator('#create-submit').click(); await page.waitForFunction(() => !document.querySelector('#create-review').hidden);
  await page.screenshot({ path: resolve(out, `${title.replaceAll(' ', '-')}-review.png`) });
  await page.locator('#create-submit').click();
  const op = await wait(title, o => !o.busy && Boolean(o.planHash));
  const plan = await json(resolve(workspace, 'operations', op.id, 'operation-plan.json'));
  evidence.operations.push({ id: op.id, label: title, plan }); await save(); return op;
}
const planFor = op => evidence.operations.find(item => item.id === op.id).plan;
async function snap(op, label) {
  const d = planFor(op).descriptor, t = validateOperation(d).template;
  return snapshot(connection, [d.job, d.permit, d.quota, d.effect, t.source, t.destination].map(k => new web3.PublicKey(k)), label, evidence, save);
}
async function receipt(op, role) {
  const signature = op.deliveries[role].signature;
  const transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  assert(transaction && transaction.meta.err === null);
  evidence.transactions.push({ label: `${op.title}-${role}`, signature, slot: transaction.slot, transaction }); await save();
}
async function action(op, action) {
  await closeDialogs(); await page.locator(`[data-operation-id="${op.id}"]:visible`).first().click();
  await page.locator(`[data-action="${action}"]`).click();
  if (await page.locator('#confirm-dialog').evaluate(el => el.open)) await page.locator('#confirm-submit').click();
  await page.waitForTimeout(300);
  const error = page.locator('#confirm-error'); if (await error.isVisible()) throw Error(await error.innerText());
}
async function query(op, allowed) {
  await snap(op, `${op.title}-query-before`); const started = Date.now(); await action(op, 'approve-query');
  op = await wait(op.title, o => o.observation?.status === (allowed ? 'authorized' : 'denied'));
  await snap(op, `${op.title}-callback-after`); await receipt(op, 'query');
  await callback({ session: { connection, web3 }, program }, { label: op.title, plan: planFor(op) }, allowed ? 1 : 2, started, evidence, save);
  return op;
}
async function pay(op) {
  await snap(op, `${op.title}-payment-before`); await action(op, 'approve-payment');
  op = await wait(op.title, o => o.observation?.status === 'committed');
  await snap(op, `${op.title}-payment-after`); await receipt(op, 'commit'); return op;
}
try {
  await page.goto(url); await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Connected');
  assert.equal((await state()).operations.length, 0, 'Use a fresh workspace, preserve previous runs');
  await query(await create('Funded policy denial', 50, 'a'), false);
  let a = await query(await create('Design asset purchase', amount, 'a'), true);
  let b = await query(await create('Competing license', amount, 'b', true), true);
  a = await pay(a); b = await wait(b.title, o => o.observation?.status === 'stale'); assert(!b.actions.includes('approve-payment'));
  let fresh = await create('Fresh license approval', amount, 'b', true);
  const old = (await state()).operations.find(o => o.id === b.id);
  assert.equal(old.supersededBy, fresh.id); assert.equal(old.historicalObservation.status, 'stale'); assert.equal(old.observation, null); assert.deepEqual(old.actions, []);
  fresh = await pay(await query(fresh, true)); assert.equal(fresh.observation.licenseActive, true);
  const originalDelivery = fresh.deliveries.commit;
  await action(fresh, 'recover-payment'); fresh = await wait(fresh.title, o => !o.busy && o.deliveries.commit?.status === 'landed');
  assert.equal(fresh.deliveries.commit.signature, originalDelivery.signature); assert.equal(fresh.deliveries.commit.wireSha256, originalDelivery.wireSha256);
  await closeDialogs(); await page.locator('[data-view="payments"]').click(); await page.screenshot({ path: resolve(out, 'paid-inbox.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: resolve(out, 'mobile-inbox.png'), fullPage: true });
  evidence.final = await state(); assert.equal(evidence.final.operations.filter(o => o.paymentCommitted).length, 2);
  assert(evidence.final.operations.every(o => !o.error)); assert.deepEqual(evidence.browserErrors, []);
  evidence.passed = true; await save(); console.log('BROWSER JOURNEY PASSED');
} catch (error) {
  evidence.failure = error.message; await save(); await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); console.error(error.stack); process.exitCode = 1;
} finally { await browser.close(); }
