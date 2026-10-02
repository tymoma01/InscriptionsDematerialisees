const path = require('node:path');
const PDFDocument = require('pdfkit');

// PDF d'une demande DPAE (2026-10-02, demande utilisateur) — généré CÔTÉ SERVEUR (pdfkit, pur
// JavaScript, aucun navigateur embarqué). Contenu : EXACTEMENT les sections et champs de la fiche
// (frontend/src/pages/rh/DetailDemandeDpae.jsx), dans le même ordre et avec les mêmes règles
// d'affichage (une ligne vide n'est pas affichée), plus le statut et sa date. Rien de plus : aucune
// donnée que la fiche ne montre pas. Les notes de la demande (composant séparé sous la fiche) ne
// sont pas reprises. Toute évolution de la fiche doit être reportée dans sectionsDemande ci-dessous.
//
// Module spécifique à ACCECIT, comme tout le module Demandes DPAE (voir dpae.routes.js).

// Libellés — miroir de DetailDemandeDpae.jsx (types, postes, jours) et de
// frontend/src/core/dpae/statutsDpae.js (statuts).
const LIBELLE_PAR_TYPE = {
  nouvelle_embauche: 'Nouvelle embauche',
  prolongation: 'Prolongation',
  ajout_retrait_jours: 'Ajout/retrait de jours',
  passage_cdi: 'Passage CDI',
  changement_horaires_affectation: 'Changement horaires/affectation',
};
const LIBELLE_PAR_POSTE = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafetier',
  equipier: 'Équipier',
  gouvernant: 'Gouvernant(e)',
  autre: 'Autre',
};
const JOURS_SEMAINE_LIBELLE = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};
const LIBELLE_PAR_STATUT = {
  envoyee: 'À traiter',
  en_attente: 'En attente',
  validee: 'Validée',
  rejetee: 'Rejetée',
};

// Heure de Paris quel que soit le fuseau du serveur (conteneur en UTC) : les colonnes `date` arrivent
// en Date à minuit heure de Paris, les horodatages en instant UTC.
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

const formaterDate = (valeur) => FORMAT_DATE.format(new Date(valeur));
const formaterDateHeure = (valeur) => FORMAT_DATE_HEURE.format(new Date(valeur));

// Même règle que ligne() de la fiche : valeur nulle, indéfinie ou vide -> ligne non affichée.
function ligne(libelle, valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return [libelle, String(valeur)];
}

// Mêmes sites et même forme « NOM (INITIALES) » que la fiche, mais un site par ligne (la fiche les
// sépare par des virgules) : à l'impression, un nom de site n'est jamais coupé entre deux lignes.
function texteSitesAffectation(demande) {
  return (demande.sites_affectation ?? []).map((site) => `${site.nom} (${site.initiales})`).join('\n');
}

// Statut et date associée, telle que la fiche la montre : réception (« À traiter »), mise en
// attente (« En attente »), traitement (« Validée »/« Rejetée »).
function statutEtDate(demande) {
  const dateParStatut = {
    envoyee: demande.date_creation,
    en_attente: demande.date_mise_en_attente,
    validee: demande.date_traitement,
    rejetee: demande.date_traitement,
  };
  const date = dateParStatut[demande.statut] ?? demande.date_creation;
  return {
    libelle: LIBELLE_PAR_STATUT[demande.statut] ?? demande.statut,
    date: date ? formaterDateHeure(date) : null,
  };
}

