// Firebase Auth + Firestore real-time persistence + Google Drive 'Cloud Clips' auto-sync
// Bundled via esbuild into /public/firebase-client.js and exposed on window.gatherCloud.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com';
const CLOUD_CLIPS_FOLDER = 'Cloud Clips';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

// In-memory ONLY Google Drive OAuth token (never stored in localStorage or sessionStorage)
let cachedDriveToken = '';
let cachedDriveExp = 0;
let cachedDriveFolderId = '';

const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error, operationType, path) {
  const user = auth.currentUser;
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid || null,
      email: user?.email || null,
      emailVerified: user?.emailVerified ?? null,
      isAnonymous: user?.isAnonymous ?? null,
      tenantId: user?.tenantId || null,
      providerInfo: (user?.providerData || []).map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })),
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// ---- Defensive Payload Sanitization (synced verbatim with firebase-blueprint.json) ----
function sanitizeId(raw, fallbackPrefix = 'item') {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || `${fallbackPrefix}_${Date.now().toString(36)}`;
}

function sceneDocId(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  let hash = 0;
  const s = String(name || 'scene');
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return sanitizeId(`sc_${slug || 'scene'}_${Math.abs(hash).toString(36)}`, 'sc');
}

function cleanElements(elements) {
  if (!Array.isArray(elements)) return [];
  const out = [];
  for (const el of elements.slice(0, 24)) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
    const copy = {};
    for (const [k, v] of Object.entries(el)) {
      if (k === '_data') continue; // never store large base64 images inside Firestore docs
      if (v === undefined) continue;
      if (typeof v === 'string') copy[k] = v.slice(0, 400);
      else if (typeof v === 'number' && Number.isFinite(v)) copy[k] = v;
      else if (typeof v === 'boolean' || v === null) copy[k] = v;
    }
    if (Object.keys(copy).length) out.push(copy);
  }
  return out;
}

// ---- Runtime State & Subscriptions ----
const state = {
  ready: false,
  user: null,
  profile: null,
  paymentSettings: null,
  scenes: [],
  mediaLibrary: [],
  triggers: [],
  highlights: [],
  cloudClips: [],
  syncingCount: 0,
};

const listeners = new Set();
const unsubs = [];
const knownIds = {
  scenes: new Set(),
  mediaLibrary: new Set(),
  triggers: new Set(),
  highlights: new Set(),
  cloudClips: new Set(),
};
let profileEnsuredUid = '';
let ensuringProfilePromise = null;

function notify(reason = 'state') {
  const snapshot = getSnapshot();
  for (const fn of listeners) {
    try { fn(snapshot, reason); } catch {}
  }
  window.dispatchEvent(new CustomEvent('gather:cloud-sync', { detail: { reason, ...snapshot } }));
}

function getSnapshot() {
  return {
    ready: state.ready,
    user: state.user ? {
      uid: state.user.uid,
      displayName: state.user.displayName || '',
      email: state.user.email || '',
      photoURL: state.user.photoURL || '',
      emailVerified: !!state.user.emailVerified,
    } : null,
    driveConnected: hasDriveToken(),
    driveFolderId: cachedDriveFolderId,
    profile: state.profile,
    paymentSettings: state.paymentSettings,
    scenes: state.scenes,
    mediaLibrary: state.mediaLibrary,
    triggers: state.triggers,
    highlights: state.highlights,
    cloudClips: state.cloudClips,
    syncingCount: state.syncingCount,
  };
}

function hasDriveToken() {
  return !!cachedDriveToken && Date.now() < cachedDriveExp - 30_000;
}

function setDriveToken(token, expiresInSec = 3500) {
  if (!token) {
    cachedDriveToken = '';
    cachedDriveExp = 0;
  } else {
    cachedDriveToken = String(token);
    cachedDriveExp = Date.now() + Math.max(60, Number(expiresInSec) || 3500) * 1000;
  }
  notify('drive-token');
}

