import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProgressSync, type SyncState } from '../src/lib/sync';
import type { Location, Operation, Pending, Progress, SaveResult } from '../src/lib/types';
const at = (page: number): Location => ({ version: 1, type: 'pdf', page, x: 0, y: 1, progression: page / 100 });
const start = (): Progress => ({ book_id: 'book', user_id: 'user', location: at(2), revision: 1, progression: .02, last_read_at: null, completed_at: null });
function fixture(send?: (o: Operation) => Promise<SaveResult>, pending?: Pending) {
  let remote = start(); let saved: Pending | null = null; let count = 0;
  const states: SyncState[] = []; const calls: Operation[] = [];
  const sync = new ProgressSync('user', 'book', 'new-session', remote, {
    uuid: () => `operation-${++count}`,
    persist: async p => { saved = structuredClone(p); }, clear: async () => { saved = null; },
    changed: s => { states.push(s); },
    send: async o => { calls.push(structuredClone(o)); if (send) return send(o); if (o.expectedRevision !== remote.revision) return { outcome: 'conflict', progress: remote }; remote = { ...remote, revision: remote.revision + 1, location: o.location, progression: o.location.progression }; return { outcome: 'accepted', progress: remote }; }
  }, pending);
  return { sync, calls, states, saved: () => saved, remote: () => remote, setRemote: (p: Progress) => { remote = p; } };
}
test('restoring/opening a book does not save progress', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); await f.sync.flush(); assert.equal(f.calls.length, 0);
});
test('a successful save advances the server revision and clears recovery data', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); f.sync.move(at(12)); await f.sync.flush(); assert.equal(f.remote().revision, 2); assert.deepEqual(f.remote().location, at(12)); assert.equal(f.saved(), null); assert.equal(f.states.at(-1), 'synced');
});
test('reading backward is a valid save, not furthest-page-wins', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); f.sync.move(at(1)); await f.sync.flush(); assert.deepEqual(f.remote().location, at(1));
});
test('an offline retry preserves the same operation ID and payload', async t => {
  let fail = true; const f = fixture(async o => { if (fail) throw new Error('offline'); return { outcome: 'accepted', progress: { ...start(), revision: 2, location: o.location } }; }); t.after(() => f.sync.stop());
  f.sync.move(at(15)); await f.sync.flush(); assert.equal(f.states.at(-1), 'local'); assert.ok(f.saved()); fail = false; await f.sync.flush(); assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.states.at(-1), 'synced');
});
test('a lost acknowledgement is replayed without creating another operation', async t => {
  let receipt: SaveResult | null = null;
  const f = fixture(async o => { if (receipt) return receipt; receipt = { outcome: 'accepted', progress: { ...start(), revision: 2, location: o.location } }; throw new Error('acknowledgement lost'); }); t.after(() => f.sync.stop());
  f.sync.move(at(20)); await f.sync.flush(); await f.sync.flush(); assert.equal(f.calls[0].operationId, f.calls[1].operationId); assert.equal(f.sync.progress.revision, 2);
});
test('changes during an in-flight request coalesce and save after its acknowledgement', async t => {
  let complete!: (r: SaveResult) => void; let first = true;
  const f = fixture(async o => { if (first) { first = false; return new Promise(resolve => { complete = resolve; }); } return { outcome: 'accepted', progress: { ...start(), revision: 3, location: o.location } }; }); t.after(() => f.sync.stop());
  f.sync.move(at(10)); const request = f.sync.flush(); while (!complete) await new Promise(resolve => setImmediate(resolve));
  f.sync.move(at(11)); f.sync.move(at(12)); await f.sync.flush(); assert.equal(f.calls.length, 1);
  complete({ outcome: 'accepted', progress: { ...start(), revision: 2, location: at(10) } }); await request;
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].location, at(12)); assert.equal(f.calls[1].expectedRevision, 2); assert.equal(f.saved(), null);
});
test('a revision conflict does not automatically overwrite the other device', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); f.setRemote({ ...start(), revision: 8, location: at(80) });
  f.sync.move(at(25)); await f.sync.flush(); await f.sync.flush(); assert.equal(f.calls.length, 1); assert.equal(f.remote().revision, 8); assert.equal(f.states.at(-1), 'conflict'); assert.ok(f.saved());
});
test('keeping local progress creates a new operation using the reviewed remote revision', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); f.setRemote({ ...start(), revision: 8, location: at(80) }); f.sync.move(at(25)); await f.sync.flush(); await f.sync.resolve(true);
  assert.notEqual(f.calls[0].operationId, f.calls[1].operationId); assert.equal(f.calls[1].expectedRevision, 8); assert.deepEqual(f.remote().location, at(25));
});
test('choosing remote clears local pending writes and returns the remote anchor', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); const remote = { ...start(), revision: 8, location: at(80) }; f.setRemote(remote); f.sync.move(at(25)); await f.sync.flush(); const restored = await f.sync.resolve(false);
  assert.deepEqual(restored, at(80)); assert.equal(f.saved(), null); assert.equal(f.calls.length, 1);
});
test('reopening with a pending write retries the original session operation', async t => {
  const op: Operation = { operationId: 'old-operation', sessionId: 'old-session', sequence: 13, expectedRevision: 1, location: at(40) };
  const f = fixture(undefined, { key: 'user:book', userId: 'user', bookId: 'book', operation: op, savedAt: new Date().toISOString() }); t.after(() => f.sync.stop());
  assert.deepEqual(f.sync.location, at(40)); await f.sync.flush(); assert.deepEqual(f.calls[0], op);
});
test('observing another device prompts a choice without moving the active reader', async t => {
  const f = fixture(); t.after(() => f.sync.stop()); await f.sync.observeRemote({ ...start(), revision: 9, location: at(90) }); assert.deepEqual(f.sync.location, at(2)); assert.equal(f.states.at(-1), 'conflict'); assert.equal(f.calls.length, 0);
});
test('a stopped controller cannot issue new saves', async () => { const f = fixture(); f.sync.stop(); f.sync.move(at(10)); await f.sync.flush(); assert.equal(f.calls.length, 0); });
test('failed device persistence is never labelled as saved on this device', async t => {
  const states: SyncState[] = []; let sends = 0;
  const sync = new ProgressSync('user','book','session',start(),{uuid:()=> 'id',persist:async()=>{throw new Error('quota');},clear:async()=>{},changed:s=>states.push(s),send:async()=>{sends++;return {outcome:'accepted',progress:start()};}});
  t.after(()=>sync.stop()); sync.move(at(10)); await sync.flush(); assert.equal(states.at(-1),'error'); assert.equal(sends,0);
});
test('expired pending sessions recover through a new session and explicit position choice', async t => {
  const calls: Operation[]=[];const states: SyncState[]=[];let uuid=0;
  const sync=new ProgressSync('user','book','expired-session',start(),{uuid:()=>String(++uuid),persist:async()=>{},clear:async()=>{},changed:s=>states.push(s),reopen:async()=>({sessionId:'fresh-session',progress:{...start(),revision:4,location:at(40)}}),send:async op=>{calls.push(op);if(op.sessionId==='expired-session')throw new Error('Session expired; reopen the book');return {outcome:'accepted',progress:{...start(),revision:5,location:op.location}};}});
  t.after(()=>sync.stop());sync.move(at(10));await sync.flush();assert.equal(states.at(-1),'conflict');assert.equal(calls.length,1);await sync.resolve(true);assert.equal(calls[1].sessionId,'fresh-session');assert.equal(calls[1].expectedRevision,4);assert.equal(calls[1].sequence,1);
});
