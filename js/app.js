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
    angleMax: 30, chevMax: 20, limiterAngle: false, desordre: 50, // mode collage
    ...Couleurs.NEUTRE, // tonsMoyens, luminosite, contraste, saturation
  };

  let reglages = { ...DEFAUTS };
  let motifs = [];            // [{ id, nom, taille, blob, thumb, w, h, actif, exemplaires }]
  let montage = null;         // resultat du dernier calcul
  let urlsPdf = [], fichiersPdf = [];
  const TAILLE_PARTIE_MAX = 45 * 1024 * 1024; // sous la limite de 50 Mo de Chrome, avec une marge
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
    angleMax: ['r-angle', 'nombre'], chevMax: ['r-chev', 'nombre'], limiterAngle: ['r-limiter', 'case'],
    desordre: ['r-desordre', 'nombre'],
    // Curseurs de couleur (valeurs negatives permises) ; 3e element = affichage de la valeur
    tonsMoyens: ['r-tons', 'curseur', 'v-tons'], luminosite: ['r-lum', 'curseur', 'v-lum'],
    contraste: ['r-con', 'curseur', 'v-con'], saturation: ['r-sat', 'curseur', 'v-sat'],
  };
  // Reglages qui changent le texte affiche sur les cartes de motifs
  const CLES_CARTES = ['minCm', 'maxCm', 'repetitions', 'miroir', 'mode'];
  // Reglages de couleur : ils ne changent pas le placement, seulement l'aspect
  const CLES_COULEURS = ['tonsMoyens', 'luminosite', 'contraste', 'saturation'];
  const couleursActuelles = () => Object.fromEntries(CLES_COULEURS.map((c) => [c, reglages[c]]));
  const signe = (v) => (v > 0 ? `+${v}` : `${v}`);

  // Montre seulement les reglages utiles au mode de rangement choisi
  function majVisibiliteMode() {
    const parNombre = reglages.mode === 'nombre', collage = reglages.mode === 'collage';
    $('bloc-parpage').hidden = !parNombre;
    $('bloc-tailles').hidden = parNombre;
    $('bloc-collage').hidden = !collage;
    $('bloc-decoupe').hidden = collage; // marge, ecart, traits de coupe : inutiles pour une affiche
  }
  function afficherReglages() {
    for (const [cle, [id, type, aff]] of Object.entries(champs)) {
      if (type === 'case') $(id).checked = reglages[cle]; else $(id).value = reglages[cle];
      if (aff) $(aff).textContent = signe(reglages[cle]);
    }
    majVisibiliteMode();
  }

  // Couleurs changees : le placement reste valable, on redessine seulement l'apercu.
  // Le PDF deja cree ne correspond plus : on le cache.
  async function couleursChangees() {
    cacheReglees.clear();
    $('sortie-pdf').hidden = true;
    $('progression-pdf').hidden = true;
    if (montage) await dessinerApercus();
  }

  for (const [cle, [id, type, aff]] of Object.entries(champs)) {
    // Curseur : la valeur affichee suit le doigt pendant le glissement
    if (aff) $(id).addEventListener('input', () => { $(aff).textContent = signe(Number($(id).value)); });
    $(id).addEventListener('change', async () => {
      const v = type === 'case' ? $(id).checked : type === 'texte' ? $(id).value : Number($(id).value);
      if (type === 'curseur') {
        if (!Number.isFinite(v)) return;
        reglages[cle] = v;
        await Db.ecrireReglages(reglages);
        $('etat-sauvegarde').textContent = 'Enregistre.';
        await couleursChangees();
        return;
      }
      if (type === 'nombre' && !(v >= 0)) { $('etat-sauvegarde').textContent = 'Valeur invalide, non enregistree.'; return; }
      if (cle === 'parPage' && !(v >= 1)) { $('etat-sauvegarde').textContent = 'Il faut au moins 1 motif par page.'; return; }
      if (cle === 'angleMax' && !(v <= 45)) { $('etat-sauvegarde').textContent = 'Inclinaison : 45 degres maximum.'; return; }
      if (cle === 'chevMax' && !(v <= 90)) { $('etat-sauvegarde').textContent = 'Chevauchement : 90 % maximum.'; return; }
      if (cle === 'desordre' && !(v <= 100)) { $('etat-sauvegarde').textContent = 'Desordre : 100 % maximum.'; return; }
      reglages[cle] = v;
      await Db.ecrireReglages(reglages);
      $('etat-sauvegarde').textContent = 'Enregistre.';
      majVisibiliteMode();
      invaliderMontage();
      if (CLES_CARTES.includes(cle)) rafraichirGrille();
    });
  }

  // Boutons de prereglage des couleurs
  async function appliquerPreset(p) {
    Object.assign(reglages, p);
    await Db.ecrireReglages(reglages);
    afficherReglages();
    $('etat-sauvegarde').textContent = 'Enregistre.';
    await couleursChangees();
  }
  $('preset-80g').addEventListener('click', () => appliquerPreset(Couleurs.PAPIER_80G));
  $('preset-zero').addEventListener('click', () => appliquerPreset(Couleurs.NEUTRE));

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
      ? 'Aucun motif. Appuyez sur "Ajouter depuis Drive / Fichiers" pour choisir vos images dans Google Drive.'
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

  // Deux boutons d'import, meme traitement :
  //  - "fichiers" (accept="image/*") : Android ouvre son selecteur de PHOTOS (galerie seulement)
  //  - "fichiers-drive" (sans accept) : Android ouvre son explorateur de FICHIERS,
  //    qui donne acces a Google Drive. Les fichiers qui ne sont pas des images sont ecartes.
  for (const id of ['fichiers', 'fichiers-drive']) $(id).addEventListener('change', importer);
  async function importer(ev) {
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
    prog.textContent = `${ajoutes} motifs ajoutes` + (ignores ? `, ${ignores} deja presents` : '') + (erreurs ? `, ${erreurs} ecartes (pas des images ou illisibles)` : '') + '.';
    rafraichirGrille();
    invaliderMontage();
  }

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

    const enCollage = reglages.mode === 'collage';
    const opts = { ...optionsPage(), collage: enCollage };
    let res;
    if (enCollage) {
      res = Collage.collage(items, {
        pageW: A3.w, pageH: A3.h, angleMax: reglages.angleMax, chevauchementMax: reglages.chevMax / 100,
        limiterAngle: reglages.limiterAngle, desordre: reglages.desordre / 100, graine: Date.now(), // nouvelle graine = nouveau collage
      });
    } else res = parNombre ? Packer.packerParNombre(items, opts, reglages.parPage) : Packer.packer(items, opts);
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
    let resume = `${placesTot} exemplaires sur ${res.pages.length} page(s) A3.`;
    if (enCollage) {
      // Vrais chiffres, mesures sur les pages calculees (quadrillage de 2 mm)
      const caches = [];
      let blanc = 0;
      for (const pg of res.pages) { const m = Collage.mesurer(pg, A3.w, A3.h, 2); caches.push(...m.caches); blanc += m.blancMm2; }
      caches.sort((a, b) => a - b);
      const auDela = caches.filter((c) => c > reglages.chevMax / 100).length;
      resume += ` Partie cachee : ${Math.round(100 * caches[Math.floor(caches.length / 2)])} % en moyenne (mediane),`
        + ` ${auDela} motif(s) caches a plus de ${reglages.chevMax} %. Blanc visible : ${blanc === 0 ? 'aucun' : `${blanc} mm2`}.`;
      if (res.stats.complements) alertes.push(`${res.stats.complements} motif(s) repris une 2e fois pour couvrir entierement la derniere page.`);
    }
    $('resume').textContent = resume;
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

  // Vignette avec les reglages de couleur appliques (calculee une fois par motif,
  // le cache est vide a chaque changement de couleur)
  const cacheReglees = new Map();
  async function vignetteReglee(m) {
    const bmp = await bitmapVignette(m);
    if (Couleurs.estNeutre(couleursActuelles())) return bmp;
    if (!cacheReglees.has(m.id)) {
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0);
      Couleurs.appliquerCanvas(cv, couleursActuelles());
      cacheReglees.set(m.id, cv);
    }
    return cacheReglees.get(m.id);
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
      // Collage = affiche finale : ni traits de coupe ni regle
      const d = opts.collage ? { lines: [], texts: [] } : Decor.decorPage(page, i + 1, pages.length, opts);
      for (const l of d.lines) {
        ctx.strokeStyle = `rgb(${l.gray * 255},${l.gray * 255},${l.gray * 255})`;
        ctx.lineWidth = Math.max(1, l.width * k);
        ctx.beginPath(); ctx.moveTo(l.x1 * k, l.y1 * k); ctx.lineTo(l.x2 * k, l.y2 * k); ctx.stroke();
      }
      for (const p of page.placements) {
        const img = await vignetteReglee(p.item.motif);
        if (p.angle) {
          // Motif incline : on tourne le repere autour du centre du motif
          ctx.save();
          ctx.translate((p.x + p.w / 2) * k, (p.y + p.h / 2) * k);
          ctx.rotate(p.angle * Math.PI / 180);
          dessinerImage(ctx, img, -p.w / 2 * k, -p.h / 2 * k, p.w * k, p.h * k, p.rotated, p.item.miroir);
          ctx.restore();
        } else dessinerImage(ctx, img, p.x * k, p.y * k, p.w * k, p.h * k, p.rotated, p.item.miroir);
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
    Couleurs.appliquerCanvas(cv, couleursActuelles()); // meme calcul que l'apercu
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
        const d = opts.collage ? { lines: [], texts: [] } : Decor.decorPage(page, i + 1, pages.length, opts);
        const images = [];
        for (const p of page.placements) {
          prog.textContent = `Preparation des images : ${++fait} / ${total}`;
          const j = await jpegPour(p, reglages.dpi);
          images.push({ ...j, x: p.x, y: p.y, w: p.w, h: p.h, angle: p.angle || 0 });
        }
        pagesPdf.push({ images, lines: d.lines, texts: d.texts });
      }
      // Chrome refuse de partager plus de 50 Mo d'un coup ("Permission denied").
      // On coupe donc le lot en plusieurs PDF de 45 Mo maxi, un bouton Partager par partie.
      const groupes = PdfWriter.decouperEnParties(pagesPdf, TAILLE_PARTIE_MAX);
      for (const u of urlsPdf) URL.revokeObjectURL(u);
      urlsPdf = []; fichiersPdf = [];
      groupes.forEach((g, k) => {
        const blob = new Blob(PdfWriter.construirePdf(g.pages, A3.w, A3.h), { type: 'application/pdf' });
        const nom = groupes.length === 1 ? 'montage-A3.pdf'
          : `montage-A3-partie${k + 1}-sur${groupes.length}-pages${g.debut}-${g.fin}.pdf`;
        fichiersPdf.push(new File([blob], nom, { type: 'application/pdf' }));
        urlsPdf.push(URL.createObjectURL(blob));
      });
      afficherParties(groupes);
      const totalMo = fichiersPdf.reduce((s, f) => s + f.size, 0) / 1e6;
      prog.textContent = `PDF pret : ${pages.length} page(s) A3, ${totalMo.toFixed(1)} Mo`
        + (groupes.length > 1 ? `, en ${groupes.length} parties (limite de partage : 50 Mo par envoi)` : '')
        + `. Imprimez en "taille reelle / 100 %".`;
    } catch (e) {
      console.error(e);
      prog.textContent = `Erreur pendant la creation du PDF : ${e.message}`;
    } finally {
      $('creer-pdf').disabled = !montage;
    }
  });

  // Une ligne par partie : bouton Partager + lien Telecharger
  function afficherParties(groupes) {
    const zone = $('sortie-pdf');
    zone.innerHTML = '';
    groupes.forEach((g, k) => {
      const ligne = document.createElement('div');
      ligne.className = 'barre';
      const lesPages = g.debut === g.fin ? `page ${g.debut}` : `pages ${g.debut} a ${g.fin}`;
      const titre = groupes.length === 1 ? '' : `Partie ${k + 1} sur ${groupes.length} (${lesPages}) : `;
      if (titre) { const s = document.createElement('span'); s.className = 'titre-partie'; s.textContent = titre; ligne.append(s); }
      const b = document.createElement('button');
      b.className = 'principal';
      b.textContent = 'Imprimer / Partager';
      b.addEventListener('click', () => partager(k));
      const a = document.createElement('a');
      a.className = 'bouton';
      a.textContent = 'Telecharger le PDF';
      a.href = urlsPdf[k];
      a.download = fichiersPdf[k].name;
      ligne.append(b, a);
      zone.append(ligne);
    });
    zone.hidden = false;
  }

  // Envoi au service d'impression via le menu de partage (Android ou Windows)
  const partager = (k) => partagerFichier(fichiersPdf[k], $('progression-pdf'));
  async function partagerFichier(f, prog) {
    if (!f) return;
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: f.name }); }
      catch (e) { if (e.name !== 'AbortError') prog.textContent = `Partage impossible (${f.name}, ${(f.size / 1e6).toFixed(1)} Mo) : ${e.message}. Utilisez "Telecharger le PDF".`; }
    } else {
      prog.textContent = 'Partage non disponible ici : utilisez "Telecharger le PDF" puis ouvrez-le pour imprimer.';
    }
  }

  // ---------- Planche d'essai couleurs ----------
  const DPI_PLANCHE = 200;
  let urlPlanche = null, fichierPlanche = null;

  // Luminosite moyenne d'un motif (0 = noir, 255 = blanc), mesuree sur sa vignette
  async function luminositeMotif(m) {
    const bmp = await bitmapVignette(m);
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 32, 32);
    ctx.drawImage(bmp, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4);
  }

  // Choisit 3 motifs : le plus sombre, un moyen, le plus clair (parmi 60 tires au hasard)
  async function choisirMotifsPlanche() {
    let candidats = motifs.filter((m) => m.actif);
    if (candidats.length === 0) candidats = motifs.slice();
    candidats = candidats.map((m) => [Math.random(), m]).sort((a, b) => a[0] - b[0]).slice(0, 60).map((x) => x[1]);
    const mesures = [];
    for (const m of candidats) mesures.push({ m, l: await luminositeMotif(m) });
    mesures.sort((a, b) => a.l - b.l);
    if (mesures.length <= 3) return mesures.map((x) => x.m);
    return [mesures[0].m, mesures[Math.floor(mesures.length / 2)].m, mesures[mesures.length - 1].m];
  }

  // Dessine une source dans un canvas de la taille voulue, applique un reglage couleur -> JPEG
  async function jpegReglee(source, pxW, pxH, reglage) {
    const cv = document.createElement('canvas');
    cv.width = pxW; cv.height = pxH;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pxW, pxH);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, pxW, pxH);
    Couleurs.appliquerCanvas(cv, reglage);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.92));
    cv.width = cv.height = 0;
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), pxW, pxH };
  }

  // Echelle de gris : 11 bandes du blanc au noir (avant reglage)
  function canvasEchelle(pxW, pxH) {
    const cv = document.createElement('canvas');
    cv.width = pxW; cv.height = pxH;
    const ctx = cv.getContext('2d');
    const n = Planche.ECHELLE_CASES;
    for (let i = 0; i < n; i++) {
      const g = Math.round(255 * (1 - i / (n - 1)));
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(0, Math.round(i * pxH / n), pxW, Math.ceil(pxH / n) + 1);
    }
    return cv;
  }

  $('planche-creer').addEventListener('click', async () => {
    const etat = $('planche-etat');
    if (motifs.length === 0) { etat.textContent = "Ajoutez d'abord des motifs."; return; }
    $('planche-creer').disabled = true;
    $('planche-sortie').hidden = true;
    try {
      etat.textContent = 'Choix des motifs (sombre, moyen, clair)...';
      const choisis = await choisirMotifsPlanche();
      const p = Planche.plan(choisis.map((m) => m.w / m.h));
      const px = (mm) => Math.max(1, Math.round(mm / 25.4 * DPI_PLANCHE));
      const sources = [];
      for (const m of choisis) sources.push(await createImageBitmap(m.blob));
      const images = [];
      let fait = 0;
      for (const im of p.images) {
        etat.textContent = `Preparation des images : ${++fait} / ${p.images.length + p.echelles.length}`;
        const src = sources[im.motif];
        // Jamais plus de pixels que l'original
        const k = Math.min(1, src.width / px(im.w));
        const j = await jpegReglee(src, Math.max(1, Math.round(px(im.w) * k)), Math.max(1, Math.round(px(im.h) * k)), Planche.VARIANTES[im.variante]);
        images.push({ ...j, x: im.x, y: im.y, w: im.w, h: im.h });
      }
      for (const e of p.echelles) {
        etat.textContent = `Preparation des images : ${++fait} / ${p.images.length + p.echelles.length}`;
        const j = await jpegReglee(canvasEchelle(px(e.w), px(e.h)), px(e.w), px(e.h), Planche.VARIANTES[e.variante]);
        images.push({ ...j, x: e.x, y: e.y, w: e.w, h: e.h });
      }
      sources.forEach((s) => s.close());
      const blob = new Blob(PdfWriter.construirePdf([{ images, lines: [], texts: p.textes }], Planche.PAGE.w, Planche.PAGE.h), { type: 'application/pdf' });
      if (urlPlanche) URL.revokeObjectURL(urlPlanche);
      urlPlanche = URL.createObjectURL(blob);
      fichierPlanche = new File([blob], 'planche-essai-couleurs.pdf', { type: 'application/pdf' });
      $('planche-telecharger').href = urlPlanche;
      $('planche-sortie').hidden = false;
      etat.textContent = `Planche prete (${(blob.size / 1e6).toFixed(1)} Mo). Imprimez-la en "taille reelle / 100 %" sur votre papier habituel.`;
    } catch (e) {
      console.error(e);
      etat.textContent = `Erreur pendant la creation de la planche : ${e.message}`;
    } finally {
      $('planche-creer').disabled = false;
    }
  });
  $('planche-partager').addEventListener('click', () => partagerFichier(fichierPlanche, $('planche-etat')));

  // Un bouton par ligne de la planche : applique ses valeurs aux reglages
  for (const v of Planche.VARIANTES) {
    const b = document.createElement('button');
    b.textContent = `Appliquer ${v.lettre}`;
    b.title = Planche.description(v);
    b.addEventListener('click', async () => {
      const { lettre, ...valeurs } = v;
      await appliquerPreset(valeurs);
      $('planche-etat').textContent = `Ligne ${lettre} appliquee : ${Planche.description(v).slice(5)}`;
    });
    $('planche-appliquer').append(b);
  }

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
