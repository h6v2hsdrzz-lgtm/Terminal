/* ════════════════════════════════════════════════════════════
   store.js — Persistance locale (IndexedDB).
   L'archive de trades peut dépasser plusieurs milliers de lignes
   (import CSV de plusieurs années) : localStorage et son quota de
   ~5 Mo de chaînes ne suffisent pas. IndexedDB stocke les objets
   nativement, sans sérialisation manuelle.
   Rien ne sort du navigateur.
   ════════════════════════════════════════════════════════════ */
'use strict';

const Store = (() => {
  const DB_NAME = 'terminal-analytics';
  const DB_VER = 1;
  const KV = 'kv';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { rej(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB indisponible'));
      req.onblocked = () => rej(new Error('IndexedDB bloqué par un autre onglet'));
    });
    return dbp;
  }

  /* repli mémoire si IndexedDB est indisponible (navigation privée stricte) */
  const mem = new Map();

  async function run(mode, fn) {
    let db;
    try { db = await open(); } catch { return null; }
    return new Promise((res, rej) => {
      let req;
      const tx = db.transaction(KV, mode);
      try { req = fn(tx.objectStore(KV)); } catch (e) { rej(e); return; }
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transaction annulée'));
    });
  }

  return {
    async get(key, fallback = null) {
      try {
        const v = await run('readonly', (s) => s.get(key));
        if (v !== undefined && v !== null) return v;
      } catch {}
      return mem.has(key) ? mem.get(key) : fallback;
    },
    async set(key, value) {
      mem.set(key, value);
      try { await run('readwrite', (s) => s.put(value, key)); } catch {}
      return value;
    },
    async del(key) {
      mem.delete(key);
      try { await run('readwrite', (s) => s.delete(key)); } catch {}
    },
  };
})();

/* ─────────────── coffre à identifiants ───────────────
   Les clés API OKX sont conservées côté navigateur uniquement.
   Deux niveaux au choix de l'utilisateur :
     • session   → sessionStorage, effacé à la fermeture de l'onglet
     • chiffré   → localStorage, AES-GCM 256 dérivé d'un mot de passe
                   (PBKDF2-SHA256, 250 000 itérations, sel aléatoire)
   Aucune écriture en clair sur disque n'est proposée par défaut.
*/
const Vault = (() => {
  const LS_KEY = 'terminal-okx-vault';
  const SS_KEY = 'terminal-okx-session';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function derive(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  }

  return {
    hasEncrypted() { try { return !!localStorage.getItem(LS_KEY); } catch { return false; } },
    hasSession() { try { return !!sessionStorage.getItem(SS_KEY); } catch { return false; } },

    saveSession(creds) {
      try { sessionStorage.setItem(SS_KEY, JSON.stringify(creds)); } catch {}
    },
    loadSession() {
      try { return JSON.parse(sessionStorage.getItem(SS_KEY)); } catch { return null; }
    },

    async saveEncrypted(creds, password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await derive(password, salt);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(creds)));
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
    },
    async loadEncrypted(password) {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) throw new Error('Aucune clé enregistrée');
      const { salt, iv, ct } = JSON.parse(raw);
      const key = await derive(password, unb64(salt));
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
      } catch { throw new Error('Mot de passe incorrect'); }
      return JSON.parse(dec.decode(plain));
    },

    clear() {
      try { localStorage.removeItem(LS_KEY); } catch {}
      try { sessionStorage.removeItem(SS_KEY); } catch {}
    },
  };
})();