// Sections de la fiche, dans l'ordre de DetailDemandeDpae.jsx : [{ titre, lignes: [[libellé,
// valeur]], texte?, liste? }]. Fonction pure, testable sans PDF. Une section conditionnelle de la
// fiche (Modifications demandées, Gestion des jours, Autre chose à signaler) n'apparaît que dans
// les mêmes conditions.
function sectionsDemande(demande) {
  const sections = [];
  const garder = (lignes) => lignes.filter(Boolean);

  sections.push({
    titre: 'Demande',
    lignes: garder([
      ligne('Type', LIBELLE_PAR_TYPE[demande.type_demande] ?? demande.type_demande),
      ligne('Reçue le', formaterDateHeure(demande.date_creation)),
      ligne('Demandée par', `${demande.demandeur_prenom} ${demande.demandeur_nom}`),
      demande.date_traitement &&
        ligne('Traitée le', `${formaterDateHeure(demande.date_traitement)} par ${demande.traitant_prenom} ${demande.traitant_nom}`),
      demande.statut === 'rejetee' && ligne('Motif de rejet', demande.motif_rejet),
      demande.statut === 'en_attente' &&
        demande.date_mise_en_attente &&
        ligne('Mise en attente le', formaterDateHeure(demande.date_mise_en_attente)),
      demande.statut === 'en_attente' && ligne('Motif de mise en attente', demande.motif_mise_en_attente),
    ]),
  });

  sections.push({
    titre: 'Salarié',
    lignes: garder([
      ligne('Téléphone', demande.salarie_telephone),
      ligne('A déjà travaillé chez nous', demande.salarie_deja_employe ? 'Oui' : 'Non'),
      (demande.sites_affectation ?? []).length > 0
        ? ligne("Sites d'affectation", texteSitesAffectation(demande))
        : ligne("Site d'affectation", demande.hotel),
    ]),
  });

  const motifCdd =
    demande.motif_cdd === 'remplacement_absent'
      ? 'Remplacer salarié absent'
      : demande.motif_cdd === 'surcroit_activite'
        ? "Surcroît d'activité"
        : null;
  sections.push({
    titre: 'Contrat',
    lignes: garder([
      ligne('Type de contrat', demande.type_contrat?.toUpperCase()),
      ligne('Motif CDD', motifCdd),
      ligne('Salarié remplacé', demande.salarie_remplace_nom),
      ligne('Date de fin d’absence', demande.date_fin_absence && formaterDate(demande.date_fin_absence)),
      ligne('Raison du surcroît', demande.raison_surcroit),
      ligne('Entité', demande.division === 'autre' ? demande.division_autre : demande.division?.toUpperCase()),
      ligne('Poste', demande.poste === 'autre' ? demande.poste_autre : LIBELLE_PAR_POSTE[demande.poste]),
      ligne('Premier jour', demande.date_debut && formaterDate(demande.date_debut)),
      ligne('Dernier jour', demande.date_fin && formaterDate(demande.date_fin)),
      ligne('Heure d’arrivée jour 1', demande.heure_arrivee_j1),
      ligne('Heures/mois', demande.heures_par_mois),
    ]),
  });

  if (demande.modifications_demandees) {
    sections.push({
      titre: 'Modifications demandées',
      lignes: garder([
        ligne('Horaires', demande.modification_horaires ? 'Oui' : null),
        ligne('Jours de repos', demande.modification_jours_repos ? 'Oui' : null),
        ligne('Hôtel ou poste', demande.modification_affectation ? 'Oui' : null),
        ligne('Nouvelle affectation', demande.nouvelle_affectation),
      ]),
    });
  }

  if (demande.type_demande === 'ajout_retrait_jours') {
    const joursConcernes = demande.jours_concernes ?? [];
    sections.push({
      titre: 'Gestion des jours',
      lignes: garder([
        ligne('Type', demande.type_changement_jours === 'ajouter' ? 'Ajouter des jours' : 'Retirer des jours'),
        joursConcernes.length > 0 &&
          ligne(
            'Jours concernés',
            joursConcernes
              .map((jour) => (jour.date ? formaterDate(jour.date) : null))
              .filter(Boolean)
              .join(', '),
          ),
        ligne('Raison', demande.raison_changement_jours),
      ]),
    });
  }

  const semaineTravaillee = (demande.semaine_type ?? []).filter((jour) => jour.statut === 'travail');
  sections.push({
    titre: 'Semaine type',
    lignes: [],
    ...(semaineTravaillee.length === 0
      ? { texte: 'Aucun jour de travail renseigné.' }
      : {
          liste: semaineTravaillee.map(
            (jour) =>
              `${JOURS_SEMAINE_LIBELLE[jour.jour] ?? jour.jour}${jour.heureDebut && jour.heureFin ? ` : ${jour.heureDebut} – ${jour.heureFin}` : ''}`,
          ),
        }),
  });

  if (demande.autre_chose_signaler) {
    sections.push({ titre: 'Autre chose à signaler', lignes: [], texte: demande.autre_chose_signaler });
  }

  return sections;
}

