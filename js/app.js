/*
 * BoxDessinChiote — logique de l'interface.
 * Trois onglets : Motifs (bibliotheque), Montage (apercu + PDF), Reglages.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A3 = { w: 297, h: 420 };
  const DPI_MINI_CONSEILLE = 150; // en dessous, l'image risque d'etre floue
  const DEFAUTS = {
    minCm: 6, maxCm: 10, margeMm: 5, ecartMm: 4, rotation: true, traits: true, dpi: 200,
    repetitions: 1, miroir: 0, mode: 'taille', parPage: 6,
  };

  let reglages = { ...DEFAUTS };
  let motifs = [];            // [{ id, nom, taille, blob, thumb, w, h, actif, exemplaires }]
  let montage = null;         // resultat du dernier calcul
  let urlPdf = null, fichierPdf = null;
  const urlsVignettes = new Map();

  // ---------- Onglets ----------
  document.querySelectorAll('.onglet').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.onglet').forEach((x) => x.classList.toggle('actif', x === b));
    document.querySelectorAll('.panneau').forEach((p) => p.classList.toggle('actif', p.id === b.dataset.onglet));
  }));

  // ---------- Reglages (sauvegarde automatique a chaque changement) ----------
  const champs = {
    minCm: ['r-min', 'nombre'], maxCm: ['r-max', 'nombre'], margeMm: ['r-marge', 'nombre'],
    ecartMm: ['r-ecart', 'nombre'], rotation: ['r-rotation', 'case'], traits: ['r-traits', 'case'], dpi: ['r-dpi', 'nombre'],
    repetitions: ['r-repet', 'nombre'], miroir: ['r-miroir', 'nombre'], mode: ['r-mode', 'texte'], parPage: ['r-parpage', 'nombre'],
  };
  // Reglages qui changent le texte affiche sur les cartes de motifs
  const CLES_CARTES = ['minCm', 'maxCm', 'repetitions', 'miroir', 'mode'];

  // Montre seulement les reglages utiles au mode de rangement choisi
  function majVisibiliteMode() {
    const parNombre = reglages.mode === 'nombre';
    $('bloc-parpage').hidden = !parNombre;
    $('bloc-tailles').hidden = parNombre;
  }
  function afficherReglages() {
    for (const [cle, [id, type]] of Object.entries(champs)) {
      if (type === 'case') $(id).checked = reglages[cle]; else $(id).value = reglages[cle];
    }
    majVisibiliteMode();
  }
  for (const [cle, [id, type]] of Object.entries(champs)) {
    $(id).addEventListener('change', async () => {
      const v = type === 'case' ? $(id).checked : type === 'texte' ? $(id).value : Number($(id).value);
      if (type === 'nombre' && !(v >= 0)) { $('etat-sauvegarde').textContent = 'Valeur invalide, non enregistree.'; return; }
      if (cle === 'parPage' && !(v >= 1)) { $('etat-sauvegarde').textContent = 'Il faut au moins 1 motif par page.'; return; }
      reglages[cle] = v;
      await Db.ecrireReglages(reglages);
      $('etat-sauvegarde').textContent = 'Enregistre.';
      majVisibiliteMode();
      invaliderMontage();
      if (CLES_CARTES.includes(cle)) rafraichirGrille();
    });
  }

  // ---------- Bibliotheque ----------
  function urlVignette(m) {
    if (!urlsVignettes.has(m.id)) urlsVignettes.set(m.id, URL.createObjectURL(m.thumb));
    return urlsVignettes.get(m.id);
  }
  // Sans personnalisation : le nombre de repetitions choisi dans les reglages
  const exemplairesDe = (m) => m.exemplaires || [{ qte: reglages.repetitions, minCm: reglages.minCm, maxCm: reglages.maxCm }];

  // Resolution reelle a la taille maxi : signale les images trop petites
  function dpiAuMaxi(m, maxCm) {
    return Math.min(m.w, m.h) / (maxCm / 2.54);
  }

  function carteMotif(m) {
    const c = document.createElement('div');
    c.className = 'motif' + (m.actif ? '' : ' inactif');
    c.dataset.id = m.id;
    const ex = exemplairesDe(m);
    const maxMax = Math.max(...ex.map((e) => e.maxCm));
    const dpi = dpiAuMaxi(m, maxMax);
    c.innerHTML = `
      <img loading="lazy" alt="" src="${urlVignette(m)}">
      <div class="dims">${m.w} x ${m.h} px</div>
      ${dpi < DPI_MINI_CONSEILLE ? `<div class="basse">Image petite : ${Math.round(dpi)} dpi a ${maxMax} cm</div>` : ''}
      <label class="case"><input type="checkbox" class="actif" ${m.actif ? 'checked' : ''}> Utiliser</label>
      <div class="liste-ex"></div>
      <button class="ajout-ex">${m.exemplaires ? 'Ajouter une taille' : 'Personnaliser'}</button>`;

    const liste = c.querySelector('.liste-ex');
    if (!m.exemplaires) {
      const taille = reglages.mode === 'nombre' ? 'taille auto' : `${reglages.minCm} a ${reglages.maxCm} cm`;
      const miroir = reglages.repetitions > 1 && reglages.miroir ? ', 2e en miroir' : '';
      liste.innerHTML = `<div class="info">${reglages.repetitions} fois${miroir}, ${taille}</div>`;
    } else {
      m.exemplaires.forEach((e, i) => {
        const ligne = document.createElement('div');
        ligne.innerHTML = `
          <div class="exemplaire">
            <label>Nombre<input type="number" min="0" step="1" data-k="qte" value="${e.qte}"></label>
            <label>Min cm<input type="number" min="1" step="0.5" data-k="minCm" value="${e.minCm}"></label>
            <label>Max cm<input type="number" min="1" step="0.5" data-k="maxCm" value="${e.maxCm}"></label>
            <button class="retirer">Retirer</button>
          </div>`;
        ligne.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', async () => {
          const v = Number(inp.value);
          if (!(v >= 0)) return;
          e[inp.dataset.k] = v;
          await sauver(m);
        }));
        ligne.querySelector('.retirer').addEventListener('click', async () => {
          m.exemplaires.splice(i, 1);
          if (m.exemplaires.length === 0) m.exemplaires = null; // retour a la taille par defaut
          await sauver(m, true);
        });
        liste.appendChild(ligne);
      });
    }
    c.querySelector('.actif').addEventListener('change', async (ev) => {
      m.actif = ev.target.checked;
      c.classList.toggle('inactif', !m.actif);
      await sauver(m);
    });
    c.querySelector('.ajout-ex').addEventListener('click', async () => {
      if (!m.exemplaires) m.exemplaires = [{ qte: reglages.repetitions, minCm: reglages.minCm, maxCm: reglages.maxCm }];
      else m.exemplaires.push({ qte: 1, minCm: reglages.minCm, maxCm: reglages.maxCm });
      await sauver(m, true);
    });
    return c;
  }

  // Enregistre un motif ; redessine sa carte si sa structure a change
  async function sauver(m, redessiner) {
    await Db.enregistrerMotif(m);
    invaliderMontage();
    if (redessiner) {
      const ancienne = document.querySelector(`.motif[data-id="${m.id}"]`);
      if (ancienne) ancienne.replaceWith(carteMotif(m));
    }
    majInfosBiblio();
  }

  function rafraichirGrille() {
    const g = $('grille');
    g.innerHTML = '';
    const frag = document.createDocumentFragment();
    motifs.forEach((m) => frag.appendChild(carteMotif(m)));
    g.appendChild(frag);
    majInfosBiblio();
  }
  function majInfosBiblio() {
    const actifs = motifs.filter((m) => m.actif);
    const nb = actifs.reduce((s, m) => s + exemplairesDe(m).reduce((t, e) => t + e.qte, 0), 0);
    $('infos-biblio').textContent = motifs.length === 0
      ? 'Aucun motif. Appuyez sur "Ajouter des motifs" (vous pouvez choisir dans Google Drive).'
      : `${motifs.length} motifs, ${actifs.length} utilises, ${nb} exemplaires a imprimer.`;
  }

  // Import : lit les dimensions et fabrique une vignette legere pour l'affichage
  async function vignette(bitmap) {
    const T = 300, k = Math.min(1, T / Math.max(bitmap.width, bitmap.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bitmap.width * k); cv.height = Math.round(bitmap.height * k);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); // transparence -> blanc
    ctx.drawImage(bitmap, 0, 0, cv.width, cv.height);
    return new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.8));
  }

  $('fichiers').addEventListener('change', async (ev) => {
    const fichiers = [...ev.target.files];
    ev.target.value = '';
    const deja = new Set(motifs.map((m) => `${m.nom}|${m.taille}`));
    const prog = $('progression-import');
    prog.hidden = false;
    let ajoutes = 0, ignores = 0, erreurs = 0;
    for (let i = 0; i < fichiers.length; i++) {
      const f = fichiers[i];
      prog.textContent = `Import ${i + 1} / ${fichiers.length}...`;
      if (deja.has(`${f.name}|${f.size}`)) { ignores++; continue; }
      try {
        const bmp = await createImageBitmap(f);
        const m = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          nom: f.name, taille: f.size, blob: f, thumb: await vignette(bmp),
          w: bmp.width, h: bmp.height, actif: true, exemplaires: null,
        };
        bmp.close();
        await Db.enregistrerMotif(m);
        motifs.push(m);
        deja.add(`${f.name}|${f.size}`);
        ajoutes++;
      } catch (e) {
        erreurs++;
        console.error('Import impossible', f.name, e);
      }
    }
    prog.textContent = `${ajoutes} motifs ajoutes` + (ignores ? `, ${ignores} deja presents` : '') + (erreurs ? `, ${erreurs} illisibles` : '') + '.';
    rafraichirGrille();
    invaliderMontage();
  });

  async function toutMettre(actif) {
    for (const m of motifs) { if (m.actif !== actif) { m.actif = actif; await Db.enregistrerMotif(m); } }
    rafraichirGrille();
    invaliderMontage();
  }
  $('tout-utiliser').addEventListener('click', () => toutMettre(true));
  $('rien-utiliser').addEventListener('click', () => toutMettre(false));

  // Suppression en deux temps (pas de confirm() : bouton de confirmation dans la page)
  let suppressionArmee = null;
  $('supprimer-inutilises').addEventListener('click', async () => {
    const b = $('supprimer-inutilises');
    const cibles = motifs.filter((m) => !m.actif);
    if (cibles.length === 0) { b.textContent = 'Aucun motif non utilise'; return; }
    if (!suppressionArmee) {
      b.textContent = `Confirmer : supprimer ${cibles.length} motifs du telephone`;
      suppressionArmee = setTimeout(() => { suppressionArmee = null; b.textContent = 'Supprimer les motifs non utilises'; }, 5000);
      return;
    }
    clearTimeout(suppressionArmee); suppressionArmee = null;
    for (const m of cibles) {
      await Db.supprimerMotif(m.id);
      if (urlsVignettes.has(m.id)) { URL.revokeObjectURL(urlsVignettes.get(m.id)); urlsVignettes.delete(m.id); }
    }
    motifs = motifs.filter((m) => m.actif);
    b.textContent = 'Supprimer les motifs non utilises';
    rafraichirGrille();
    invaliderMontage();
  });

  // ---------- Montage ----------
  function optionsPage() {
    return {
      pageW: A3.w, pageH: A3.h, margin: reglages.margeMm, gap: reglages.ecartMm,
      footer: Decor.FOOTER_MM, rotate: reglages.rotation, cutLines: reglages.traits,
    };
  }

  function invaliderMontage() {
    montage = null;
    $('creer-pdf').disabled = true;
    $('sortie-pdf').hidden = true;
    $('progression-pdf').hidden = true; // l'ancien PDF ne correspond plus
    if ($('apercus').childElementCount > 0) $('resume').textContent = 'Les motifs ou reglages ont change : recalculez le montage.';
  }

  $('calculer').addEventListener('click', async () => {
    const items = [], alertes = [];
    const parNombre = reglages.mode === 'nombre';
    for (const m of motifs.filter((x) => x.actif)) {
      let rang = 0; // numero de l'exemplaire pour ce motif : 0 = 1er, 1 = 2e...
      exemplairesDe(m).forEach((e, k) => {
        if (!parNombre && e.minCm > e.maxCm) { alertes.push(`Un motif a un mini (${e.minCm} cm) plus grand que son maxi (${e.maxCm} cm) : ignore.`); return; }
        for (let q = 0; q < e.qte; q++, rang++) {
          items.push({
            id: `${m.id}#${k}#${q}`, motif: m, aspect: m.w / m.h, minMm: e.minCm * 10, maxMm: e.maxCm * 10,
            miroir: Boolean(reglages.miroir) && rang % 2 === 1, // un exemplaire sur deux en miroir
          });
        }
      });
    }
    if (items.length === 0) { $('resume').textContent = 'Aucun motif a placer : cochez "Utiliser" sur au moins un motif.'; return; }

    const opts = optionsPage();
    const res = parNombre ? Packer.packerParNombre(items, opts, reglages.parPage) : Packer.packer(items, opts);
    montage = { ...res, opts };

    // Controle qualite : resolution effective de chaque exemplaire place
    let flous = 0;
    for (const p of res.pages.flatMap((pg) => pg.placements)) {
      const dpi = Math.min(p.item.motif.w, p.item.motif.h) / (Math.min(p.w, p.h) / 25.4);
      if (dpi < DPI_MINI_CONSEILLE) flous++;
    }
    if (res.unplaced.length) alertes.push(`${res.unplaced.length} exemplaire(s) trop grand(s) pour une page A3 : non places. Reduisez leur taille mini.`);
    if (flous) alertes.push(`${flous} exemplaire(s) imprime(s) a moins de ${DPI_MINI_CONSEILLE} dpi : risque de flou. Reduisez leur taille maxi.`);

    const placesTot = res.pages.reduce((s, p) => s + p.placements.length, 0);
    $('resume').textContent = `${placesTot} exemplaires sur ${res.pages.length} page(s) A3.`;
    $('alertes').innerHTML = alertes.map((a) => `<div class="alerte">${a}</div>`).join('');
    $('creer-pdf').disabled = res.pages.length === 0;
    $('sortie-pdf').hidden = true;
    $('progression-pdf').hidden = true;
    await dessinerApercus();
  });

  // Charge une vignette en bitmap (pour l'apercu, rapide)
  const cacheVignettes = new Map();
  async function bitmapVignette(m) {
    if (!cacheVignettes.has(m.id)) cacheVignettes.set(m.id, await createImageBitmap(m.thumb));
    return cacheVignettes.get(m.id);
  }

  // Dessine une image dans un rectangle, tournee de 90 degres (sens horaire) et/ou
  // en miroir si besoin. Le miroir se fait dans le repere de l'image elle-meme :
  // une fois decoupe et remis droit, le motif est bien inverse gauche-droite.
  function dessinerImage(ctx, img, x, y, w, h, tourne, miroir) {
    ctx.save();
    let dw = w, dh = h;
    if (tourne) { ctx.translate(x + w, y); ctx.rotate(Math.PI / 2); dw = h; dh = w; }
    else ctx.translate(x, y);
    if (miroir) { ctx.translate(dw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(img, 0, 0, dw, dh);
    ctx.restore();
  }

  async function dessinerApercus() {
    const zone = $('apercus');
    zone.innerHTML = '';
    const { pages, opts } = montage;
    const k = 2; // pixels par mm pour l'apercu
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const cv = document.createElement('canvas');
      cv.width = A3.w * k; cv.height = A3.h * k;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      const d = Decor.decorPage(page, i + 1, pages.length, opts);
      for (const l of d.lines) {
        ctx.strokeStyle = `rgb(${l.gray * 255},${l.gray * 255},${l.gray * 255})`;
        ctx.lineWidth = Math.max(1, l.width * k);
        ctx.beginPath(); ctx.moveTo(l.x1 * k, l.y1 * k); ctx.lineTo(l.x2 * k, l.y2 * k); ctx.stroke();
      }
      for (const p of page.placements) {
        dessinerImage(ctx, await bitmapVignette(p.item.motif), p.x * k, p.y * k, p.w * k, p.h * k, p.rotated, p.item.miroir);
      }
      const fig = document.createElement('figure');
      fig.appendChild(cv);
      const cap = document.createElement('figcaption');
      cap.textContent = `Page ${i + 1} : ${page.placements.length} motifs`;
      fig.appendChild(cap);
      zone.appendChild(fig);
    }
  }

  // ---------- PDF ----------
  // Prepare le JPEG d'un exemplaire a la bonne resolution (jamais plus que l'original)
  async function jpegPour(p, dpi) {
    const m = p.item.motif;
    const voulu = Math.min(p.w, p.h) / 25.4 * dpi;          // petit cote voulu en pixels
    const k = Math.min(1, Math.min(m.w, m.h) / voulu);      // pas d'agrandissement inutile
    const pxW = Math.max(1, Math.round(p.w / 25.4 * dpi * k));
    const pxH = Math.max(1, Math.round(p.h / 25.4 * dpi * k));
    const bmp = await createImageBitmap(m.blob);
    const cv = document.createElement('canvas');
    cv.width = pxW; cv.height = pxH;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pxW, pxH);
    ctx.imageSmoothingQuality = 'high';
    dessinerImage(ctx, bmp, 0, 0, pxW, pxH, p.rotated, p.item.miroir);
    bmp.close();
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.9));
    cv.width = cv.height = 0; // libere la memoire du canvas
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), pxW, pxH };
  }

  $('creer-pdf').addEventListener('click', async () => {
    if (!montage) return;
    const { pages, opts } = montage;
    const prog = $('progression-pdf');
    prog.hidden = false;
    $('creer-pdf').disabled = true;
    const total = pages.reduce((s, p) => s + p.placements.length, 0);
    let fait = 0;
    try {
      const pagesPdf = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const d = Decor.decorPage(page, i + 1, pages.length, opts);
        const images = [];
        for (const p of page.placements) {
          prog.textContent = `Preparation des images : ${++fait} / ${total}`;
          const j = await jpegPour(p, reglages.dpi);
          images.push({ ...j, x: p.x, y: p.y, w: p.w, h: p.h });
        }
        pagesPdf.push({ images, lines: d.lines, texts: d.texts });
      }
      const morceaux = PdfWriter.construirePdf(pagesPdf, A3.w, A3.h);
      const blob = new Blob(morceaux, { type: 'application/pdf' });
      if (urlPdf) URL.revokeObjectURL(urlPdf);
      urlPdf = URL.createObjectURL(blob);
      fichierPdf = new File([blob], 'montage-A3.pdf', { type: 'application/pdf' });
      $('telecharger').href = urlPdf;
      $('sortie-pdf').hidden = false;
      prog.textContent = `PDF pret : ${pages.length} page(s) A3, ${(blob.size / 1e6).toFixed(1)} Mo. Imprimez en "taille reelle / 100 %".`;
    } catch (e) {
      console.error(e);
      prog.textContent = `Erreur pendant la creation du PDF : ${e.message}`;
    } finally {
      $('creer-pdf').disabled = !montage;
    }
  });

  // Envoi au service d'impression via le menu de partage Android
  $('partager').addEventListener('click', async () => {
    if (!fichierPdf) return;
    if (navigator.canShare && navigator.canShare({ files: [fichierPdf] })) {
      try { await navigator.share({ files: [fichierPdf], title: 'Montage A3' }); }
      catch (e) { if (e.name !== 'AbortError') $('progression-pdf').textContent = `Partage impossible : ${e.message}`; }
    } else {
      $('progression-pdf').textContent = 'Partage non disponible ici : utilisez "Telecharger le PDF" puis ouvrez-le pour imprimer.';
    }
  });

  // ---------- Demarrage ----------
  async function demarrer() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // evite l'effacement auto par Android
    const r = await Db.lireReglages();
    if (r) reglages = { ...DEFAUTS, ...r };
    afficherReglages();
    motifs = await Db.tousLesMotifs();
    rafraichirGrille();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non installe', e));
    }
  }
  demarrer().catch((e) => { console.error(e); $('infos-biblio').textContent = `Erreur au demarrage : ${e.message}`; });
})();
