/*
 * Planche d'essai couleurs : une page A3 qui imprime les memes motifs avec 6 reglages
 * de couleur differents (lignes A a F), plus une echelle de gris par ligne.
 * Pierre l'imprime une fois sur son papier, choisit la meilleure ligne, et l'applique.
 *
 * Ce module ne calcule que la MISE EN PAGE (positions en mm, origine en haut a gauche).
 * Le dessin des images est fait par app.js.
 */
(function (root) {
  'use strict';

  // Du plus neutre au plus eclairci. C = le prereglage "Papier 80 g".
  const VARIANTES = [
    { lettre: 'A', tonsMoyens: 0, luminosite: 0, contraste: 0, saturation: 0 },
    { lettre: 'B', tonsMoyens: 15, luminosite: 0, contraste: 0, saturation: 5 },
    { lettre: 'C', tonsMoyens: 30, luminosite: 0, contraste: 5, saturation: 15 },
    { lettre: 'D', tonsMoyens: 45, luminosite: 0, contraste: 5, saturation: 15 },
    { lettre: 'E', tonsMoyens: 30, luminosite: 5, contraste: 10, saturation: 25 },
    { lettre: 'F', tonsMoyens: 60, luminosite: 0, contraste: 10, saturation: 20 },
  ];
  const ECHELLE_CASES = 11; // echelle de gris : blanc, 10 %, 20 % ... noir

  const PAGE = { w: 297, h: 420 };
  const MARGE = 10, TITRE = 16, PIED = 12, TEXTE_LIGNE = 6, ESPACE = 4, LARGEUR_ECHELLE = 18;

  const signe = (v) => (v > 0 ? `+${v}` : `${v}`);
  const description = (v) => `${v.lettre}  -  Tons moyens ${signe(v.tonsMoyens)}   Luminosite ${signe(v.luminosite)}` +
    `   Contraste ${signe(v.contraste)}   Saturation ${signe(v.saturation)}`;

  // Place un motif (largeur/hauteur = aspect) entier dans une case, centre
  function contenir(aspect, x, y, w, h) {
    let dw = w, dh = w / aspect;
    if (dh > h) { dh = h; dw = h * aspect; }
    return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
  }

  /*
   * aspects : proportions (largeur/hauteur) des motifs choisis (1 a 3)
   * Retour : { images: [{ variante, motif (index), x, y, w, h }],
   *            echelles: [{ variante, x, y, w, h }], textes: [{ x, y, size, str }] }
   */
  function plan(aspects) {
    const n = Math.max(1, Math.min(3, aspects.length));
    const largeurUtile = PAGE.w - 2 * MARGE;
    const hauteurLigne = (PAGE.h - 2 * MARGE - TITRE - PIED) / VARIANTES.length;
    const hauteurCase = hauteurLigne - TEXTE_LIGNE - ESPACE;
    const largeurCase = (largeurUtile - LARGEUR_ECHELLE - n * ESPACE) / n;
    const images = [], echelles = [], textes = [];

    textes.push({ x: MARGE, y: MARGE + 7, size: 16, str: "Planche d'essai couleurs - BoxDessinChiote" });
    textes.push({ x: MARGE, y: MARGE + 13, size: 10, str: 'Imprimer en "taille reelle / 100 %" sur le papier habituel. Choisir la ligne la plus fidele.' });

    VARIANTES.forEach((v, i) => {
      const y0 = MARGE + TITRE + i * hauteurLigne;
      textes.push({ x: MARGE, y: y0 + TEXTE_LIGNE - 1.5, size: 11, str: description(v) });
      const yc = y0 + TEXTE_LIGNE;
      for (let k = 0; k < n; k++) {
        const xc = MARGE + k * (largeurCase + ESPACE);
        images.push({ variante: i, motif: k, ...contenir(aspects[k], xc, yc, largeurCase, hauteurCase) });
      }
      echelles.push({ variante: i, x: MARGE + largeurUtile - LARGEUR_ECHELLE, y: yc, w: LARGEUR_ECHELLE, h: hauteurCase });
    });

    textes.push({ x: MARGE, y: PAGE.h - MARGE - 3, size: 10,
      str: "Puis dans l'appli : Reglages > Couleurs > bouton de la lettre choisie (Appliquer A a F)." });
    return { images, echelles, textes };
  }

  const api = { VARIANTES, ECHELLE_CASES, PAGE, plan, contenir, description };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Planche = api;
})(this);
