/*
 * Elements imprimes en plus des motifs : traits de coupe et regle de controle.
 * Partage entre l'appli (apercu + PDF) et les tests Node.
 */
(function (root) {
  'use strict';

  function decorPage(page, numero, totalPages, opts) {
    const lines = [], texts = [];
    const demi = opts.gap / 2;
    const trait = { width: 0.2, gray: 0.55 };

    if (opts.cutLines) {
      // Coupes massicot : un trait horizontal sur toute la largeur, au-dessus et
      // au-dessous de chaque rangee (milieu de l'ecart). Il deborde dans la marge
      // pour rester visible meme avec un ecart de 0.
      const ys = new Set();
      for (const r of page.rows) { ys.add(r.y - demi); ys.add(r.y + r.h + demi); }
      for (const y of ys) lines.push({ x1: 2, y1: y, x2: opts.pageW - 2, y2: y, ...trait });
      // Coupes dans chaque bande : traits verticaux entre les motifs
      for (const r of page.rows) {
        const membres = page.placements.filter((p) => Math.abs(p.y - r.y) < 1e-6);
        const xs = [r.x0 - demi, ...membres.map((p) => p.x + p.w + demi)];
        for (const x of xs) lines.push({ x1: x, y1: r.y - demi, x2: x, y2: r.y + r.h + demi, ...trait });
      }
    }

    // Regle de controle de 10 cm en bas de page
    const yR = opts.pageH - opts.margin - 2;
    const x0 = opts.margin;
    lines.push({ x1: x0, y1: yR, x2: x0 + 100, y2: yR, width: 0.25, gray: 0 });
    for (let cm = 0; cm <= 10; cm++) {
      const haut = cm === 0 || cm === 10 ? 3 : cm === 5 ? 2 : 1.2;
      lines.push({ x1: x0 + cm * 10, y1: yR, x2: x0 + cm * 10, y2: yR - haut, width: 0.25, gray: 0 });
    }
    texts.push({ x: x0 + 104, y: yR, size: 8, str: '<- 10 cm : a verifier a la regle (imprimer en taille reelle 100 %)' });
    texts.push({ x: opts.pageW - opts.margin - 22, y: yR, size: 9, str: `Page ${numero} / ${totalPages}` });
    return { lines, texts };
  }

  const api = { decorPage, FOOTER_MM: 10 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Decor = api;
})(this);
