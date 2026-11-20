/*
 * Reglages de couleur appliques aux motifs avant impression.
 *
 * Pourquoi : sur papier ordinaire (80 g, non couche), l'encre/le toner s'etale dans
 * les fibres ("engraissement du point") : les tons moyens et les ombres sortent plus
 * fonces qu'a l'ecran, et les couleurs plus ternes.
 *
 * Le MEME calcul sert a l'apercu et au PDF : ce qu'on voit = ce qui est imprime.
 *
 * Reglages (0 = aucun changement) :
 *   tonsMoyens -100..100 : correction gamma. Eclaircit (ou fonce) le milieu de la gamme
 *                          SANS toucher au blanc pur ni au noir pur. Le plus utile ici.
 *   luminosite  -50..50  : decale toute la gamme (blancs et noirs compris).
 *   contraste   -50..50  : ecarte (ou rapproche) les tons du gris moyen.
 *   saturation -100..100 : intensite des couleurs (-100 = noir et blanc).
 */
(function (root) {
  'use strict';

  const NEUTRE = { tonsMoyens: 0, luminosite: 0, contraste: 0, saturation: 0 };
  // Point de depart pour papier 80 g : a valider par une impression d'essai
  const PAPIER_80G = { tonsMoyens: 30, luminosite: 0, contraste: 5, saturation: 15 };

  const estNeutre = (r) => !r.tonsMoyens && !r.luminosite && !r.contraste && !r.saturation;

  // Table de correspondance : valeur d'entree 0..255 -> valeur de sortie 0..255
  // Ordre : tons moyens (gamma), puis contraste, puis luminosite.
  function table(r) {
    const g = Math.pow(2, (r.tonsMoyens || 0) / 100);   // 100 -> gamma 2 ; -100 -> 0.5
    const c = 1 + (r.contraste || 0) / 100;
    const l = (r.luminosite || 0) / 100;
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = Math.pow(v / 255, 1 / g);
      x = (x - 0.5) * c + 0.5;
      x += l;
      t[v] = Math.round(Math.min(1, Math.max(0, x)) * 255);
    }
    return t;
  }

  /*
   * Modifie sur place des pixels RGBA (ImageData.data). La transparence n'est pas touchee.
   * Saturation d'abord : chaque canal est rapproche (ou eloigne) du gris de meme luminance.
   */
  function appliquer(data, r) {
    if (estNeutre(r)) return data;
    const t = table(r);
    const s = 1 + (r.saturation || 0) / 100;
    for (let i = 0; i < data.length; i += 4) {
      let R = data[i], G = data[i + 1], B = data[i + 2];
      if (s !== 1) {
        const gris = 0.299 * R + 0.587 * G + 0.114 * B; // luminance percue
        R = Math.min(255, Math.max(0, Math.round(gris + (R - gris) * s)));
        G = Math.min(255, Math.max(0, Math.round(gris + (G - gris) * s)));
        B = Math.min(255, Math.max(0, Math.round(gris + (B - gris) * s)));
      }
      data[i] = t[R]; data[i + 1] = t[G]; data[i + 2] = t[B];
    }
    return data;
  }

  // Applique les reglages a tout un canvas (navigateur uniquement)
  function appliquerCanvas(cv, r) {
    if (estNeutre(r)) return;
    const ctx = cv.getContext('2d');
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    appliquer(img.data, r);
    ctx.putImageData(img, 0, 0);
  }

  const api = { NEUTRE, PAPIER_80G, estNeutre, table, appliquer, appliquerCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Couleurs = api;
})(this);
