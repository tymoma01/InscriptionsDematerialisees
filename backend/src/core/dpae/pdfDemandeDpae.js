const path = require('node:path');
const PDFDocument = require('pdfkit');
const { COORDONNEES_ACCECIT } = require('../../config/coordonneesAccecit');
const { formaterHeure, formaterHeuresParMois } = require('./formatsDpae');

// PDF d'une demande DPAE (2026-10-02, demande utilisateur) — généré CÔTÉ SERVEUR (pdfkit, pur
// JavaScript, aucun navigateur embarqué). Contenu : EXACTEMENT les sections et champs de la fiche
// (frontend/src/pages/rh/DetailDemandeDpae.jsx), dans le même ordre et avec les mêmes règles
// d'affichage (une ligne vide n'est pas affichée), plus le statut et sa date. Rien de plus : aucune
// donnée que la fiche ne montre pas. Les notes de la demande (composant séparé sous la fiche) ne
// sont pas reprises. Toute évolution de la fiche doit être reportée dans sectionsDemande ci-dessous.
//
// Module spécifique à ACCECIT, comme tout le module Demandes DPAE (voir dpae.routes.js).
//
// Mise en page (révisée le 2026-10-02) : sur CHAQUE page, bandeau aux couleurs de l'en-tête de
// l'application (dégradé marron, logo ACCECIT blanc à gauche) et pied de page (filet, coordonnées
// ACCECIT, « Document confidentiel | usage interne », date de génération, « Page X/Y »). Les marges
// de page réservent la place des deux : le contenu ne les chevauche jamais. Aucun tiret long dans
// le document (séparateur : barre verticale).

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

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

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
      ligne('Heure d’arrivée jour 1', formaterHeure(demande.heure_arrivee_j1)),
      ligne('Heures/mois', formaterHeuresParMois(demande.heures_par_mois)),
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
              `${JOURS_SEMAINE_LIBELLE[jour.jour] ?? jour.jour}${jour.heureDebut && jour.heureFin ? ` : ${formaterHeure(jour.heureDebut)} – ${formaterHeure(jour.heureFin)}` : ''}`,
          ),
        }),
  });

  if (demande.autre_chose_signaler) {
    sections.push({ titre: 'Autre chose à signaler', lignes: [], texte: demande.autre_chose_signaler });
  }

  return sections;
}

// Sous-marque ACCECIT du bandeau (Hôtellerie/Tertiaire), à droite comme dans l'application. Une
// demande n'a aucun champ « secteur » : seul le champ « Entité » (colonne `division`) l'indique, et
// seulement pour ACCHOT (ACCECIT Hôtellerie). Toute autre valeur (RM, Autre, non renseignée) : logo
// ACCECIT seul, sans sous-marque — jamais une sous-marque devinée. Compléter cette table si une
// valeur doit afficher « Tertiaire ».
const SOUS_MARQUE_PAR_DIVISION = { acchot: 'hotellerie' };
const SOUS_MARQUES = {
  hotellerie: { nom: 'Hôtellerie', icone: path.join(__dirname, 'assets', 'icone-accecit-hotellerie.png') },
  tertiaire: { nom: 'Tertiaire', icone: path.join(__dirname, 'assets', 'icone-accecit-tertiaire.png') },
};
// Logo blanc de l'en-tête de l'application (frontend/src/assets/logo-accecit-blanc.png, copié ici :
// le backend est construit sans le frontend).
const LOGO_ACCECIT_BLANC = path.join(__dirname, 'assets', 'logo-accecit-blanc.png');

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

// Textes du document hors sections (fonctions pures, testées) — barre verticale comme séparateur.
function texteStatut(demande) {
  const { libelle, date } = statutEtDate(demande);
  return date ? `${libelle} | le ${date}` : libelle;
}

function textesPiedDePage(dateGeneration, numeroPage, nombrePages) {
  const { nom, adresse, telephone, siteWeb } = COORDONNEES_ACCECIT;
  return {
    coordonnees: [nom, adresse, telephone, siteWeb].join(' | '),
    confidentialite: 'Document confidentiel | usage interne',
    generation: `PDF généré le ${formaterDate(dateGeneration)} à ${FORMAT_HEURE.format(new Date(dateGeneration))}`,
    pagination: `Page ${numeroPage}/${nombrePages}`,
  };
}

// Mise en page A4 sobre, lisible à l'impression. Bandeau : dégradé des couleurs de l'en-tête de
// l'application (EnTeteAccecit.css : --couleur-back-office -> --couleur-back-office-dore).
const COULEURS = {
  texte: '#1f2430',
  libelle: '#5b6170',
  accent: '#2b3990',
  filet: '#c9cdd6',
  bandeauDebut: '#2e2013',
  bandeauFin: '#7a5a34',
};
const MARGE = 50;
const LARGEUR_LIBELLE = 170;
const ECART_COLONNES = 12;
const HAUTEUR_BANDEAU = 72;
// Le pied de page occupe les PIED_HAUTEUR derniers points de la page (filet compris).
const PIED_HAUTEUR = 64;
// Marges du contenu : sous le bandeau et au-dessus du pied, avec un espace de respiration.
const MARGE_HAUT_CONTENU = HAUTEUR_BANDEAU + 26;
const MARGE_BAS_CONTENU = PIED_HAUTEUR + 14;