function clearSubscriptions() {
  while (unsubs.length) {
    const u = unsubs.pop();
    try { u(); } catch {}
  }
  knownIds.scenes.clear();
  knownIds.mediaLibrary.clear();
  knownIds.triggers.clear();
  knownIds.highlights.clear();
  knownIds.cloudClips.clear();
  state.profile = null;
  state.paymentSettings = null;
  state.scenes = [];
  state.mediaLibrary = [];
  state.triggers = [];
  state.highlights = [];
  state.cloudClips = [];
  cachedDriveFolderId = '';
  profileEnsuredUid = '';
}

async function ensureUserProfile(user = auth.currentUser) {
  if (!user || !user.emailVerified) return null;
  if (profileEnsuredUid === user.uid) return user.uid;
  if (ensuringProfilePromise) return ensuringProfilePromise;

  ensuringProfilePromise = (async () => {
    const uid = user.uid;
    const userPath = `users/${uid}`;
    const ref = doc(db, 'users', uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const localAutoPrune = (() => { try { return JSON.parse(localStorage.getItem('gather:autoPrune') || 'false'); } catch { return false; } })();
        const localAutoSync = (() => { try { return JSON.parse(localStorage.getItem('gather:autoSyncCloudClips') || 'true'); } catch { return true; } })();
        const localAiName = (() => { try { return JSON.parse(localStorage.getItem('gather:aiName') || '"Sam"'); } catch { return 'Sam'; } })();
        const localAiVoice = (() => { try { return JSON.parse(localStorage.getItem('gather:aiVoice') || '"gemini"'); } catch { return 'gemini'; } })();
        const validVoice = ['gemini', 'gemini-podcast', 'browser', 'openai', 'off'].includes(localAiVoice) ? localAiVoice : 'gemini';
        await setDoc(ref, {
          uid,
          displayName: String(user.displayName || 'Host').slice(0, 80),
          photoURL: String(user.photoURL || '').slice(0, 500),
          autoPrune: !!localAutoPrune,
          autoSyncCloudClips: localAutoSync !== false,
          aiName: String(localAiName || 'Sam').slice(0, 24),
          aiVoice: validVoice,
          aiVoiceName: 'Zephyr',
          sceneAiEnabled: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      // Also store isolated PII in /users/{uid}/private/info
      const privPath = `users/${uid}/private/info`;
      const privRef = doc(db, 'users', uid, 'private', 'info');
      try {
        const privSnap = await getDoc(privRef);
        if (!privSnap.exists()) {
          await setDoc(privRef, {
            uid,
            email: String(user.email || 'user@example.com').slice(0, 160),
            driveFolderName: CLOUD_CLIPS_FOLDER,
            updatedAt: serverTimestamp(),
          });
        } else {
          const d = privSnap.data();
          if (d?.driveFolderId) cachedDriveFolderId = d.driveFolderId;
        }
      } catch (privErr) {
        handleFirestoreError(privErr, OperationType.WRITE, privPath);
      }
      profileEnsuredUid = uid;
      return uid;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    } finally {
      ensuringProfilePromise = null;
    }
  })();

  return ensuringProfilePromise;
}

function attachUserListeners(user) {
  clearSubscriptions();
  if (!user) return;
  const uid = user.uid;

  // Profile listener
  const profilePath = `users/${uid}`;
  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          state.profile = snap.data();
          notify('profile');
        }
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.GET, profilePath); } catch {}
      },
    ),
  );

  // Payment Settings listener (single owner-only doc: users/{uid}/paymentSettings/default)
  const payPath = `users/${uid}/paymentSettings/default`;
  unsubs.push(
    onSnapshot(
      doc(db, 'users', uid, 'paymentSettings', 'default'),
      (snap) => {
        state.paymentSettings = snap.exists() ? snap.data() : null;
        notify('paymentSettings');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.GET, payPath); } catch {}
      },
    ),
  );

  // Saved Scenes listener
  const scenesPath = `users/${uid}/scenes`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'scenes'), where('ownerId', '==', uid)),
      (snap) => {
        knownIds.scenes.clear();
        const rows = [];
        snap.forEach((d) => {
          knownIds.scenes.add(d.id);
          rows.push({ id: d.id, ...d.data() });
        });
        rows.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
        state.scenes = rows;
        notify('scenes');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.LIST, scenesPath); } catch {}
      },
    ),
  );

  // Media Library listener
  const mediaPath = `users/${uid}/mediaLibrary`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'mediaLibrary'), where('ownerId', '==', uid)),
      (snap) => {
        knownIds.mediaLibrary.clear();
        const rows = [];
        snap.forEach((d) => {
          knownIds.mediaLibrary.add(d.id);
          rows.push({ id: d.id, ...d.data() });
        });
        rows.sort((a, b) => (Number(b.added) || 0) - (Number(a.added) || 0));
        state.mediaLibrary = rows;
        notify('mediaLibrary');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.LIST, mediaPath); } catch {}
      },
    ),
  );

  // AI Triggers listener
  const triggersPath = `users/${uid}/triggers`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'triggers'), where('ownerId', '==', uid)),
      (snap) => {
        knownIds.triggers.clear();
        const rows = [];
        snap.forEach((d) => {
          knownIds.triggers.add(d.id);
          rows.push({ id: d.id, ...d.data() });
        });
        state.triggers = rows;
        notify('triggers');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.LIST, triggersPath); } catch {}
      },
    ),
  );

  // Smart Highlights listener
  const highlightsPath = `users/${uid}/highlights`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'highlights'), where('ownerId', '==', uid)),
      (snap) => {
        knownIds.highlights.clear();
        const rows = [];
        snap.forEach((d) => {
          knownIds.highlights.add(d.id);
          rows.push({ id: d.id, ...d.data() });
        });
        state.highlights = rows;
        notify('highlights');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.LIST, highlightsPath); } catch {}
      },
    ),
  );

  // Cloud Clips listener
  const clipsPath = `users/${uid}/cloudClips`;
  unsubs.push(
    onSnapshot(
      query(collection(db, 'users', uid, 'cloudClips'), where('ownerId', '==', uid)),
      (snap) => {
        knownIds.cloudClips.clear();
        const rows = [];
        snap.forEach((d) => {
          knownIds.cloudClips.add(d.id);
          rows.push({ id: d.id, ...d.data() });
        });
        rows.sort((a, b) => (Number(b.capturedAt) || 0) - (Number(a.capturedAt) || 0));
        state.cloudClips = rows;
        notify('cloudClips');
      },
      (err) => {
        try { handleFirestoreError(err, OperationType.LIST, clipsPath); } catch {}
      },
    ),
  );
}

