/*
 * Moteur de placement "rangees justifiees" (coupe guillotine).
 *
 * Principe : les motifs sont ranges en rangees horizontales. Dans une rangee,
 * tous les motifs ont la MEME hauteur, et cette hauteur est calculee pour que
 * la rangee remplisse exactement la largeur de la page (comme une ligne de
 * texte justifiee). Resultat a la decoupe :
 *   1. un coup de massicot sur toute la largeur entre chaque rangee,
 *   2. puis un coup droit entre chaque motif de la bande obtenue.
 * Aucune decoupe en escalier : c'est le compromis "facile a decouper".
 *
 * Toutes les mesures sont en millimetres, origine en haut a gauche de la page.
 */
(function (root) {
  'use strict';

  // Plage de hauteurs possibles d'un motif dans une orientation donnee.
  // aspect = largeur / hauteur telle que posee sur la page.
  // Contrainte de Pierre : le PETIT cote reste entre minMm et maxMm.
  function plageHauteur(aspect, minMm, maxMm, largeurUtile, hauteurUtile) {
    const facteurPetitCote = Math.min(aspect, 1); // petit cote = hauteur * facteur
    const lo = minMm / facteurPetitCote;
    const hi = Math.min(maxMm / facteurPetitCote, largeurUtile / aspect, hauteurUtile);
    return lo <= hi ? { lo, hi } : null;
  }

  // Orientations possibles d'un exemplaire (normal, et tourne de 90 degres si permis).
  function orientations(item, opts, largeurUtile, hauteurUtile) {
    const res = [];
    const normale = plageHauteur(item.aspect, item.minMm, item.maxMm, largeurUtile, hauteurUtile);
    if (normale) res.push({ rotated: false, aspect: item.aspect, lo: normale.lo, hi: normale.hi });
    // Un motif carre tourne ne change rien : inutile de l'essayer
    if (opts.rotate && Math.abs(item.aspect - 1) > 0.01) {
      const a = 1 / item.aspect;
      const tournee = plageHauteur(a, item.minMm, item.maxMm, largeurUtile, hauteurUtile);
      if (tournee) res.push({ rotated: true, aspect: a, lo: tournee.lo, hi: tournee.hi });
    }
    return res;
  }

  // Construit UNE rangee a partir de la file d'attente.
  // hauteurMax = place verticale restante sur la page.
  function construireRangee(file, largeurUtile, gap, hauteurMax) {
    const rangee = [];
    let lo = 0, hi = hauteurMax, sommeAspects = 0, hauteur = null;

    for (let i = 0; i < file.length && hauteur === null; i++) {
      const el = file[i];
      // On garde l'orientation normale si elle convient (motif droit au mur),
      // la rotation ne sert que si elle debloque la situation.
      for (const o of el.orients) {
        const nLo = Math.max(lo, o.lo);
        const nHi = Math.min(hi, o.hi);
        if (nLo > nHi) continue; // tailles incompatibles avec la rangee
        const n = rangee.length + 1;
        const somme = sommeAspects + o.aspect;
        // Hauteur qui remplirait exactement la largeur
        const hRemplir = (largeurUtile - (n - 1) * gap) / somme;
        if (hRemplir < nLo) continue; // deborderait meme a la taille mini
        rangee.push({ el, o, index: i });
        lo = nLo; hi = nHi; sommeAspects = somme;
        if (hRemplir <= nHi) hauteur = hRemplir; // rangee pleine et justifiee
        break;
      }
    }
    if (rangee.length === 0) return null;
    // Rangee incomplete : on prend la plus grande taille autorisee
    if (hauteur === null) hauteur = hi;

    // Retire de la file les elements places (du dernier au premier pour garder les index)
    for (let k = rangee.length - 1; k >= 0; k--) file.splice(rangee[k].index, 1);
    return { hauteur, membres: rangee };
  }

  /*
   * items : [{ id, aspect, minMm, maxMm, ... }]  (aspect = largeur/hauteur de l'image source)
   * opts  : { pageW, pageH, margin, gap, footer, rotate }
   * Retour : { pages: [{ rows: [{ y, h, x0, x1 }], placements: [...] }], unplaced: [...] }
   */
  function packer(items, opts) {
    const largeurUtile = opts.pageW - 2 * opts.margin;
    const hauteurUtile = opts.pageH - 2 * opts.margin - (opts.footer || 0);
    const gap = opts.gap;

    const unplaced = [];
    const file = [];
    for (const item of items) {
      const orients = orientations(item, opts, largeurUtile, hauteurUtile);
      if (orients.length === 0) unplaced.push(item); // ne rentre pas dans une page A3
      else file.push({ item, orients });
    }
    // Les grands motifs d'abord : les tailles proches se retrouvent dans les memes rangees.
    // Sauf si on demande de garder l'ordre recu (mode collage : ordre melange au hasard)
    if (!opts.garderOrdre) {
      const centre = (e) => (e.orients[0].lo + e.orients[0].hi) / 2;
      file.sort((a, b) => centre(b) - centre(a));
    }

    const pages = [];
    while (file.length > 0) {
      const page = { rows: [], placements: [] };
      let y = 0;
      for (;;) {
        const restant = hauteurUtile - y;
        if (restant <= 0) break;
        const rangee = construireRangee(file, largeurUtile, gap, restant);
        if (!rangee) break;
        let x = 0;
        for (const m of rangee.membres) {
          const w = rangee.hauteur * m.o.aspect;
          page.placements.push({
            item: m.el.item,
            rotated: m.o.rotated,
            x: opts.margin + x,
            y: opts.margin + y,
            w,
            h: rangee.hauteur,
          });
          x += w + gap;
        }
        page.rows.push({ y: opts.margin + y, h: rangee.hauteur, x0: opts.margin, x1: opts.margin + x - gap });
        y += rangee.hauteur + gap;
      }
      if (page.placements.length === 0) {
        // Securite : ne devrait jamais arriver, mais evite une boucle infinie
        unplaced.push(...file.map((e) => e.item));
        break;
      }
      pages.push(page);
    }
    return { pages, unplaced };
  }

  /*
   * Mode "nombre de motifs par page" : on ignore les tailles mini/maxi.
   * Les exemplaires sont pris par paquets de N (dans l'ordre recu), et pour chaque
   * paquet on cherche la plus grande taille qui fait tout tenir sur UNE page.
   * Recherche par dichotomie : on essaie une taille, si ca tient on grossit,
   * sinon on reduit, en coupant l'intervalle en deux a chaque essai.
   * SOUPLESSE : dans une page, le petit cote peut varier de 1 a 1.5 fois la taille
   * de base, pour que les rangees puissent se justifier (remplir la largeur).
   */
  const SOUPLESSE = 1.5;
  const TAILLE_MINI_MM = 10; // en dessous, ca n'a plus de sens de decouper

  function packerParNombre(items, opts, parPage) {
    const n = Math.max(1, Math.floor(parPage));
    const pages = [], unplaced = [];
    for (let i = 0; i < items.length; i += n) {
      const paquet = items.slice(i, i + n);
      const essai = (s) => packer(paquet.map((it) => ({ ...it, minMm: s, maxMm: s * SOUPLESSE })), opts);
      const tient = (r) => r.pages.length === 1 && r.unplaced.length === 0;
      let bas = TAILLE_MINI_MM, haut = opts.pageW, meilleur = null;
      for (let k = 0; k < 30; k++) {
        const s = (bas + haut) / 2;
        const r = essai(s);
        if (tient(r)) { meilleur = r; bas = s; } else haut = s;
      }
      if (!meilleur) {
        // Meme a 1 cm le paquet ne tient pas sur une page : on le repartit normalement
        const r = essai(TAILLE_MINI_MM);
        pages.push(...r.pages); unplaced.push(...r.unplaced);
      } else pages.push(meilleur.pages[0]);
    }
    return { pages, unplaced };
  }

  const api = { packer, packerParNombre, plageHauteur };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Packer = api;
})(this);