// Sous-marque ACCECIT de l'en-tête (Hôtellerie/Tertiaire). Une demande n'a aucun champ
// « secteur » : seul le champ « Entité » (colonne `division`) l'indique, et seulement pour ACCHOT
// (ACCECIT Hôtellerie). Toute autre valeur (RM, Autre, non renseignée) : logo ACCECIT général,
// sans sous-marque — jamais une sous-marque devinée. Compléter cette table si une valeur doit
// afficher « Tertiaire ».
const SOUS_MARQUE_PAR_DIVISION = { acchot: 'hotellerie' };
const SOUS_MARQUES = {
  hotellerie: { nom: 'Hôtellerie', icone: path.join(__dirname, 'assets', 'icone-accecit-hotellerie.png') },
  tertiaire: { nom: 'Tertiaire', icone: path.join(__dirname, 'assets', 'icone-accecit-tertiaire.png') },
};
const LOGO_ACCECIT = path.join(__dirname, 'assets', 'logo-accecit-fonce.png');

function sousMarqueDemande(demande) {
  return SOUS_MARQUE_PAR_DIVISION[demande.division] ?? null;
}

// Remplace les caractères qui casseraient un chemin (un "/" dans un nom créerait un sous-dossier
// dans le ZIP) — même règle que l'export ZIP des pièces (pieces.routes.js, dossiers.routes.js),
// dupliquée plutôt que partagée, comme dans ces deux fichiers.
function nettoyerSegmentChemin(valeur) {
  return String(valeur ?? '').replace(/[\\/]/g, '-');
}

function nomFichierPdf(demande) {
  return `DPAE ${demande.id} - ${nettoyerSegmentChemin(demande.salarie_nom)} ${nettoyerSegmentChemin(demande.salarie_prenom)}.pdf`;
}

// Mise en page A4 sobre, lisible à l'impression : texte foncé sur fond blanc, une seule couleur
// d'accent (bleu du logo) pour les titres de section.
const COULEURS = { texte: '#1f2430', libelle: '#5b6170', accent: '#2b3990', filet: '#c9cdd6' };
const MARGE = 50;
const LARGEUR_LIBELLE = 170;
const ECART_COLONNES = 12;

function dessinerEnTete(doc, demande, dateGeneration) {
  const haut = MARGE;
  const sousMarque = SOUS_MARQUES[sousMarqueDemande(demande)];
  if (sousMarque) {
    // Même disposition que le logo des sous-marques du site (EnTeteAccecit.jsx) : icône, « ACCECIT »
    // en lettres espacées, filet fin, sous-nom.
    doc.image(sousMarque.icone, MARGE, haut, { height: 44 });
    doc.font('Helvetica').fontSize(15).fillColor(COULEURS.accent)
      .text('ACCECIT', MARGE + 54, haut + 4, { characterSpacing: 4, lineBreak: false });
    doc.moveTo(MARGE + 54, haut + 24).lineTo(MARGE + 160, haut + 24).lineWidth(0.6).strokeColor(COULEURS.accent).stroke();
    doc.fontSize(10).text(sousMarque.nom, MARGE + 54, haut + 29, { lineBreak: false });
  } else {
    doc.image(LOGO_ACCECIT, MARGE, haut - 6, { height: 52 });
  }

  const largeurUtile = doc.page.width - 2 * MARGE;
  doc.font('Helvetica').fontSize(9).fillColor(COULEURS.libelle)
    .text(`PDF généré le ${formaterDateHeure(dateGeneration)}`, MARGE, haut + 4, { width: largeurUtile, align: 'right' });

  doc.moveTo(MARGE, haut + 58).lineTo(doc.page.width - MARGE, haut + 58).lineWidth(0.6).strokeColor(COULEURS.filet).stroke();
  doc.x = MARGE;
  doc.y = haut + 74;
}

function hauteurRestante(doc) {
  return doc.page.height - doc.page.margins.bottom - doc.y;
}

function sautSiNecessaire(doc, hauteur) {
  if (hauteurRestante(doc) < hauteur) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
}

