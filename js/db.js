/*
 * Stockage local sur le telephone (IndexedDB) : les motifs et les reglages
 * restent dans l'appli, meme sans Internet a la boutique.
 */
(function (root) {
  'use strict';
  const NOM = 'boxdessinchiote';
  let base = null;

  function ouvrir() {
    if (base) return Promise.resolve(base);
    return new Promise((ok, ko) => {
      const req = indexedDB.open(NOM, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('motifs', { keyPath: 'id' });
        db.createObjectStore('reglages', { keyPath: 'cle' });
      };
      req.onsuccess = () => { base = req.result; ok(base); };
      req.onerror = () => ko(req.error);
    });
  }

  // Petite aide : execute une operation dans une transaction et attend sa fin
  async function operation(magasin, mode, fn) {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const tx = db.transaction(magasin, mode);
      const req = fn(tx.objectStore(magasin));
      tx.oncomplete = () => ok(req ? req.result : undefined);
      tx.onerror = () => ko(tx.error);
      tx.onabort = () => ko(tx.error);
    });
  }

  const Db = {
    tousLesMotifs: () => operation('motifs', 'readonly', (s) => s.getAll()),
    enregistrerMotif: (m) => operation('motifs', 'readwrite', (s) => s.put(m)),
    supprimerMotif: (id) => operation('motifs', 'readwrite', (s) => s.delete(id)),
    lireReglages: async () => {
      const r = await operation('reglages', 'readonly', (s) => s.get('principal'));
      return r ? r.valeur : null;
    },
    ecrireReglages: (valeur) => operation('reglages', 'readwrite', (s) => s.put({ cle: 'principal', valeur })),
  };
  root.Db = Db;
})(this);
