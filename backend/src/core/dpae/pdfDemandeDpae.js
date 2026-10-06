const path = require('node:path');
const PDFDocument = require('pdfkit');
const { COORDONNEES_ACCECIT } = require('../../config/coordonneesAccecit');
const { formaterHeure, formaterHeuresParMois, libellesSitesJour, libelleDivision } = require('./formatsDpae');
const { nombreJoursCalendaires, libelleNombreJours } = require('./joursCalendaires');

// PDF d'une demande DPAE — généré CÔTÉ SERVEUR (pdfkit, pur
// JavaScript, aucun navigateur embarqué). Contenu : EXACTEMENT les sections et champs de la fiche
// (frontend/src/pages/rh/DetailDemandeDpae.jsx), dans le même ordre et avec les mêmes règles
// d'affichage (une ligne vide n'est pas affichée), plus le statut et sa date. Rien de plus : aucune
// donnée que la fiche ne montre pas. Les notes de la demande (composant séparé sous la fiche) ne
// sont pas reprises. Toute évolution de la fiche doit être reportée dans sectionsDemande ci-dessous.
//
// Module spécifique à ACCECIT, comme tout le module Demandes DPAE (voir dpae.routes.js).
//
// Mise en page : sur CHAQUE page, bandeau bleu en dégradé (logo ACCECIT blanc à gauche, logos
// Hôtellerie et Tertiaire à droite) et pied de page (filet, coordonnées ACCECIT, « Document
// confidentiel | usage interne », date de génération, « Page X/Y »). Première page : titre, salarié,
// pastille de statut, encadré récapitulatif ; puis une carte par section, sur deux colonnes de
// paires libellé/valeur. Les marges de page réservent la place du bandeau et du pied : le contenu ne
// les chevauche jamais. Aucun tiret long ni demi-cadratin dans le document.

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

// « Reçue le JJ/MM/AAAA à HH:MM » (heure de Paris), à droite de la pastille de statut.
function texteReception(demande) {
  return `Reçue le ${formaterDate(demande.date_creation)} à ${FORMAT_HEURE.format(new Date(demande.date_creation))}`;
}

// Les quatre cases de l'encadré récapitulatif : [libellé, valeur] (valeur vide : « Non renseigné »).
function recapitulatif(demande) {
  const poste = demande.poste === 'autre' ? demande.poste_autre : LIBELLE_PAR_POSTE[demande.poste];
  return [
    ['Salarié', `${demande.salarie_prenom} ${demande.salarie_nom}`],
    ['Poste', poste || 'Non renseigné'],
    ['Type de contrat', demande.type_contrat ? demande.type_contrat.toUpperCase() : 'Non renseigné'],
    ['Premier jour', demande.date_debut ? formaterDate(demande.date_debut) : 'Non renseigné'],
  ];
}

// « Nombre total de jours calendaires » (premier et dernier jour inclus), seulement s'il est calculable.
function nombreJoursLigne(demande) {
  const nombre = nombreJoursCalendaires(demande.date_debut, demande.date_fin);
  return nombre === null ? null : ligne('Nombre total de jours calendaires', libelleNombreJours(nombre));
}

// Sections de la fiche, dans l'ordre de DetailDemandeDpae.jsx : [{ titre, lignes: [[libellé,
// valeur]], texte?, tableau? }]. Fonction pure, testable sans PDF. Une section conditionnelle de la
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
      ligne('Entité', libelleDivision(demande.division, demande.division_autre)),
      ligne('Poste', demande.poste === 'autre' ? demande.poste_autre : LIBELLE_PAR_POSTE[demande.poste]),
      ligne('Premier jour', demande.date_debut && formaterDate(demande.date_debut)),
      ligne('Dernier jour', demande.date_fin && formaterDate(demande.date_fin)),
      // CDD seulement, à côté du dernier jour ; calculé, jamais stocké.
      demande.type_contrat === 'cdd' && nombreJoursLigne(demande),
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
          // Tableau « Jour | Horaires | Site(s) » : un jour travaillé par ligne, « de 10h00 à 12h00 » puis
          // la LISTE des sites du jour, [« AIGLON (AIG) », …] (« Non précisé » pour une demande
          // antérieure au site par jour) — mise en forme par lignesDeTableau.
          tableau: semaineTravaillee.map((jour) => [
            JOURS_SEMAINE_LIBELLE[jour.jour] ?? jour.jour,
            jour.heureDebut && jour.heureFin ? `de ${formaterHeure(jour.heureDebut)} à ${formaterHeure(jour.heureFin)}` : 'Horaires non précisés',
            libellesSitesJour(jour, demande.sites_affectation).length > 0 ? libellesSitesJour(jour, demande.sites_affectation) : 'Non précisé',
          ]),
        }),
  });

  if (demande.autre_chose_signaler) {
    sections.push({ titre: 'Autre chose à signaler', lignes: [], texte: demande.autre_chose_signaler });
  }

  return sections;
}

