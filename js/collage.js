/*
 * Moteur "collage" : motifs inclines qui se chevauchent, comme colles a la main
 * sur un mur, sans qu'on voie le mur (choix de Pierre : "aucun blanc" passe en premier).
 *
 * Methode, en 3 temps :
 *   1. On range les motifs en rangees justifiees (moteur Packer), SANS marge ni ecart :
 *      la page est pavee de "cases" rectangulaires.
 *   2. On etire legerement les cases pour que le pavage couvre exactement la feuille
 *      (rangees un peu plus hautes, rangee incomplete elargie).
 *   3. Chaque motif est incline puis agrandi JUSTE ASSEZ pour recouvrir toute sa case.
 *      Toutes les cases etant couvertes, aucun blanc n'est possible.
 *
 * Prix a payer : ce qui depasse de la case cache les voisins. Plus l'angle est fort,
 * plus il faut agrandir, plus on cache (motif carre : 5 deg ~ 15 %, 10 deg ~ 28 %,
 * 20 deg ~ 45 %, 30 deg ~ 54 % de sa surface hors de sa case).
 * Avec limiterAngle = true, l'angle de chaque motif est reduit pour que sa part
 * hors case reste sous chevauchementMax.
 *
 * Unites : mm, origine en haut a gauche. Angle en degres, positif = sens horaire.
 */
