// Merging logic for syncing saved data between phones. It has no Firebase code
// in it, so it can be tested on its own.
//
// Each saved key is kept remotely as a nested map, and only the leaves that
// changed are written. Two people editing different things at the same time
// therefore never overwrite each other. A copy of the last remote value seen
// (the "base") is kept on the phone, so edits made offline can be told apart
// from edits the other person made, and are replayed on top of theirs.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const DEL = Object.freeze({ syncDelete: true });
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && v !== DEL;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // The changes that turn a into b. Removed keys are marked with DEL.
  function diff(a, b) {
    const A = isObj(a) ? a : {};
    const B = isObj(b) ? b : {};
    const out = {};
    let changed = false;
    Object.keys(B).forEach((k) => {
      if (isObj(A[k]) && isObj(B[k])) {
        const d = diff(A[k], B[k]);
        if (d) { out[k] = d; changed = true; }
      } else if (!(k in A) || !same(A[k], B[k])) {
        out[k] = clone(B[k]);
        changed = true;
      }
    });
    Object.keys(A).forEach((k) => {
      if (!(k in B)) { out[k] = DEL; changed = true; }
    });
    return changed ? out : undefined;
  }

  // Applies changes the way Firestore's set with merge does: maps merge, and
  // anything else replaces what was there.
  function apply(base, changes) {
    const out = isObj(base) ? { ...base } : {};
    Object.keys(changes || {}).forEach((k) => {
      const v = changes[k];
      if (v === DEL) delete out[k];
      else if (isObj(v)) out[k] = apply(isObj(out[k]) ? out[k] : {}, v);
      else out[k] = clone(v);
    });
    return out;
  }

  // How each kind of saved value maps to a remote nested map.
  const KINDS = {
    // A list of strings, such as ticked to-dos. Kept as { item: time added }.
    set: {
      toRemote(list, base) {
        const known = isObj(base) ? base : {};
        const out = {};
        let t = Date.now();
        (Array.isArray(list) ? list : []).forEach((item) => {
          if (typeof item !== 'string' || !item) return;
          out[item] = typeof known[item] === 'number' ? known[item] : t++;
        });
        return out;
      },
      fromRemote(map) {
        const m = isObj(map) ? map : {};
        return Object.keys(m).filter((k) => m[k]).sort((x, y) => (Number(m[x]) - Number(m[y])) || (x < y ? -1 : 1));
      },
    },
    // A list of records that each have an id, such as expenses. Kept as { id: record }.
    list: {
      toRemote(list) {
        const out = {};
        (Array.isArray(list) ? list : []).forEach((item) => {
          if (isObj(item) && item.id) out[item.id] = clone(item);
        });
        return out;
      },
      fromRemote(map) {
        const m = isObj(map) ? map : {};
        return Object.values(m).filter(isObj)
          .sort((x, y) => ((x.at || 0) - (y.at || 0)) || String(x.id).localeCompare(String(y.id)));
      },
    },
    // Anything already shaped as a map, such as the journal.
    map: {
      toRemote: (value) => (isObj(value) ? clone(value) : {}),
      fromRemote: (map) => (isObj(map) ? map : {}),
    },
  };

  const localChanged = (kind, before, after) => (kind === 'map'
    ? Boolean(diff(before || {}, after) || diff(after, before || {}))
    : !same(before || [], after));

  /*
   * Engine keeps saved keys in step with a backend.
   *   keys:    { name: 'set' | 'list' | 'map' }
   *   storage: { get(key), set(key, value), getBase(key), setBase(key, value) }
   *   backend: { listen(key, onData(map, meta), onError) -> stop, write(key, changes) -> Promise }
   *   onData:  called with the keys that changed on this phone because of the other person
   */
  class Engine {
    constructor({ keys, storage, backend, onData = () => {}, onMeta = () => {}, onError = () => {}, delay = 700 }) {
      Object.assign(this, { keys, storage, backend, onData, onMeta, onError, delay });
      this.timers = {};
      this.ready = {};
      this.stops = [];
    }

    start() {
      this.stops = Object.keys(this.keys).map((key) => this.backend.listen(
        key,
        (data, meta) => this.received(key, data, meta),
        (err) => this.onError(err, key),
      ));
    }

    stop() {
      Object.keys(this.timers).forEach((key) => clearTimeout(this.timers[key]));
      this.timers = {};
      this.stops.forEach((stop) => stop && stop());
      this.stops = [];
    }

    localRemote(key) {
      return KINDS[this.keys[key]].toRemote(clone(this.storage.get(key)), this.storage.getBase(key));
    }

    received(key, data, meta = {}) {
      const kind = this.keys[key];
      const remote = isObj(data) ? data : {};
      const base = this.storage.getBase(key) || {};
      const mine = diff(base, this.localRemote(key));
      const merged = mine ? apply(remote, mine) : remote;
      const before = this.storage.get(key);
      const after = KINDS[kind].fromRemote(merged);
      this.storage.setBase(key, remote);
      this.ready[key] = true;
      if (localChanged(kind, before, after)) {
        this.storage.set(key, after);
        this.onData([key]);
      }
      if (mine) this.schedule(key);
      this.onMeta(key, meta);
    }

    changed(key) {
      if (key in this.keys) this.schedule(key);
    }

    schedule(key) {
      clearTimeout(this.timers[key]);
      this.timers[key] = setTimeout(() => this.flush(key), this.delay);
    }

    // The base is not moved forward here. The snapshot that echoes this write
    // does that, so a write lost before it was queued is simply sent again.
    flush(key) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
      if (!this.ready[key]) return Promise.resolve(false);
      const changes = diff(this.storage.getBase(key) || {}, this.localRemote(key));
      if (!changes) return Promise.resolve(false);
      return Promise.resolve(this.backend.write(key, changes)).then(() => true, (err) => { this.onError(err, key); return false; });
    }

    flushAll() {
      return Promise.all(Object.keys(this.timers).map((key) => this.flush(key)));
    }
  }

  return { DEL, isObj, diff, apply, KINDS, Engine };
}));
