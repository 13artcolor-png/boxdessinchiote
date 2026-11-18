/*
 * Generateur de PDF minimal, sans bibliotheque externe.
 *
 * Pourquoi l'ecrire nous-memes : un PDF qui ne contient que des images JPEG,
 * des traits et un peu de texte est un format simple. Le JPEG s'insere tel quel
 * dans le PDF (filtre DCTDecode), sans recompression. Zero dependance = l'appli
 * fonctionne hors ligne a la boutique, et rien ne peut casser lors d'une mise a jour.
 *
 * Unites d'entree : millimetres, origine en haut a gauche (comme le placement).
 * Le PDF compte en points (1 pt = 1/72 pouce) depuis le bas a gauche : on convertit.
 */
(function (root) {
  'use strict';
  const PT = 72 / 25.4; // points par millimetre

  const enc = (s) => {
    // Texte du PDF en ASCII uniquement (les accents seraient mal codes)
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };
  const n = (v) => (Math.round(v * 1000) / 1000).toString();
  const echapper = (s) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

  /*
   * pages : [{
   *   images: [{ jpeg: Uint8Array, pxW, pxH, x, y, w, h }],   // mm
   *   lines:  [{ x1, y1, x2, y2, width, gray }],               // mm, gray 0=noir 1=blanc
   *   texts:  [{ x, y, size, str }],                           // mm (ligne de base), taille en pt
   * }]
   * Retourne un tableau de morceaux (Uint8Array) a concatener (Blob ou Buffer).
   */
  function construirePdf(pages, pageWmm, pageHmm) {
    const W = pageWmm * PT, H = pageHmm * PT;
    const morceaux = [];
    const offsets = [];
    let position = 0;
    const ecrire = (u8) => { morceaux.push(u8); position += u8.length; };

    // Numerotation des objets : 1 catalogue, 2 arbre des pages, 3 police, puis par page
    let prochain = 4;
    const plan = pages.map((p) => {
      const pageObj = prochain++, contenuObj = prochain++;
      const imgObjs = p.images.map(() => prochain++);
      return { pageObj, contenuObj, imgObjs };
    });
    const total = prochain - 1;

    const objet = (num, corps, flux) => {
      offsets[num] = position;
      ecrire(enc(`${num} 0 obj\n${corps}\n`));
      if (flux) { ecrire(enc('stream\n')); ecrire(flux); ecrire(enc('\nendstream\n')); }
      ecrire(enc('endobj\n'));
    };

    // En-tete ; la 2e ligne (octets > 127) signale un fichier binaire aux logiciels
    ecrire(enc('%PDF-1.4\n'));
    ecrire(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    objet(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objet(2, `<< /Type /Pages /Count ${pages.length} /Kids [${plan.map((x) => `${x.pageObj} 0 R`).join(' ')}] >>`);
    objet(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    pages.forEach((p, i) => {
      const o = plan[i];
      const xobjs = o.imgObjs.map((num, k) => `/Im${k} ${num} 0 R`).join(' ');
      objet(o.pageObj, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] ` +
        `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjs} >> >> /Contents ${o.contenuObj} 0 R >>`);

      // Flux de dessin : traits d'abord (les images passent par-dessus), puis images, puis texte
      let c = '';
      for (const l of p.lines || []) {
        c += `q ${n(l.gray)} G ${n(l.width * PT)} w ${n(l.x1 * PT)} ${n(H - l.y1 * PT)} m ${n(l.x2 * PT)} ${n(H - l.y2 * PT)} l S Q\n`;
      }
      p.images.forEach((img, k) => {
        // Matrice [w 0 0 h x y] : etire l'image (1x1 unite) au rectangle voulu
        c += `q ${n(img.w * PT)} 0 0 ${n(img.h * PT)} ${n(img.x * PT)} ${n(H - (img.y + img.h) * PT)} cm /Im${k} Do Q\n`;
      });
      for (const t of p.texts || []) {
        c += `BT /F1 ${n(t.size)} Tf ${n(t.x * PT)} ${n(H - t.y * PT)} Td (${echapper(t.str)}) Tj ET\n`;
      }
      const flux = enc(c);
      objet(o.contenuObj, `<< /Length ${flux.length} >>`, flux);

      p.images.forEach((img, k) => {
        objet(o.imgObjs[k], `<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, img.jpeg);
      });
    });

    // Table des positions (xref) : chaque entree fait exactement 20 octets
    const debutXref = position;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let k = 1; k <= total; k++) xref += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
    ecrire(enc(xref));
    ecrire(enc(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`));
    return morceaux;
  }

  const api = { construirePdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfWriter = api;
})(this);