(function (root) {
  'use strict';
  const Pk = (typeof module !== 'undefined' && module.exports) ? require('./packer.js') : root.Packer;
  const MARGE_SECURITE = 1.01; // 1 % de plus : evite un lisere blanc du aux arrondis
  const AGRANDISSEMENT_MAX = 1.35; // un motif ne grossit jamais plus que ca pour couvrir sa case
  const GROSSISSEMENT_DESORDRE = 0.6; // grossissement au hasard maxi quand desordre = 100 %
  const DISTANCE_COPIES = 20;      // places minimum entre deux exemplaires d'un meme motif

  // Generateur pseudo-aleatoire a graine : meme graine = meme collage (apercu = PDF)
  function hasard(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Taille minimale d'un motif (proportions "aspect" = largeur/hauteur) incline de "deg"
  // pour recouvrir une case droite cw x ch de meme centre.
  // Geometrie : vue dans le repere du motif, la case occupe une boite de
  // (cw.cos + ch.sin) de large et (cw.sin + ch.cos) de haut ; le motif doit la contenir.
  function tailleCouvrante(aspect, cw, ch, deg) {
    const a = Math.abs(deg) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const h = Math.max((cw * co + ch * si) / aspect, cw * si + ch * co);
    return { w: h * aspect, h };
  }

  // Part du motif qui depasse de sa case (donc susceptible de cacher les voisins)
  function partHorsCase(aspect, cw, ch, deg) {
    const t = tailleCouvrante(aspect, cw, ch, deg);
    return 1 - (cw * ch) / (t.w * t.h);
  }

  // Plus grand angle (0..maxDeg) dont la part hors case reste <= limite
  function angleLimite(aspect, cw, ch, maxDeg, limite) {
    if (partHorsCase(aspect, cw, ch, maxDeg) <= limite) return maxDeg;
    if (partHorsCase(aspect, cw, ch, 0) > limite) return 0; // case deja deformee : pas d'inclinaison
    let bas = 0, haut = maxDeg;
    for (let k = 0; k < 30; k++) {
      const m = (bas + haut) / 2;
      if (partHorsCase(aspect, cw, ch, m) <= limite) bas = m; else haut = m;
    }
    return bas;
  }

  function melanger(liste, rnd) {
    const t = liste.slice();
    for (let i = t.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [t[i], t[j]] = [t[j], t[i]];
    }
    return t;
  }

  // Identifiant du motif d'origine (deux exemplaires du meme motif partagent la meme cle)
  const cleMotif = (it) => (it.motif ? it.motif.id : String(it.id).split('#')[0]);

  /*
   * Ecarte les exemplaires d'un meme motif : dans l'ordre melange, deux exemplaires
   * doivent etre separes d'au moins "distance" places (une page en contient 6 a 15).
   * Si un exemplaire est trop pres d'un autre, on l'echange avec un element pris au
   * hasard plus loin, qui ne cree pas lui-meme de conflit.
   */
  function ecarterCopies(liste, distance, rnd) {
    const t = liste.slice();
    const conflit = (i, it) => {
      for (let k = Math.max(0, i - distance); k < Math.min(t.length, i + distance + 1); k++) {
        if (k !== i && cleMotif(t[k]) === cleMotif(it)) return true;
      }
      return false;
    };
    for (let i = 0; i < t.length; i++) {
      if (!conflit(i, t[i])) continue;
      for (let essai = 0; essai < 200; essai++) {
        const j = Math.floor(rnd() * t.length);
        if (j === i || cleMotif(t[j]) === cleMotif(t[i])) continue;
        [t[i], t[j]] = [t[j], t[i]];
        if (!conflit(i, t[i]) && !conflit(j, t[j])) break;
        [t[i], t[j]] = [t[j], t[i]]; // echange inutile : on annule
      }
    }
    return t;
  }

  /*
   * items : [{ id, aspect, minMm, maxMm, ... }]
   * opts  : { pageW, pageH, angleMax, chevauchementMax (0..1), limiterAngle, desordre (0..1), graine }
   * Retour : { pages: [{ placements: [{ item, x, y, w, h, angle, rotated:false, horsCase }] }],
   *            unplaced, stats: { complements } }
   * placements est dans l'ordre de dessin (du dessous vers le dessus).
   */
  function collage(items, opts) {
    const rnd = hasard(opts.graine || 1);
    const W = opts.pageW, H = opts.pageH;
    // garderOrdre : le rangement ne retrie pas par taille, sinon le melange serait annule
    const optsRangees = { pageW: W, pageH: H, margin: 0, gap: 0, footer: 0, rotate: false, garderOrdre: true };
    const desordre = Math.max(0, Math.min(1, opts.desordre ?? 0));
    const hauteurUtilisee = (pg) => pg.rows.reduce((s, r) => s + r.h, 0);
    const ETIREMENT_MAX = 1.15; // au-dela, la derniere page est completee
    const ETIREMENT_RANGEE_MAX = 1.25; // rangee plus courte : fusionnee avec sa voisine

    // Melange au hasard, puis on ecarte les exemplaires d'un meme motif
    const res = Pk.packer(ecarterCopies(melanger(items, rnd), DISTANCE_COPIES, rnd), optsRangees);
    const pagesRangees = res.pages;

    // Derniere page peu remplie : on la complete avec des motifs repris au hasard,
    // sinon il faudrait trop etirer les cases pour couvrir la feuille
    let complements = 0;
    if (pagesRangees.length > 0) {
      const i = pagesRangees.length - 1;
      if (H / hauteurUtilisee(pagesRangees[i]) > ETIREMENT_MAX) {
        const base = pagesRangees[i].placements.map((p) => p.item);
        const reserve = melanger(items, rnd);
        let meilleure = pagesRangees[i];
        for (let k = 0; k < reserve.length * 3; k++) {
          base.push({ ...reserve[k % reserve.length], complement: true });
          const r = Pk.packer(base, optsRangees);
          if (r.pages.length > 1 || r.unplaced.length) break; // ca ne tient plus : on garde la precedente
          meilleure = r.pages[0];
          if (H / hauteurUtilisee(meilleure) <= ETIREMENT_MAX) break;
        }
        complements = meilleure.placements.filter((p) => p.item.complement).length;
        pagesRangees[i] = meilleure;
      }
    }

    const pages = pagesRangees.map((pg) => {
      // Etape 2a : une rangee tres incomplete (il faudrait l'etirer de plus de 25 %) est
      // fusionnee avec sa voisine, puis re-justifiee : hauteur = W / somme des proportions,
      // ce qui remplit exactement la largeur. Les autres sont juste un peu etirees.
      let rangees = pg.rows.map((r) => pg.placements.filter((p) => p.y === r.y));
      const largeur = (m) => m.reduce((s, p) => s + p.w, 0);
      for (let k = 0; k < rangees.length && rangees.length > 1; k++) {
        if (largeur(rangees[k]) < W / ETIREMENT_RANGEE_MAX) {
          const voisine = k > 0 ? k - 1 : k + 1;
          rangees[voisine] = k > 0 ? rangees[voisine].concat(rangees[k]) : rangees[k].concat(rangees[voisine]);
          rangees.splice(k, 1); k--;
        }
      }
      // Rangee fusionnee : re-justifiee ; sinon on garde sa hauteur et on l'etire en largeur
      const hauteurs = rangees.map((m) => (largeur(m) > W * 1.001 ? W / m.reduce((s, p) => s + p.w / p.h, 0) : m[0].h));
      // Etape 2b : les rangees couvrent toute la hauteur de la feuille
      const sy = H / hauteurs.reduce((s, h) => s + h, 0);
      const poses = [];
      let y = 0;
      for (let k = 0; k < rangees.length; k++) {
        const membres = rangees[k];
        const hr = hauteurs[k];
        const ch = hr * sy;
        let x = 0;
        const sx = W / membres.reduce((s, p) => s + hr * (p.w / p.h), 0); // petit etirement en largeur
        for (const p of membres) {
          const cw = hr * (p.w / p.h) * sx;
          // Etape 3 : inclinaison au hasard (gauche ou droite) puis taille juste couvrante
          // Sans limite demandee, on plafonne quand meme l'agrandissement : un motif fin
          // tres incline devrait sinon etre agrandi 2 a 3 fois et ecraserait ses voisins
          const plafond = 1 - 1 / ((opts.agrandissementMax || AGRANDISSEMENT_MAX) ** 2);
          const max = angleLimite(p.item.aspect, cw, ch, opts.angleMax,
            opts.limiterAngle ? Math.min(opts.chevauchementMax, plafond) : plafond);
          const angle = (rnd() < 0.5 ? -1 : 1) * rnd() * max;
          const t = tailleCouvrante(p.item.aspect, cw, ch, angle);
          // Desordre : grossissement au hasard (jusqu'a +60 % si desordre = 100 %)
          const k = 1 + desordre * GROSSISSEMENT_DESORDRE * rnd();
          const w = t.w * MARGE_SECURITE * k, h = t.h * MARGE_SECURITE * k;
          // ... et decalage au hasard. Dans le repere du motif, la case tient dans une boite
          // de demi-cotes (bx, by) ; tant que le decalage (u, v) laisse cette boite dans le
          // motif, la case reste entierement couverte : le "zero blanc" est preserve.
          const a = angle * Math.PI / 180, co = Math.cos(Math.abs(a)), si = Math.sin(Math.abs(a));
          const bx = (cw * co + ch * si) / 2, by = (cw * si + ch * co) / 2;
          const u = desordre * (2 * rnd() - 1) * Math.max(0, w / 2 - bx);
          const v = desordre * (2 * rnd() - 1) * Math.max(0, h / 2 - by);
          const ca = Math.cos(a), sa = Math.sin(a);
          const cx = x + cw / 2 + u * ca - v * sa, cy = y + ch / 2 + u * sa + v * ca;
          poses.push({ item: p.item, rotated: false, angle, w, h, x: cx - w / 2, y: cy - h / 2,
            horsCase: 1 - (cw * ch) / (w * h) });
          x += cw;
        }
        y += ch;
      }
      // Ordre de dessin au hasard : personne n'est toujours dessus
      return { placements: melanger(poses, rnd) };
    });
    return { pages, unplaced: res.unplaced, stats: { complements } };
  }

  /*
   * Mesure sur la page finale (quadrillage de "pas" mm), dans l'ordre de dessin :
   * part cachee de chaque motif (partie dans la feuille recouverte par d'autres)
   * et surface blanche restante. Sert a afficher les vrais chiffres a Pierre.
   */
  function mesurer(page, W, H, pas) {
    const nx = Math.ceil(W / pas), ny = Math.ceil(H / pas);
    const proprio = new Int32Array(nx * ny).fill(-1);
    const surface = new Array(page.placements.length).fill(0);
    page.placements.forEach((p, k) => {
      const a = p.angle * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const r = Math.hypot(p.w, p.h) / 2; // cercle englobant : limite les cases a tester
      const i0 = Math.max(0, Math.floor((cx - r) / pas)), i1 = Math.min(nx - 1, Math.floor((cx + r) / pas));
      const j0 = Math.max(0, Math.floor((cy - r) / pas)), j1 = Math.min(ny - 1, Math.floor((cy + r) / pas));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * pas - cx, dy = (j + 0.5) * pas - cy;
        if (Math.abs(dx * co + dy * si) <= p.w / 2 && Math.abs(-dx * si + dy * co) <= p.h / 2) {
          proprio[j * nx + i] = k; surface[k]++;
        }
      }
    });
    const visible = new Array(surface.length).fill(0);
    let blancs = 0;
    for (const p of proprio) if (p === -1) blancs++; else visible[p]++;
    return { caches: surface.map((s, k) => (s ? 1 - visible[k] / s : 0)), blancMm2: blancs * pas * pas };
  }

  const api = { collage, mesurer, tailleCouvrante, partHorsCase, angleLimite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Collage = api;
})(this);