onAuthStateChanged(auth, async (user) => {
  state.ready = true;
  state.user = user || null;
  if (!user) {
    // Clear in-memory Google Drive access token immediately on sign-out
    cachedDriveToken = '';
    cachedDriveExp = 0;
    clearSubscriptions();
    notify('auth');
    return;
  }
  try {
    await ensureUserProfile(user);
  } catch (e) {
    console.warn('[gatherCloud] profile init note:', e?.message || e);
  }
  attachUserListeners(user);
  notify('auth');
});

// ---- Auth Actions ----
async function signInWithGoogle({ requestDrive = true } = {}) {
  const provider = new GoogleAuthProvider();
  if (requestDrive) provider.addScope(DRIVE_SCOPE);
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  if (cred?.accessToken) {
    cachedDriveToken = cred.accessToken;
    cachedDriveExp = Date.now() + 50 * 60 * 1000;
  }
  if (result.user) {
    await ensureUserProfile(result.user);
    attachUserListeners(result.user);
  }
  notify('auth');
  return getSnapshot();
}

async function signOut() {
  cachedDriveToken = '';
  cachedDriveExp = 0;
  clearSubscriptions();
  await fbSignOut(auth);
  notify('auth');
}

// ---- Firestore CRUD Operations (Strict Blueprint Compliance) ----
async function updateProfilePrefs(patch) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const path = `users/${uid}`;
  const clean = { updatedAt: serverTimestamp() };
  if (typeof patch.displayName === 'string') clean.displayName = patch.displayName.slice(0, 80);
  if (typeof patch.autoPrune === 'boolean') clean.autoPrune = patch.autoPrune;
  if (typeof patch.autoSyncCloudClips === 'boolean') clean.autoSyncCloudClips = patch.autoSyncCloudClips;
  if (typeof patch.aiName === 'string') clean.aiName = patch.aiName.slice(0, 24);
  if (typeof patch.aiVoice === 'string' && ['gemini', 'gemini-podcast', 'browser', 'openai', 'off'].includes(patch.aiVoice)) {
    clean.aiVoice = patch.aiVoice;
  }
  if (typeof patch.aiVoiceName === 'string') clean.aiVoiceName = patch.aiVoiceName.slice(0, 32);
  if (typeof patch.sceneAiEnabled === 'boolean') clean.sceneAiEnabled = patch.sceneAiEnabled;
  try {
    await updateDoc(doc(db, 'users', uid), clean);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

function cleanPayHandle(raw, stripRe, validRe) {
  const s = String(raw || '').trim().replace(stripRe, '').replace(/\/+$/, '').trim();
  return s && !s.includes('..') && validRe.test(s) ? s : '';
}

function sanitizePaymentSettings(cfg = {}) {
  const pay = cfg.pay && typeof cfg.pay === 'object' ? cfg.pay : cfg;
  const payOn = cfg.payOn && typeof cfg.payOn === 'object' ? cfg.payOn : {};
  const rawStripe = String(pay.stripe || '').trim().replace(/^http:\/\//i, 'https://');
  const stripeUrl = /^(buy|donate)\.stripe\.com\//i.test(rawStripe) ? 'https://' + rawStripe : rawStripe;
  const stripe = /^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]{4,120}$/.test(stripeUrl) ? stripeUrl : '';
  const paypal = cleanPayHandle(pay.paypal, /^(https?:\/\/)?(www\.)?paypal\.me\/|^@/i, /^[A-Za-z0-9._-]{1,40}$/);
  const venmo = cleanPayHandle(pay.venmo, /^(https?:\/\/)?(www\.|account\.)?venmo\.com\/(u\/)?|^@/i, /^[A-Za-z0-9_-]{2,30}$/);
  const cashapp = cleanPayHandle(pay.cashapp, /^(https?:\/\/)?(www\.)?cash\.app\/\$?|^\$/i, /^[A-Za-z][A-Za-z0-9_]{0,19}$/);
  const kofi = cleanPayHandle(pay.kofi, /^(https?:\/\/)?(www\.)?ko-fi\.com\/|^@/i, /^[A-Za-z0-9._-]{1,40}$/);
  const patreon = cleanPayHandle(pay.patreon, /^(https?:\/\/)?(www\.)?patreon\.com\/(c\/|cw\/)?|^@/i, /^[A-Za-z0-9._-]{1,40}$/);
  const bmc = cleanPayHandle(pay.bmc, /^(https?:\/\/)?(www\.)?buymeacoffee\.com\/|^@/i, /^[A-Za-z0-9._-]{1,40}$/);
  const minRaw = Number(cfg.minAmount ?? cfg.min ?? 2);
  const minAmount = Math.max(1, Math.min(500, Number.isFinite(minRaw) ? Math.round(minRaw) : 2));
  return {
    stripe,
    paypal,
    venmo,
    cashapp,
    kofi,
    patreon,
    bmc,
    stripeOn: typeof payOn.stripe === 'boolean' ? payOn.stripe : !!cfg.stripeOn,
    paypalOn: typeof payOn.paypal === 'boolean' ? payOn.paypal : !!cfg.paypalOn,
    venmoOn: typeof payOn.venmo === 'boolean' ? payOn.venmo : !!cfg.venmoOn,
    cashappOn: typeof payOn.cashapp === 'boolean' ? payOn.cashapp : !!cfg.cashappOn,
    kofiOn: typeof payOn.kofi === 'boolean' ? payOn.kofi : !!cfg.kofiOn,
    patreonOn: typeof payOn.patreon === 'boolean' ? payOn.patreon : !!cfg.patreonOn,
    bmcOn: typeof payOn.bmc === 'boolean' ? payOn.bmc : !!cfg.bmcOn,
    supersEnabled: !!(cfg.supersEnabled ?? cfg.supers),
    bountiesEnabled: (cfg.bountiesEnabled ?? cfg.bounties) !== false,
    minAmount,
  };
}

async function savePaymentSettings(cfg) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const path = `users/${uid}/paymentSettings/default`;
  const ref = doc(db, 'users', uid, 'paymentSettings', 'default');
  const fields = {
    ...sanitizePaymentSettings(cfg),
    updatedAt: serverTimestamp(),
  };
  let existed = false;
  try {
    existed = !!state.paymentSettings || (await getDoc(ref)).exists();
    if (existed) {
      await updateDoc(ref, fields);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...fields,
        createdAt: serverTimestamp(),
      });
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, existsSafe(existed), path);
  }
}