function dessinerSection(doc, section) {
  const largeurUtile = doc.page.width - 2 * MARGE;
  const largeurValeur = largeurUtile - LARGEUR_LIBELLE - ECART_COLONNES;

  // Titre jamais seul en bas de page : on garde de la place pour au moins une ligne derrière.
  sautSiNecessaire(doc, 60);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COULEURS.accent).text(section.titre, MARGE, doc.y);
  doc.moveTo(MARGE, doc.y + 2).lineTo(MARGE + largeurUtile, doc.y + 2).lineWidth(0.5).strokeColor(COULEURS.filet).stroke();
  doc.y += 8;

  for (const [libelle, valeur] of section.lignes) {
    doc.font('Helvetica').fontSize(10);
    const hauteur = Math.max(
      doc.heightOfString(libelle, { width: LARGEUR_LIBELLE }),
      doc.heightOfString(valeur, { width: largeurValeur }),
    );
    sautSiNecessaire(doc, hauteur + 6);
    const y = doc.y;
    doc.fillColor(COULEURS.libelle).text(libelle, MARGE, y, { width: LARGEUR_LIBELLE });
    doc.fillColor(COULEURS.texte).text(valeur, MARGE + LARGEUR_LIBELLE + ECART_COLONNES, y, { width: largeurValeur });
    doc.y = y + hauteur + 5;
  }

  if (section.texte) {
    doc.font('Helvetica').fontSize(10).fillColor(COULEURS.texte);
    sautSiNecessaire(doc, Math.min(doc.heightOfString(section.texte, { width: largeurUtile }), 60) + 6);
    doc.text(section.texte, MARGE, doc.y, { width: largeurUtile });
    doc.y += 5;
  }

  for (const element of section.liste ?? []) {
    doc.font('Helvetica').fontSize(10).fillColor(COULEURS.texte);
    sautSiNecessaire(doc, 18);
    doc.text(`•  ${element}`, MARGE + 6, doc.y, { width: largeurUtile - 6 });
    doc.y += 3;
  }

  doc.y += 12;
}

// Pied de page sur chaque page : « Demande DPAE n° X — Page i / n ». Écrit dans la marge basse :
// marge neutralisée le temps de l'écriture, sinon pdfkit ajouterait une page vide.
function dessinerPiedsDePage(doc, demande) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(COULEURS.libelle)
      .text(`Demande DPAE n° ${demande.id} — Page ${i + 1} / ${pages.count}`, MARGE, doc.page.height - 32, {
        width: doc.page.width - 2 * MARGE,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = margeBasse;
  }
}

// Renvoie le PDF complet en mémoire (Buffer) : une demande tient sur une à deux pages, et le ZIP
// a besoin du contenu entier de chaque fichier. dateGeneration paramétrable pour les tests.
function genererPdfDemande(demande, { dateGeneration = new Date() } = {}) {
  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGE, bottom: MARGE + 10, left: MARGE, right: MARGE },
      bufferPages: true,
      info: { Title: `Demande DPAE n° ${demande.id}`, Author: 'ACCECIT' },
    });
    const morceaux = [];
    doc.on('data', (morceau) => morceaux.push(morceau));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    try {
      dessinerEnTete(doc, demande, dateGeneration);

      doc.font('Helvetica-Bold').fontSize(18).fillColor(COULEURS.texte).text(`Demande DPAE n° ${demande.id}`, MARGE, doc.y);
      // Titre de la fiche (nom du salarié), puis statut et sa date (pastille de la fiche).
      doc.font('Helvetica').fontSize(13).text(`${demande.salarie_prenom} ${demande.salarie_nom}`);
      const { libelle, date } = statutEtDate(demande);
      doc.moveDown(0.3).fontSize(10).fillColor(COULEURS.libelle).text('Statut : ', { continued: true })
        .font('Helvetica-Bold').fillColor(COULEURS.texte).text(date ? `${libelle} — le ${date}` : libelle);
      doc.y += 16;

      for (const section of sectionsDemande(demande)) dessinerSection(doc, section);

      dessinerPiedsDePage(doc, demande);
      doc.end();
    } catch (erreur) {
      rejeter(erreur);
    }
  });
}

module.exports = {
  genererPdfDemande,
  sectionsDemande,
  statutEtDate,
  sousMarqueDemande,
  nomFichierPdf,
  nettoyerSegmentChemin,
};