// Sous-marques ACCECIT du bandeau (2026-10-02) : « ACCECIT Hôtellerie » et « ACCECIT Tertiaire »,
// l'une sous l'autre à droite, comme dans le bandeau de l'application (EnTeteAccecit.jsx) — sur
// TOUTES les demandes, quelle que soit l'entité (plus aucune règle selon le champ « Entité »).
// Icônes copiées de frontend/src/assets (le backend est construit sans le frontend), en versions
// CLAIRES (suffixe -clair) pour le fond bleu du bandeau : arcs bleus recolorés en bleu très clair,
// doré inchangé. Les originaux restent à côté, intacts.
const SOUS_MARQUES = [
  { nom: 'Hôtellerie', icone: path.join(__dirname, 'assets', 'icone-accecit-hotellerie-clair.png') },
  { nom: 'Tertiaire', icone: path.join(__dirname, 'assets', 'icone-accecit-tertiaire-clair.png') },
];
// Logo blanc de l'en-tête de l'application (frontend/src/assets/logo-accecit-blanc.png, copié ici :
// le backend est construit sans le frontend).
const LOGO_ACCECIT_BLANC = path.join(__dirname, 'assets', 'logo-accecit-blanc.png');

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
function textesPiedDePage(dateGeneration, numeroPage, nombrePages) {
  const { nom, adresse, telephone, siteWeb } = COORDONNEES_ACCECIT;
  return {
    coordonnees: [nom, adresse, telephone, siteWeb].join(' | '),
    confidentialite: 'Document confidentiel | usage interne',
    generation: `PDF généré le ${formaterDate(dateGeneration)} à ${FORMAT_HEURE.format(new Date(dateGeneration))}`,
    pagination: `Page ${numeroPage}/${nombrePages}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Mise en page A4 portrait. Couleurs : AUCUNE teinte propre à ce document, toutes viennent de
// l'application (frontend/src/styles/variables.css) ou du PDF d'origine.
// ---------------------------------------------------------------------------------------------
// Bleu foncé des titres de section (PDF d'origine) : défini UNE fois, repris pour le bandeau, les
// titres, le premier jour de l'encadré.
const BLEU_TITRES = '#2b3990';
const COULEURS = {
  texte: '#1f2430',
  libelle: '#5b6170',
  accent: BLEU_TITRES,
  filet: '#c9cdd6',
  // Dégradé du bandeau : --couleur-primaire-hover (à gauche) vers le bleu des titres (à droite).
  bandeauDebut: '#243074',
  bandeauFin: BLEU_TITRES,
  // Fond de l'encadré récapitulatif : --couleur-primaire-clair.
  fondRecapitulatif: '#eeeff6',
  // Trait doré des titres de section : --couleur-back-office-dore.
  dore: '#7a5a34',
  blanc: '#ffffff',
};

// Pastille de statut : mêmes couleurs que StatutBadge dans l'application (variantes attente,
// bleu-gris, succès, échec de variables.css), voir frontend/src/core/dpae/statutsDpae.js.
const COULEURS_STATUT = {
  envoyee: { fond: '#fdf3e2', texte: '#92620a', bordure: '#f3d9a4' },
  en_attente: { fond: '#e8eef4', texte: '#3f5368', bordure: '#b9c7d6' },
  validee: { fond: '#e6f4ea', texte: '#1e7e34', bordure: '#b8e2c4' },
  rejetee: { fond: '#fbeae8', texte: '#c0392b', bordure: '#f1c3bd' },
};

const POLICE = 'Helvetica';
const POLICE_GRAS = 'Helvetica-Bold';

// A4 : 18 mm de marge latérale (51 pt), bandeau de 22 mm (62 pt).
const MARGE = 51;
const HAUTEUR_BANDEAU = 62;
// Le pied de page occupe les PIED_HAUTEUR derniers points de la page (filet compris).
const PIED_HAUTEUR = 64;
// Marges du contenu : sous le bandeau et au-dessus du pied, avec un espace de respiration.
const MARGE_HAUT_CONTENU = HAUTEUR_BANDEAU + 22;
const MARGE_BAS_CONTENU = PIED_HAUTEUR + 12;

const TAILLE_LIBELLE = 8.5;
const TAILLE_VALEUR = 10.5;
const ECART_CARTES = 10;
const RAYON_CARTE = 6;
const PADDING_CARTE = 12;
const ECART_COLONNES = 16;
const ECART_LIGNES = 7;
// Zone de titre d'une carte (trait doré compris) et marge basse.
const HAUTEUR_TITRE_CARTE = 32;
const PADDING_BAS_CARTE = 6;

// --- Bandeau ---------------------------------------------------------------------------------
const HAUTEUR_LOGO_PRINCIPAL = 34;
const COTE_ICONE = 28;
const TAILLE_MARQUE = 9;
const ESPACEMENT_MARQUE = 2.2;
const TAILLE_SOUS_NOM = 8;
const ECART_ICONE_TEXTE = 6;
const ECART_SOUS_MARQUES = 20;

// Largeur EXACTE du mot « ACCECIT » tel qu'il est dessiné (lettres espacées) : la largeur des
// lettres plus les espacements ENTRE elles (pas après la dernière). Le trait qui le souligne a
// exactement cette longueur. Police et taille doivent être celles du dessin.
function largeurMotAccecit(doc) {
  doc.font(POLICE).fontSize(TAILLE_MARQUE);
  return doc.widthOfString('ACCECIT') + ESPACEMENT_MARQUE * ('ACCECIT'.length - 1);
}

// Position des éléments d'une sous-marque dont le bloc commence à `xBloc`.
function geometrieSousMarque(doc, xBloc) {
  const largeurMot = largeurMotAccecit(doc);
  return { xIcone: xBloc, xTexte: xBloc + COTE_ICONE + ECART_ICONE_TEXTE, largeurMot, largeurBloc: COTE_ICONE + ECART_ICONE_TEXTE + largeurMot };
}

function dessinerBandeau(doc) {
  const largeur = doc.page.width;
  const degrade = doc.linearGradient(0, 0, largeur, 0);
  degrade.stop(0, COULEURS.bandeauDebut).stop(1, COULEURS.bandeauFin);
  doc.rect(0, 0, largeur, HAUTEUR_BANDEAU).fill(degrade);

  doc.image(LOGO_ACCECIT_BLANC, MARGE, (HAUTEUR_BANDEAU - HAUTEUR_LOGO_PRINCIPAL) / 2, { height: HAUTEUR_LOGO_PRINCIPAL });

  // Sous-marques côte à côte, alignées à droite : icône, « ACCECIT » en lettres espacées, filet de la
  // largeur exacte du mot, sous-nom.
  const { largeurBloc } = geometrieSousMarque(doc, 0);
  const xDepart = largeur - MARGE - (SOUS_MARQUES.length * largeurBloc + (SOUS_MARQUES.length - 1) * ECART_SOUS_MARQUES);
  const yIcone = (HAUTEUR_BANDEAU - COTE_ICONE) / 2;
  SOUS_MARQUES.forEach((sousMarque, index) => {
    const { xIcone, xTexte, largeurMot } = geometrieSousMarque(doc, xDepart + index * (largeurBloc + ECART_SOUS_MARQUES));
    doc.image(sousMarque.icone, xIcone, yIcone, { height: COTE_ICONE });
    doc.font(POLICE).fontSize(TAILLE_MARQUE).fillColor(COULEURS.blanc)
      .text('ACCECIT', xTexte, yIcone + 3, { characterSpacing: ESPACEMENT_MARQUE, lineBreak: false });
    const yFilet = yIcone + 3 + 12.5;
    doc.moveTo(xTexte, yFilet).lineTo(xTexte + largeurMot, yFilet).lineWidth(0.6).strokeColor(COULEURS.blanc).stroke();
    doc.font(POLICE).fontSize(TAILLE_SOUS_NOM).fillColor(COULEURS.blanc).text(sousMarque.nom, xTexte, yFilet + 3, { lineBreak: false });
  });
}

// --- Pied de page ----------------------------------------------------------------------------
function dessinerPiedDePage(doc, textes) {
  const largeurUtile = doc.page.width - 2 * MARGE;
  const haut = doc.page.height - PIED_HAUTEUR;
  doc.moveTo(MARGE, haut).lineTo(MARGE + largeurUtile, haut).lineWidth(0.5).strokeColor(COULEURS.filet).stroke();
  doc.font(POLICE).fontSize(7.5).fillColor(COULEURS.libelle);
  doc.text(textes.coordonnees, MARGE, haut + 9, { width: largeurUtile, align: 'center', lineBreak: false });
  doc.text(textes.confidentialite, MARGE, haut + 21, { width: largeurUtile, align: 'center', lineBreak: false });
  doc.text(textes.generation, MARGE, haut + 39, { width: largeurUtile / 2, lineBreak: false });
  doc.text(textes.pagination, MARGE + largeurUtile / 2, haut + 39, { width: largeurUtile / 2, align: 'right', lineBreak: false });
}

// Bandeau et pied de page sur chaque page, dessinés une fois le contenu placé (nombre total de
// pages connu). Écrits dans les marges : marges neutralisées le temps de l'écriture, sinon pdfkit
// ajouterait une page vide.
function dessinerHabillage(doc, dateGeneration) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    const marges = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    dessinerBandeau(doc);
    dessinerPiedDePage(doc, textesPiedDePage(dateGeneration, i + 1, pages.count));
    doc.page.margins = marges;
  }
}

// --- Bloc de titre et encadré récapitulatif (première page) -----------------------------------
function hauteurTexte(doc, texte, police, taille, largeur) {
  doc.font(police).fontSize(taille);
  return doc.heightOfString(texte, { width: largeur });
}

function dessinerPastilleStatut(doc, demande, x, y) {
  const couleurs = COULEURS_STATUT[demande.statut] ?? COULEURS_STATUT.envoyee;
  const libelle = LIBELLE_PAR_STATUT[demande.statut] ?? demande.statut;
  const hauteur = 17;
  doc.font(POLICE_GRAS).fontSize(9);
  const largeur = doc.widthOfString(libelle) + 20;
  doc.roundedRect(x, y, largeur, hauteur, hauteur / 2).lineWidth(0.6).fillAndStroke(couleurs.fond, couleurs.bordure);
  doc.fillColor(couleurs.texte).text(libelle, x, y + 4.5, { width: largeur, align: 'center', lineBreak: false });
  return largeur;
}

// Renvoie la position verticale sous le bloc.
function dessinerTitre(doc, demande, y) {
  doc.font(POLICE_GRAS).fontSize(22).fillColor(COULEURS.texte).text(`Demande DPAE n° ${demande.id}`, MARGE, y, { lineBreak: false });
  doc.font(POLICE).fontSize(14).fillColor(COULEURS.texte).text(`${demande.salarie_prenom} ${demande.salarie_nom}`, MARGE, y + 29, { lineBreak: false });
  const yPastille = y + 54;
  const largeurPastille = dessinerPastilleStatut(doc, demande, MARGE, yPastille);
  doc.font(POLICE).fontSize(9.5).fillColor(COULEURS.libelle).text(texteReception(demande), MARGE + largeurPastille + 10, yPastille + 4, { lineBreak: false });
  return yPastille + 17 + 16;
}

function dessinerRecapitulatif(doc, demande, y) {
  const largeurBoite = doc.page.width - 2 * MARGE;
  const padding = 14;
  const cases = recapitulatif(demande);
  const largeurCase = (largeurBoite - 2 * padding - 3 * 10) / 4;
  const taille = (indice) => (indice === 3 ? 13 : 11);
  const hauteurs = cases.map(([, valeur], indice) => hauteurTexte(doc, valeur, POLICE_GRAS, taille(indice), largeurCase));
  const hauteurBoite = 2 * padding - 2 + 10 + 4 + Math.max(...hauteurs);

  doc.roundedRect(MARGE, y, largeurBoite, hauteurBoite, 8).fill(COULEURS.fondRecapitulatif);
  cases.forEach(([libelle, valeur], indice) => {
    const x = MARGE + padding + indice * (largeurCase + 10);
    doc.font(POLICE).fontSize(8).fillColor(COULEURS.libelle).text(libelle, x, y + padding - 1, { width: largeurCase, lineBreak: false });
    doc.font(POLICE_GRAS).fontSize(taille(indice)).fillColor(indice === 3 ? COULEURS.accent : COULEURS.texte)
      .text(valeur, x, y + padding + 13, { width: largeurCase });
  });
  return y + hauteurBoite + 14;
}

// --- Cartes de section -----------------------------------------------------------------------
// Une carte = titre + « lignes » de contenu ({ hauteur, dessiner(x, y, largeur) }). Une carte qui ne
// tient pas dans la place restante passe sur la page suivante si elle y tient entièrement ; seule une
// carte plus haute qu'une page est répartie sur plusieurs pages, entre deux lignes.

// Paires libellé/valeur sur deux colonnes : une valeur plus large qu'une colonne (ou sur plusieurs
// lignes, comme les sites d'affectation) prend toute la largeur.
function lignesDePaires(doc, paires, largeurInterne) {
  const largeurColonne = (largeurInterne - ECART_COLONNES) / 2;
  const mesurer = (libelle, valeur, largeur) =>
    hauteurTexte(doc, libelle, POLICE, TAILLE_LIBELLE, largeur) + 2 + hauteurTexte(doc, valeur, POLICE, TAILLE_VALEUR, largeur);
  const largeurValeur = (valeur) => {
    doc.font(POLICE).fontSize(TAILLE_VALEUR);
    return doc.widthOfString(valeur);
  };
  const dessinerPaire = (libelle, valeur, x, y, largeur) => {
    doc.font(POLICE).fontSize(TAILLE_LIBELLE).fillColor(COULEURS.libelle).text(libelle, x, y, { width: largeur });
    const yValeur = y + hauteurTexte(doc, libelle, POLICE, TAILLE_LIBELLE, largeur) + 2;
    doc.font(POLICE).fontSize(TAILLE_VALEUR).fillColor(COULEURS.texte).text(valeur, x, yValeur, { width: largeur });
  };

  const lignes = [];
  let enAttente = null;
  const viderEnAttente = () => {
    if (!enAttente) return;
    const [libelle, valeur] = enAttente;
    lignes.push({
      hauteur: mesurer(libelle, valeur, largeurColonne) + ECART_LIGNES,
      dessiner: (x, y) => dessinerPaire(libelle, valeur, x, y, largeurColonne),
    });
    enAttente = null;
  };
  for (const [libelle, valeur] of paires) {
    const pleineLargeur = valeur.includes('\n') || largeurValeur(valeur) > largeurColonne;
    if (pleineLargeur) {
      viderEnAttente();
      lignes.push({
        hauteur: mesurer(libelle, valeur, largeurInterne) + ECART_LIGNES,
        dessiner: (x, y) => dessinerPaire(libelle, valeur, x, y, largeurInterne),
      });
    } else if (enAttente) {
      const [libelleGauche, valeurGauche] = enAttente;
      enAttente = null;
      lignes.push({
        hauteur: Math.max(mesurer(libelleGauche, valeurGauche, largeurColonne), mesurer(libelle, valeur, largeurColonne)) + ECART_LIGNES,
        dessiner: (x, y) => {
          dessinerPaire(libelleGauche, valeurGauche, x, y, largeurColonne);
          dessinerPaire(libelle, valeur, x + largeurColonne + ECART_COLONNES, y, largeurColonne);
        },
      });
    } else {
      enAttente = [libelle, valeur];
    }
  }
  viderEnAttente();
  return lignes;
}

// Tableau « Jour | Horaires | Site(s) ». La cellule des sites est une liste de libellés (ou un texte) :
// les sites sont séparés par « , » et, si la place manque, le retour à la ligne se fait ENTRE deux
// sites (espaces insécables à l'intérieur d'un libellé) ; la ligne grandit en conséquence.
function lignesDeTableau(doc, tableau, largeurInterne) {
  const largeurJour = 100;
  const largeurHoraires = 120;
  const largeurSite = largeurInterne - largeurJour - largeurHoraires - 8;
  const hauteurLigne = 17;
  const lignes = [
    {
      hauteur: hauteurLigne,
      dessiner: (x, y) => {
        doc.rect(x, y, largeurInterne, hauteurLigne).fill(COULEURS.fondRecapitulatif);
        doc.font(POLICE_GRAS).fontSize(TAILLE_LIBELLE).fillColor(COULEURS.libelle);
        doc.text('Jour', x + 8, y + 4.5, { width: largeurJour, lineBreak: false });
        doc.text('Horaires', x + largeurJour, y + 4.5, { width: largeurHoraires, lineBreak: false });
        doc.text('Site', x + largeurJour + largeurHoraires, y + 4.5, { width: largeurSite, lineBreak: false });
      },
    },
  ];
  for (const [jour, horaires, sites] of tableau) {
    const texteSites = Array.isArray(sites) ? sites.map((site) => site.replace(/ /g, '\u00a0')).join(', ') : sites;
    doc.font(POLICE).fontSize(TAILLE_VALEUR);
    const hauteur = Math.max(hauteurLigne, doc.heightOfString(texteSites, { width: largeurSite }) + 7);
    lignes.push({
      hauteur,
      dessiner: (x, y) => {
        doc.font(POLICE).fontSize(TAILLE_VALEUR).fillColor(COULEURS.texte);
        doc.text(jour, x + 8, y + 3.5, { width: largeurJour - 8, lineBreak: false });
        doc.text(horaires, x + largeurJour, y + 3.5, { width: largeurHoraires, lineBreak: false });
        doc.text(texteSites, x + largeurJour + largeurHoraires, y + 3.5, { width: largeurSite });
        doc.moveTo(x, y + hauteur).lineTo(x + largeurInterne, y + hauteur).lineWidth(0.4).strokeColor(COULEURS.filet).stroke();
      },
    });
  }
  return lignes;
}

// Texte libre : un bloc par paragraphe, et seulement s'il dépasse MAX_CARACTERES_PAR_BLOC_TEXTE (très
// long, plus d'une demi-page) découpé aux limites de mots, pour pouvoir le répartir sur deux pages.
// Un découpage plus fin hacherait les lignes du texte.
const MAX_CARACTERES_PAR_BLOC_TEXTE = 1500;
function blocsDeTexte(texte) {
  const blocs = [];
  for (const paragraphe of String(texte).split('\n')) {
    let courant = '';
    for (const mot of paragraphe.split(' ')) {
      if (courant && courant.length + mot.length + 1 > MAX_CARACTERES_PAR_BLOC_TEXTE) {
        blocs.push(courant);
        courant = mot;
      } else {
        courant = courant ? `${courant} ${mot}` : mot;
      }
    }
    blocs.push(courant);
  }
  return blocs;
}

function lignesDeTexte(doc, texte, largeurInterne) {
  return blocsDeTexte(texte).map((bloc) => ({
    hauteur: hauteurTexte(doc, bloc, POLICE, TAILLE_VALEUR, largeurInterne) + 2,
    dessiner: (x, y) => doc.font(POLICE).fontSize(TAILLE_VALEUR).fillColor(COULEURS.texte).text(bloc, x, y, { width: largeurInterne }),
  }));
}

function limiteBasPage(doc) {
  return doc.page.maxY() - 2;
}

function nouvellePage(doc) {
  doc.addPage();
  return doc.page.margins.top;
}

// Dessine une carte (ou ses morceaux) à partir de `y` ; renvoie la position verticale sous elle.
function dessinerCarte(doc, titre, lignes, y) {
  const largeurCarte = doc.page.width - 2 * MARGE;
  const hauteurTotale = HAUTEUR_TITRE_CARTE + lignes.reduce((somme, ligne) => somme + ligne.hauteur, 0) + PADDING_BAS_CARTE;
  const hauteurPage = limiteBasPage(doc) - doc.page.margins.top;

  let enAttente = [...lignes];
  let yCourant = y;
  let premierMorceau = true;
  // Ne tient pas dans la place restante mais tient sur une page entière : page suivante, carte entière.
  if (hauteurTotale > limiteBasPage(doc) - yCourant && hauteurTotale <= hauteurPage) yCourant = nouvellePage(doc);

  while (enAttente.length > 0) {
    let place = limiteBasPage(doc) - yCourant - HAUTEUR_TITRE_CARTE - PADDING_BAS_CARTE;
    if (place < enAttente[0].hauteur) {
      yCourant = nouvellePage(doc);
      place = limiteBasPage(doc) - yCourant - HAUTEUR_TITRE_CARTE - PADDING_BAS_CARTE;
    }
    const morceau = [];
    let hauteurMorceau = 0;
    while (enAttente.length > 0 && (morceau.length === 0 || hauteurMorceau + enAttente[0].hauteur <= place)) {
      hauteurMorceau += enAttente[0].hauteur;
      morceau.push(enAttente.shift());
    }

    const hauteurCarte = HAUTEUR_TITRE_CARTE + hauteurMorceau + PADDING_BAS_CARTE;
    doc.roundedRect(MARGE, yCourant, largeurCarte, hauteurCarte, RAYON_CARTE).lineWidth(0.6).fillAndStroke(COULEURS.blanc, COULEURS.filet);
    // Titre en bleu, trait doré à gauche.
    doc.rect(MARGE + PADDING_CARTE, yCourant + 11, 3, 14).fill(COULEURS.dore);
    doc.font(POLICE_GRAS).fontSize(11.5).fillColor(COULEURS.accent)
      .text(premierMorceau ? titre : `${titre} (suite)`, MARGE + PADDING_CARTE + 10, yCourant + 12, { lineBreak: false });
    let yLigne = yCourant + HAUTEUR_TITRE_CARTE;
    for (const ligne of morceau) {
      ligne.dessiner(MARGE + PADDING_CARTE, yLigne);
      yLigne += ligne.hauteur;
    }
    yCourant += hauteurCarte;
    if (enAttente.length > 0) yCourant = nouvellePage(doc);
    premierMorceau = false;
  }
  return yCourant + ECART_CARTES;
}

// Contenu d'une section (voir sectionsDemande) sous forme de lignes dessinables.
function lignesDeSection(doc, section, largeurInterne) {
  return [
    ...lignesDePaires(doc, section.lignes, largeurInterne),
    ...(section.tableau ? lignesDeTableau(doc, section.tableau, largeurInterne) : []),
    ...(section.texte ? lignesDeTexte(doc, section.texte, largeurInterne) : []),
  ];
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
      let y = dessinerTitre(doc, demande, doc.page.margins.top);
      y = dessinerRecapitulatif(doc, demande, y);

      const largeurInterne = doc.page.width - 2 * MARGE - 2 * PADDING_CARTE;
      for (const section of sectionsDemande(demande)) {
        // Section entièrement vide : non affichée.
        const lignes = lignesDeSection(doc, section, largeurInterne);
        if (lignes.length === 0) continue;
        y = dessinerCarte(doc, section.titre, lignes, y);
      }

      dessinerHabillage(doc, dateGeneration);
      doc.end();
    } catch (erreur) {
      rejeter(erreur);
    }
  });
}

module.exports = {
  genererPdfDemande,
  sectionsDemande,
  recapitulatif,
  texteReception,
  textesPiedDePage,
  nomFichierPdf,
  nettoyerSegmentChemin,
  // Bandeau : exposés pour vérifier que le filet souligne exactement le mot « ACCECIT ».
  dessinerBandeau,
  largeurMotAccecit,
  // Zones réservées (points) : exposées pour vérifier l'absence de chevauchement.
  ZONES_PAGE: Object.freeze({ HAUTEUR_BANDEAU, PIED_HAUTEUR, MARGE_HAUT_CONTENU, MARGE_BAS_CONTENU }),
};