async function saveScene(scene) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !scene?.name) return null;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = scene.id ? sanitizeId(scene.id, 'sc') : sceneDocId(scene.name);
  const path = `users/${uid}/scenes/${id}`;
  const ref = doc(db, 'users', uid, 'scenes', id);
  const participants = Array.isArray(scene.participants)
    ? scene.participants.map((p) => String(p || '').trim().slice(0, 40)).filter(Boolean).slice(0, 12)
    : [];
  const elements = cleanElements(scene.elements);
  const now = Date.now();
  const baseFields = {
    name: String(scene.name).trim().slice(0, 60) || 'Scene',
    desc: String(scene.desc || '').trim().slice(0, 50),
    participants,
    layout: String(scene.layout || 'custom').slice(0, 40),
    elements,
    media: String(scene.media || '').slice(0, 80),
    lastUsedAt: Number(scene.lastUsedAt) || now,
    archived: !!scene.archived,
    autoArchived: !!scene.autoArchived,
    updatedAt: serverTimestamp(),
  };

  try {
    const exists = knownIds.scenes.has(id) || (await getDoc(ref)).exists();
    if (exists) {
      await updateDoc(ref, baseFields);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...baseFields,
        savedAt: Number(scene.savedAt) || now,
        createdAt: serverTimestamp(),
      });
      knownIds.scenes.add(id);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existsSafe(knownIds.scenes.has(id)), path);
  }
}

