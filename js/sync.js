// Sharing between phones, through Firebase. Everything still saves on the
// phone first, so the app works the same offline or with sharing off.
// The Firebase code only loads once this phone has started or joined a trip.
(function () {
  'use strict';

  const config = window.FIREBASE_CONFIG;
  const KEYS = {
    todos: 'set', packed: 'set', packExtras: 'set', favs: 'set', visited: 'set',
    journal: 'map', foodLog: 'map',
    customFood: 'list', spend: 'list', refs: 'list', people: 'list',
  };
  const SDK = ['vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js'];

  const key = (name) => `carnet:${name}`;
  const read = (name, fallback) => {
    try { const raw = localStorage.getItem(key(name)); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  };
  const write = (name, value) => {
    try {
      if (value === undefined) localStorage.removeItem(key(name));
      else localStorage.setItem(key(name), JSON.stringify(value));
    } catch (e) { /* storage full or blocked */ }
  };

  let hooks = { onData() {}, onStatus() {} };
  let sdk = null;
  let db = null;
  let user = null;
  let engine = null;
  const meta = {};
  let status = { state: config ? 'local' : 'off', text: '' };

  function setStatus(state, text = '') {
    status = { state, text };
    hooks.onStatus(status);
  }

  function refreshStatus() {
    if (!engine) return;
    const metas = Object.values(meta);
    if (metas.length < Object.keys(KEYS).length) { setStatus('connecting', 'Connecting…'); return; }
    const pending = metas.some((m) => m.hasPendingWrites);
    if (!navigator.onLine) setStatus('offline', pending ? "Offline. Your changes will sync when you're back online." : 'Offline. Showing what was last synced.');
    else if (pending) setStatus('saving', 'Saving…');
    else if (metas.some((m) => m.fromCache)) setStatus('connecting', 'Connecting…');
    else setStatus('synced', 'Synced');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(tag);
    });
  }

  async function ready() {
    if (db) return;
    if (!sdk) sdk = SDK.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve());
    await sdk;
    const fb = window.firebase;
    if (!fb.apps.length) fb.initializeApp(config);
    db = fb.firestore();
    db.settings({ ignoreUndefinedProperties: true, merge: true });
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* private mode or another tab: online only */ }
  }

  async function signIn() {
    const auth = window.firebase.auth();
    user = await new Promise((resolve) => { const off = auth.onAuthStateChanged((u) => { off(); resolve(u); }); });
    if (!user) user = (await auth.signInAnonymously()).user;
    return user;
  }

  const tripRef = (id) => db.collection('trips').doc(id);

  function newTripId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  // Firestore wants its own delete marker.
  function toFirestore(changes) {
    const out = {};
    Object.keys(changes).forEach((k) => {
      const v = changes[k];
      if (v === window.SyncCore.DEL) out[k] = window.firebase.firestore.FieldValue.delete();
      else out[k] = window.SyncCore.isObj(v) ? toFirestore(v) : v;
    });
    return out;
  }

  function backend(tripId) {
    const state = tripRef(tripId).collection('state');
    return {
      listen(name, onData, onError) {
        return state.doc(name).onSnapshot({ includeMetadataChanges: true }, (snap) => {
          onData(snap.exists ? (snap.data().v || {}) : {}, { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
        }, onError);
      },
      write: (name, changes) => state.doc(name).set({ v: toFirestore(changes) }, { merge: true }),
    };
  }

  // Joining is an update that only adds this phone to the member list. The
  // rules allow that to anyone who knows the trip's id, which is the invite.
  async function ensureMember(tripId) {
    if (read('sync:member') === user.uid) return;
    await tripRef(tripId).update({ members: window.firebase.firestore.FieldValue.arrayUnion(user.uid) });
    write('sync:member', user.uid);
  }

  function lostAccess() {
    stopEngine();
    write('sync:member', undefined);
    setStatus('error', "This phone lost access to the shared trip. Open your invite link again to rejoin.");
  }

  function startEngine(tripId) {
    stopEngine();
    engine = new window.SyncCore.Engine({
      keys: KEYS,
      storage: {
        get: (name) => read(name, undefined),
        set: (name, value) => write(name, value),
        getBase: (name) => read(`sync:base:${name}`, undefined),
        setBase: (name, value) => write(`sync:base:${name}`, value),
      },
      backend: backend(tripId),
      onData: (keys) => hooks.onData(keys),
      onMeta: (name, m) => { meta[name] = m; refreshStatus(); },
      onError: (err) => {
        if (err && err.code === 'permission-denied') lostAccess();
        else setStatus('error', `Sync problem: ${(err && err.message) || err}`);
      },
    });
    engine.start();
    refreshStatus();
    uploadPhotos();
  }

  function stopEngine() {
    if (engine) { engine.flushAll(); engine.stop(); engine = null; }
    Object.keys(meta).forEach((k) => delete meta[k]);
  }

  async function connect(tripId) {
    setStatus('connecting', 'Connecting…');
    await ready();
    await signIn();
    await ensureMember(tripId);
    startEngine(tripId);
  }

  function explain(err) {
    const code = err && err.code;
    if (code === 'not-found') return "That invite link doesn't match a shared trip. Ask for a new one.";
    if (code === 'permission-denied') return "That invite link didn't work. The trip may be full, or the link may be wrong.";
    if (code === 'unavailable' || !navigator.onLine) return 'You need to be online for this. Try again once you have signal.';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return 'Sharing is not switched on in Firebase yet (anonymous sign-in is off).';
    return `Something went wrong: ${(err && err.message) || err}`;
  }

  /* ---------- photos ---------- */
  // Photos are kept as their own documents, as base64 JPEG, so the free plan is enough.
  const photos = () => tripRef(read('sync:trip')).collection('photos');
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const base64ToBlob = (data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  };

  async function putPhoto(id, blob, food) {
    if (!engine) return;
    const uploaded = read('sync:photosUp', []);
    if (uploaded.includes(id)) return;
    await photos().doc(id).set({ data: await blobToBase64(blob), food, at: Date.now() });
    write('sync:photosUp', [...read('sync:photosUp', []), id]);
  }

  async function getPhoto(id) {
    if (!engine) return null;
    const snap = await photos().doc(id).get();
    return snap.exists ? base64ToBlob(snap.data().data) : null;
  }

  function deletePhoto(id) {
    if (!engine) return;
    photos().doc(id).delete().catch(() => {});
    write('sync:photosUp', read('sync:photosUp', []).filter((p) => p !== id));
  }

  // Sends any photo saved on this phone that the trip doesn't have yet.
  let photoSource = null;
  async function uploadPhotos() {
    if (!engine || !photoSource) return;
    const uploaded = read('sync:photosUp', []);
    const log = read('foodLog', {});
    for (const [food, entry] of Object.entries(log)) {
      for (const id of Object.keys((entry && entry.photos) || {})) {
        if (uploaded.includes(id)) continue;
        try {
          const blob = await photoSource(id);
          if (blob) await putPhoto(id, blob, food);
        } catch (e) { /* try again next time */ }
      }
    }
  }

  /* ---------- public ---------- */
  window.CarnetSync = {
    configured: Boolean(config),
    keys: KEYS,
    get status() { return status; },
    get tripId() { return read('sync:trip', null); },
    get active() { return Boolean(engine); },
    inviteLink() {
      const id = read('sync:trip', null);
      return id ? `${location.origin}${location.pathname}#join/${id}` : '';
    },

    init(options) {
      hooks = { ...hooks, ...options };
      photoSource = options.readPhoto || null;
      const id = read('sync:trip', null);
      if (config && id) connect(id).catch((err) => setStatus('error', explain(err)));
      window.addEventListener('online', refreshStatus);
      window.addEventListener('offline', refreshStatus);
      document.addEventListener('visibilitychange', () => { if (document.hidden && engine) engine.flushAll(); });
    },

    changed(name) { if (engine) engine.changed(name); },

    async create() {
      if (!config) throw new Error('Sharing is not set up');
      try {
        setStatus('connecting', 'Setting up…');
        await ready();
        await signIn();
        const id = newTripId();
        await tripRef(id).set({ members: [user.uid], created: window.firebase.firestore.FieldValue.serverTimestamp() });
        write('sync:trip', id);
        write('sync:member', user.uid);
        startEngine(id);
        return id;
      } catch (err) {
        setStatus('local');
        throw new Error(explain(err));
      }
    },

    async join(id) {
      if (!config) throw new Error('Sharing is not set up');
      const previous = read('sync:trip', null);
      if (previous === id) {
        try { await connect(id); } catch (err) { setStatus('error', explain(err)); throw new Error(explain(err)); }
        return;
      }
      // Join first, and only switch this phone over once that worked, so a
      // bad link leaves the current trip as it was.
      try {
        if (!engine) setStatus('connecting', 'Joining…');
        await ready();
        await signIn();
        await tripRef(id).update({ members: window.firebase.firestore.FieldValue.arrayUnion(user.uid) });
      } catch (err) {
        if (engine) refreshStatus();
        else setStatus(previous ? 'error' : 'local', previous ? explain(err) : '');
        throw new Error(explain(err));
      }
      stopEngine();
      Object.keys(KEYS).forEach((name) => write(`sync:base:${name}`, undefined));
      write('sync:photosUp', []);
      write('sync:trip', id);
      write('sync:member', user.uid);
      startEngine(id);
    },

    leave() {
      stopEngine();
      ['sync:trip', 'sync:member'].forEach((name) => write(name, undefined));
      Object.keys(KEYS).forEach((name) => write(`sync:base:${name}`, undefined));
      write('sync:photosUp', []);
      setStatus('local');
    },

    putPhoto: (id, blob, food) => putPhoto(id, blob, food).catch(() => {}),
    getPhoto: (id) => getPhoto(id).catch(() => null),
    deletePhoto,
  };
}());