function dessinerBandeau(doc, demande) {
  const largeur = doc.page.width;
  const degrade = doc.linearGradient(0, 0, largeur, 0);
  degrade.stop(0, COULEURS.bandeauDebut).stop(1, COULEURS.bandeauFin);
  doc.rect(0, 0, largeur, HAUTEUR_BANDEAU).fill(degrade);

  doc.image(LOGO_ACCECIT_BLANC, MARGE - 6, (HAUTEUR_BANDEAU - 44) / 2, { height: 44 });

  const sousMarque = SOUS_MARQUES[sousMarqueDemande(demande)];
  if (sousMarque) {
    // Même disposition que le logo des sous-marques de l'en-tête (EnTeteAccecit.jsx) : icône,
    // « ACCECIT » en lettres espacées, filet fin, sous-nom — en blanc sur le bandeau.
    const largeurTexte = 92;
    const xIcone = largeur - MARGE - largeurTexte - 40;
    const yHaut = (HAUTEUR_BANDEAU - 34) / 2;
    doc.image(sousMarque.icone, xIcone, yHaut, { height: 34 });
    const xTexte = xIcone + 40;
    doc.font('Helvetica').fontSize(12).fillColor('#ffffff')
      .text('ACCECIT', xTexte, yHaut + 2, { characterSpacing: 3, lineBreak: false });
    doc.moveTo(xTexte, yHaut + 18).lineTo(xTexte + largeurTexte, yHaut + 18).lineWidth(0.6).strokeColor('#ffffff').stroke();
    doc.fontSize(8.5).text(sousMarque.nom, xTexte, yHaut + 22, { lineBreak: false });
  }
}

function dessinerPiedDePage(doc, textes) {
  const largeurUtile = doc.page.width - 2 * MARGE;
  const haut = doc.page.height - PIED_HAUTEUR;
  doc.moveTo(MARGE, haut).lineTo(MARGE + largeurUtile, haut).lineWidth(0.5).strokeColor(COULEURS.filet).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(COULEURS.libelle);
  doc.text(textes.coordonnees, MARGE, haut + 9, { width: largeurUtile, align: 'center', lineBreak: false });
  doc.text(textes.confidentialite, MARGE, haut + 21, { width: largeurUtile, align: 'center', lineBreak: false });
  doc.text(textes.generation, MARGE, haut + 39, { width: largeurUtile / 2, lineBreak: false });
  doc.text(textes.pagination, MARGE + largeurUtile / 2, haut + 39, { width: largeurUtile / 2, align: 'right', lineBreak: false });
}

// Bandeau et pied de page sur chaque page, dessinés une fois le contenu placé (nombre total de
// pages connu). Écrits dans les marges : marges neutralisées le temps de l'écriture, sinon pdfkit
// ajouterait une page vide.
function dessinerHabillage(doc, demande, dateGeneration) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    const marges = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    dessinerBandeau(doc, demande);
    dessinerPiedDePage(doc, textesPiedDePage(dateGeneration, i + 1, pages.count));
    doc.page.margins = marges;
  }
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
    // Texte long : pdfkit le poursuit page suivante, à l'intérieur des mêmes marges.
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

// Renvoie le PDF complet en mémoire (Buffer) : une demande tient sur une à deux pages, et le ZIP
// a besoin du contenu entier de chaque fichier. dateGeneration paramétrable pour les tests.
function genererPdfDemande(demande, { dateGeneration = new Date() } = {}) {
  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGE_HAUT_CONTENU, bottom: MARGE_BAS_CONTENU, left: MARGE, right: MARGE },
      bufferPages: true,
      info: { Title: `Demande DPAE n° ${demande.id}`, Author: COORDONNEES_ACCECIT.nom },
    });
    const morceaux = [];
    doc.on('data', (morceau) => morceaux.push(morceau));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    try {
      // Première page seulement : numéro, salarié (titre de la fiche) et statut avec sa date.
      doc.font('Helvetica-Bold').fontSize(18).fillColor(COULEURS.texte).text(`Demande DPAE n° ${demande.id}`, MARGE, doc.page.margins.top);
      doc.font('Helvetica').fontSize(13).text(`${demande.salarie_prenom} ${demande.salarie_nom}`);
      doc.moveDown(0.3).fontSize(10).fillColor(COULEURS.libelle).text('Statut : ', { continued: true })
        .font('Helvetica-Bold').fillColor(COULEURS.texte).text(texteStatut(demande));
      doc.y += 16;

      for (const section of sectionsDemande(demande)) dessinerSection(doc, section);

      dessinerHabillage(doc, demande, dateGeneration);
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
  texteStatut,
  textesPiedDePage,
  sousMarqueDemande,
  nomFichierPdf,
  nettoyerSegmentChemin,
  // Zones réservées (points) : exposées pour vérifier l'absence de chevauchement.
  ZONES_PAGE: Object.freeze({ HAUTEUR_BANDEAU, PIED_HAUTEUR, MARGE_HAUT_CONTENU, MARGE_BAS_CONTENU }),
};