function existsSafe(existed) {
  return existed ? OperationType.UPDATE : OperationType.CREATE;
}

async function deleteScene(sceneNameOrId) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !sceneNameOrId) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const hit = state.scenes.find((s) => s.id === sceneNameOrId || s.name === sceneNameOrId);
  const id = hit ? hit.id : sceneDocId(sceneNameOrId);
  const path = `users/${uid}/scenes/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'scenes', id));
    knownIds.scenes.delete(id);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

async function saveMediaItem(item) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !item?.name) return null;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(item.id, 'media');
  const path = `users/${uid}/mediaLibrary/${id}`;
  const ref = doc(db, 'users', uid, 'mediaLibrary', id);
  const kind = ['pdf', 'video', 'audio', 'image', 'link', 'youtube'].includes(item.kind) ? item.kind : 'link';
  const payload = {
    name: String(item.name).trim().slice(0, 80) || 'Media',
    mimeType: String(item.mimeType || item.type || '').slice(0, 80),
    sizeBytes: Math.max(0, Math.min(536870912, Number(item.sizeBytes ?? item.size) || 0)),
    updatedAt: serverTimestamp(),
  };
  if (item.url) payload.url = String(item.url).slice(0, 600);
  if (item.driveFileId) payload.driveFileId = String(item.driveFileId).slice(0, 128);
  if (item.driveWebViewLink) payload.driveWebViewLink = String(item.driveWebViewLink).slice(0, 500);

  let existed = false;
  try {
    existed = knownIds.mediaLibrary.has(id) || (await getDoc(ref)).exists();
    if (existed) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        kind,
        added: Number(item.added) || Date.now(),
        createdAt: serverTimestamp(),
        ...payload,
      });
      knownIds.mediaLibrary.add(id);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existsSafe(existed), path);
  }
}

async function deleteMediaItem(itemId) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !itemId) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(itemId, 'media');
  const path = `users/${uid}/mediaLibrary/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'mediaLibrary', id));
    knownIds.mediaLibrary.delete(id);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

async function saveTrigger(trigger) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !trigger?.phrase) return null;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(trigger.id, 'trig');
  const path = `users/${uid}/triggers/${id}`;
  const ref = doc(db, 'users', uid, 'triggers', id);
  const actionType = ['scene', 'media', 'banner'].includes(trigger.actionType) ? trigger.actionType : 'scene';
  const fields = {
    phrase: String(trigger.phrase).trim().slice(0, 60),
    actionType,
    targetId: String(trigger.targetId || '').slice(0, 120),
    targetLabel: String(trigger.targetLabel || trigger.targetId || '').slice(0, 120),
    enabled: trigger.enabled !== false,
    updatedAt: serverTimestamp(),
  };

  let existed = false;
  try {
    existed = knownIds.triggers.has(id) || (await getDoc(ref)).exists();
    if (existed) {
      await updateDoc(ref, fields);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...fields,
        createdAt: serverTimestamp(),
      });
      knownIds.triggers.add(id);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existsSafe(existed), path);
  }
}

async function deleteTrigger(triggerId) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !triggerId) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(triggerId, 'trig');
  const path = `users/${uid}/triggers/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'triggers', id));
    knownIds.triggers.delete(id);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

async function saveHighlight(highlight) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !highlight?.speaker) return null;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(highlight.id, 'hl');
  const path = `users/${uid}/highlights/${id}`;
  const ref = doc(db, 'users', uid, 'highlights', id);
  let existed = false;
  try {
    existed = knownIds.highlights.has(id) || (await getDoc(ref)).exists();
    if (existed) {
      await updateDoc(ref, { added: !!highlight.added, updatedAt: serverTimestamp() });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        speaker: String(highlight.speaker).trim().slice(0, 60),
        snippet: String(highlight.snippet || 'Highlight moment').trim().slice(0, 160),
        elapsedMs: Math.max(0, Number(highlight.elapsedMs) || 0),
        durationSec: Math.max(1, Math.min(600, Math.round(Number(highlight.durationSec) || 15))),
        added: !!highlight.added,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      knownIds.highlights.add(id);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existsSafe(existed), path);
  }
}

async function deleteHighlight(highlightId) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !highlightId) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(highlightId, 'hl');
  const path = `users/${uid}/highlights/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'highlights', id));
    knownIds.highlights.delete(id);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

async function saveCloudClipRecord(clip) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !clip?.id) return null;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(clip.id, 'clip');
  const path = `users/${uid}/cloudClips/${id}`;
  const ref = doc(db, 'users', uid, 'cloudClips', id);
  const syncStatus = ['local', 'syncing', 'synced', 'error'].includes(clip.syncStatus) ? clip.syncStatus : 'local';
  const aspect = clip.aspect === '9:16' ? '9:16' : '16:9';

  let existed = false;
  try {
    existed = knownIds.cloudClips.has(id) || (await getDoc(ref)).exists();
    if (existed) {
      const patch = {
        syncStatus,
        sizeBytes: Math.max(0, Math.min(536870912, Number(clip.sizeBytes) || 0)),
        updatedAt: serverTimestamp(),
      };
      if (clip.driveFileId) patch.driveFileId = String(clip.driveFileId).slice(0, 128);
      if (clip.driveWebViewLink) patch.driveWebViewLink = String(clip.driveWebViewLink).slice(0, 500);
      if (clip.driveFolderId) patch.driveFolderId = String(clip.driveFolderId).slice(0, 128);
      await updateDoc(ref, patch);
    } else {
      const payload = {
        ownerId: uid,
        label: String(clip.label || '30s Clip').trim().slice(0, 80),
        fileName: String(clip.fileName || `${id}.webm`).trim().slice(0, 120),
        aspect,
        durationSec: Math.max(0, Math.min(300, Math.round(Number(clip.durationSec) || 30))),
        sizeBytes: Math.max(0, Math.min(536870912, Number(clip.sizeBytes) || 0)),
        mimeType: String(clip.mimeType || 'video/webm').slice(0, 64),
        syncStatus,
        capturedAt: Number(clip.capturedAt) || Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (clip.driveFileId) payload.driveFileId = String(clip.driveFileId).slice(0, 128);
      if (clip.driveWebViewLink) payload.driveWebViewLink = String(clip.driveWebViewLink).slice(0, 500);
      if (clip.driveFolderId) payload.driveFolderId = String(clip.driveFolderId).slice(0, 128);
      await setDoc(ref, payload);
      knownIds.cloudClips.add(id);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, existsSafe(existed), path);
  }
}

async function deleteCloudClipRecord(clipId) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !clipId) return false;
  await ensureUserProfile(user);
  const uid = user.uid;
  const id = sanitizeId(clipId, 'clip');
  const path = `users/${uid}/cloudClips/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'cloudClips', id));
    knownIds.cloudClips.delete(id);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ---- Google Drive 'Cloud Clips' Folder API ----
async function driveFetch(url, opts = {}) {
  if (!hasDriveToken()) {
    const err = new Error('Connect Google Drive to sync Cloud Clips.');
    err.code = 'NO_DRIVE_TOKEN';
    throw err;
  }
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${cachedDriveToken}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    cachedDriveToken = '';
    cachedDriveExp = 0;
    notify('drive-token');
    const err = new Error('Google Drive session expired. Please reconnect.');
    err.status = 401;
    throw err;
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Google Drive returned ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function ensureCloudClipsFolder() {
  if (cachedDriveFolderId) {
    try {
      const check = await driveFetch(`${DRIVE_API}/drive/v3/files/${encodeURIComponent(cachedDriveFolderId)}?fields=id,name,trashed`);
      if (check && !check.trashed) return cachedDriveFolderId;
    } catch {}
    cachedDriveFolderId = '';
  }

  // Search for existing 'Cloud Clips' folder created by this app
  const q = encodeURIComponent(`name='${CLOUD_CLIPS_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const list = await driveFetch(`${DRIVE_API}/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`);
  let folderId = list?.files?.[0]?.id || '';

  if (!folderId) {
    const created = await driveFetch(`${DRIVE_API}/drive/v3/files?fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: CLOUD_CLIPS_FOLDER,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    folderId = created?.id || '';
  }

  if (!folderId) throw new Error('Could not create the Cloud Clips folder in Google Drive.');
  cachedDriveFolderId = folderId;

  // Persist folder ID to isolated user private doc when signed in
  const user = auth.currentUser;
  if (user && user.emailVerified) {
    try {
      await ensureUserProfile(user);
      await updateDoc(doc(db, 'users', user.uid, 'private', 'info'), {
        driveFolderId: folderId,
        driveFolderName: CLOUD_CLIPS_FOLDER,
        updatedAt: serverTimestamp(),
      });
    } catch {}
  }
  return folderId;
}

const CHUNK_SIZE = 8 * 1024 * 1024;
function putDriveChunk(sessionUrl, blob, start, total, onProgress) {
  return new Promise((resolve, reject) => {
    const end = Math.min(start + CHUNK_SIZE, total);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`);
    xhr.upload.onprogress = (ev) => onProgress(Math.min(1, (start + ev.loaded) / Math.max(1, total)));
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        return resolve({ done: true, file: JSON.parse(xhr.responseText || '{}') });
      }
      if (xhr.status === 308) {
        const range = xhr.getResponseHeader('Range');
        return resolve({ done: false, next: range ? Number(range.split('-')[1]) + 1 : end });
      }
      const err = new Error(`Google Drive upload failed (${xhr.status}).`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(Object.assign(new Error('Network interrupted during Drive upload.'), { status: 0 }));
    xhr.send(blob.slice(start, end));
  });
}

async function uploadCloudClipToDrive(blob, fileName, onProgress = () => {}) {
  if (!blob || !blob.size) throw new Error('Clip video data is empty.');
  if (!hasDriveToken()) {
    const err = new Error('Connect Google Drive to sync Cloud Clips.');
    err.code = 'NO_DRIVE_TOKEN';
    throw err;
  }
  state.syncingCount++;
  notify('syncing');
  try {
    const folderId = await ensureCloudClipsFolder();
    const mimeType = blob.type || 'video/webm';
    const initRes = await fetch(
      `${DRIVE_API}/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cachedDriveToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(blob.size),
        },
        body: JSON.stringify({
          name: fileName,
          parents: [folderId],
          description: '30-second Cloud Clip automatically captured in gather studio',
        }),
      },
    );
    if (initRes.status === 401) {
      cachedDriveToken = '';
      cachedDriveExp = 0;
      notify('drive-token');
      throw new Error('Google Drive session expired. Please reconnect.');
    }
    if (!initRes.ok) {
      const j = await initRes.json().catch(() => ({}));
      throw new Error(j?.error?.message || `Google Drive refused the upload (${initRes.status}).`);
    }
    const sessionUrl = initRes.headers.get('Location');
    if (!sessionUrl) throw new Error('Google Drive did not return a resumable upload session.');

    let offset = 0;
    let tries = 0;
    for (;;) {
      try {
        const res = await putDriveChunk(sessionUrl, blob, offset, blob.size, onProgress);
        tries = 0;
        if (res.done) {
          onProgress(1);
          return {
            id: res.file.id,
            name: res.file.name || fileName,
            webViewLink: res.file.webViewLink || `https://drive.google.com/file/d/${res.file.id}/view`,
            folderId,
          };
        }
        offset = res.next;
      } catch (err) {
        if (++tries > 3 || (err.status >= 400 && err.status < 500)) throw err;
        await new Promise((r) => setTimeout(r, 800 * tries));
      }
    }
  } finally {
    state.syncingCount = Math.max(0, state.syncingCount - 1);
    notify('syncing');
  }
}

async function deleteDriveFile(fileId) {
  if (!fileId) return false;
  await driveFetch(`${DRIVE_API}/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
  return true;
}

function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  try { fn(getSnapshot(), 'init'); } catch {}
  return () => listeners.delete(fn);
}

window.gatherCloud = {
  config: {
    projectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
    oAuthClientId: firebaseConfig.oAuthClientId,
  },
  getSnapshot,
  subscribe,
  signInWithGoogle,
  signOut,
  hasDriveToken,
  setDriveToken,
  getDriveToken: () => (hasDriveToken() ? cachedDriveToken : ''),
  ensureUserProfile,
  updateProfilePrefs,
  savePaymentSettings,
  saveScene,
  deleteScene,
  saveMediaItem,
  deleteMediaItem,
  saveTrigger,
  deleteTrigger,
  saveHighlight,
  deleteHighlight,
  saveCloudClipRecord,
  deleteCloudClipRecord,
  ensureCloudClipsFolder,
  uploadCloudClipToDrive,
  deleteDriveFile,
  sceneDocId,
  sanitizeId,
};
