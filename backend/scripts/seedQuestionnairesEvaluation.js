// Amorce les questionnaires d'évaluation du test, un par poste (voir migration 037 et
// evaluationEngine.js) — configurables par entité, pas une grille figée valable pour tout le
// monde (voir Modularité, CLAUDE.md). posteCode: null = questionnaire générique de repli, utilisé
// pour un dossier dont le poste ne correspond à aucun questionnaire dédié ci-dessous (postes
// bureau, ou un futur poste hôtel pas encore configuré). Idempotent, même patron que
// scripts/seedCriteresEvaluation.js/seedStatuts.js.
//
// Le questionnaire générique reprend tel quel l'ancien contenu de criteres_evaluation (hygiène,
// assiduité, respect des consignes, temps de service, CLAUDE.md) sous une seule question
// grille_qcu — voir scripts/migrerEvaluationsVersQuestionnaires.js pour la migration des 6
// évaluations déjà enregistrées sur l'ancien modèle.
//
// Usage : node scripts/seedQuestionnairesEvaluation.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const QUESTIONNAIRES_ACCECIT = [
  {
    posteCode: null,
    questions: [
      {
        code: 'evaluation_test',
        libelle: 'Évaluation du test',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 1,
        items: [
          { code: 'hygiene', libelle: 'Hygiène' },
          { code: 'assiduite', libelle: 'Assiduité' },
          { code: 'respect_consignes', libelle: 'Respect des consignes' },
          { code: 'temps_service', libelle: 'Temps moyens de service' },
        ],
      },
    ],
  },
  {
    posteCode: 'femme_valet_chambre',
    questions: [
      {
        code: 'process_nettoyage',
        libelle: 'Process de nettoyage',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 1,
        items: [
          { code: 'ouverture_fenetres', libelle: 'Ouvrir les fenêtres' },
          { code: 'vider_poubelles', libelle: 'Vider les poubelles' },
          { code: 'linge_sale', libelle: 'Enlever le linge sale' },
          { code: 'utilisation_produits', libelle: 'Utilisation des produits' },
          { code: 'lit_au_carre', libelle: 'Faire le lit au carré' },
          { code: 'nettoyage_sdb', libelle: 'Nettoyer la salle de bain' },
          { code: 'poussiere', libelle: 'Faire la poussière' },
          { code: 'produits_accueil', libelle: "Disposer les produits d'accueil" },
          { code: 'aspiration', libelle: 'Aspiration' },
          { code: 'auto_controle', libelle: 'Auto-contrôle' },
          { code: 'connaissance_linge', libelle: 'Connaissance du linge' },
          { code: 'debutant', libelle: 'DEBUTANT(E)' },
        ],
      },
      {
        code: 'vocabulaire_hotelier',
        libelle: 'Connaissance du vocabulaire hôtelier',
        type: 'choix_multiple',
        obligatoire: false,
        ordre: 2,
        items: [
          { code: 'recouche', libelle: 'Recouche' },
          { code: 'depart', libelle: 'Départ' },
          { code: 'no_show', libelle: 'No show' },
          { code: 'refus_service', libelle: 'Refus de service' },
          { code: 'ot', libelle: 'OT (objet trouvé)' },
          { code: 'pb', libelle: 'PB (problème technique)' },
          { code: 'dnd', libelle: 'DND (do not disturb/ne pas déranger)' },
          { code: 'debutant', libelle: 'DEBUTANT(E)' },
        ],
      },
      {
        code: 'sens_service',
        libelle: 'Sens du service',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 3,
        items: [
          { code: 'ponctualite', libelle: 'Ponctualité' },
          { code: 'courtoisie', libelle: 'Courtoisie' },
          { code: 'suivi_recommandations', libelle: 'Suivi des recommandations' },
          { code: 'presentation_hygiene', libelle: 'Présentation et hygiène' },
          { code: 'gestion_priorites', libelle: 'Gestion des priorités (1: départ - 2: recouche)' },
          { code: 'lecture', libelle: 'Lecture' },
          { code: 'ecriture', libelle: 'Ecriture' },
        ],
      },
    ],
  },
  {
    posteCode: 'cafetier',
    questions: [
      {
        code: 'process_nettoyage',
        libelle: 'Process de nettoyage',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 1,
        items: [
          { code: 'gestion_salle_pdj', libelle: 'Gestion salle PDJ' },
          { code: 'nettoyage_appareils', libelle: 'Nettoyage appareils (café, crêpière, gaufrier, machine a jus...)' },
          { code: 'gestion_minibar', libelle: 'Gestion minibar (rechargement, inventaire)' },
          { code: 'ouverture', libelle: 'Ouverture' },
          { code: 'controle_chambres', libelle: 'Contrôle chambres' },
          { code: 'produits_entretien', libelle: "Connaissances et utilisation des produits d'entretien" },
          { code: 'vocabulaire_hotelier', libelle: 'Connaissance vocabulaire hôtelier' },
          { code: 'connaissance_linge', libelle: 'Connaissance du linge' },
          { code: 'suivi_recommandations', libelle: 'Suivi des recommandations' },
          { code: 'debutante', libelle: 'Débutante' },
        ],
      },
      {
        code: 'sens_service',
        libelle: 'Sens du service',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 2,
        items: [
          { code: 'ponctualite', libelle: 'Ponctualité' },
          { code: 'courtoisie', libelle: 'Courtoisie' },
          { code: 'presentation_hygiene', libelle: 'Présentation et hygiène' },
          { code: 'lecture', libelle: 'Lecture' },
          { code: 'ecriture', libelle: 'Ecriture' },
          { code: 'accueil_client', libelle: 'Accueil client' },
        ],
      },
      { code: 'langues_maitrisees', libelle: 'Langues maîtrisées', type: 'texte_libre', obligatoire: true, ordre: 3, items: [] },
      { code: 'qualites', libelle: 'Qualités', type: 'texte_libre', obligatoire: false, ordre: 4, items: [] },
      { code: 'points_ameliorer', libelle: 'Points à améliorer', type: 'texte_libre', obligatoire: false, ordre: 5, items: [] },
    ],
  },
  {
    posteCode: 'equipier',
    questions: [
      {
        code: 'process_nettoyage',
        libelle: 'Process de nettoyage',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 1,
        items: [
          { code: 'aide_cafete', libelle: 'Aide cafète' },
          { code: 'accueil_clients', libelle: 'Accueil clients' },
          { code: 'debarrassage_chambres', libelle: 'Débarrassage chambres' },
          { code: 'gestion_minibar', libelle: 'Gestion minibar' },
          { code: 'rechargement_plateau', libelle: 'Rechargement plateau de courtoisie' },
          { code: 'nettoyage_chambres', libelle: 'Nettoyage chambres' },
          { code: 'nettoyage_parties_communes', libelle: 'Nettoyage parties communes' },
          { code: 'nettoyage_vitres', libelle: 'Nettoyage vitres' },
          { code: 'sens_service', libelle: 'Sens du service' },
          { code: 'connaissance_linge', libelle: 'Connaissance du linge' },
          { code: 'debutant', libelle: 'DEBUTANT(E)' },
        ],
      },
      {
        code: 'vocabulaire_hotelier',
        libelle: 'Connaissance du vocabulaire hôtelier',
        type: 'choix_multiple',
        obligatoire: false,
        ordre: 2,
        items: [
          { code: 'recouche', libelle: 'Recouche' },
          { code: 'depart', libelle: 'Départ' },
          { code: 'no_show', libelle: 'No show' },
          { code: 'refus_service', libelle: 'Refus de service' },
          { code: 'ot', libelle: 'OT (objet trouvé)' },
          { code: 'pb', libelle: 'PB (problème technique)' },
          { code: 'dnd', libelle: 'DND (do not disturb)' },
          { code: 'debutant', libelle: 'DEBUTANT(E)' },
        ],
      },
      {
        code: 'sens_service',
        libelle: 'Sens du service',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 3,
        items: [
          { code: 'ponctualite', libelle: 'Ponctualité' },
          { code: 'courtoisie', libelle: 'Courtoisie' },
          { code: 'suivi_recommandations', libelle: 'Suivi des recommandations' },
          { code: 'presentation_hygiene', libelle: 'Présentation et hygiène' },
          { code: 'gestion_priorites', libelle: 'Gestion des priorités' },
          { code: 'lecture', libelle: 'Lecture' },
          { code: 'ecriture', libelle: 'Ecriture' },
        ],
      },
    ],
  },
  {
    posteCode: 'gouvernant',
    questions: [
      {
        code: 'gestion_planning',
        libelle: 'Gestion planning et application des procédures',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 1,
        items: [
          { code: 'point_to', libelle: 'Point TO' },
          { code: 'planning_equipe', libelle: 'Planning équipe' },
          { code: 'modification_envoi_sms', libelle: 'Modification/envoi sms/email au service planning' },
        ],
      },
      {
        code: 'procedures_hotelieres',
        libelle: 'Procédures hôtelières',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 2,
        items: [
          { code: 'objets_trouves', libelle: 'Objets trouvés' },
          { code: 'dnd_refus_service', libelle: 'DND/refus de service' },
          { code: 'accueil_vip', libelle: 'Accueil VIP' },
          { code: 'suivi_tableau_productivite', libelle: 'Suivi tableau productivité selon le cahier des charges' },
          { code: 'signaler_problemes', libelle: 'Signaler les problèmes' },
        ],
      },
      {
        code: 'maitrise_cahier_charges',
        libelle: 'Maîtrise du cahier des charges',
        type: 'grille_qcu',
        obligatoire: true,
        ordre: 3,
        items: [
          { code: 'contrat_gouvernante', libelle: 'Contrat gouvernante' },
          { code: 'contrat_fdc_vdc', libelle: 'Contrat FDC/VDC' },
          { code: 'contrat_equipier', libelle: 'Contrat équipier' },
          { code: 'forfait_ou_chambre', libelle: 'Forfait ou à la chambre' },
          { code: 'fiche_poste_equipier', libelle: 'Fiche de poste équipier' },
          { code: 'rapport_fdc_vdc', libelle: 'Rapport FDC/VDC' },
        ],
      },
      {
        code: 'autres_competences',
        libelle: 'Autres compétences professionnelles',
        type: 'grille_qcu',
        obligatoire: false,
        ordre: 4,
        items: [
          { code: 'ouverture', libelle: 'Ouverture' },
          { code: 'controle_chambres', libelle: 'Contrôle des chambres' },
          { code: 'gestion_linge', libelle: 'Gestion du linge (blanchisseur)' },
          { code: 'gestion_priorites', libelle: 'Gestion des priorités' },
          { code: 'mep_nettoyage', libelle: 'MEP nettoyage' },
        ],
      },
    ],
  },
];

async function seedQuestionnairesEvaluation(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const questionnaire of QUESTIONNAIRES_ACCECIT) {
      const libelleQuestionnaire = questionnaire.posteCode ?? '(générique)';

      let ligneQuestionnaire = await bd('questionnaires_evaluation')
        .where({ entite_id: entite.id, poste_code: questionnaire.posteCode })
        .first();
      if (!ligneQuestionnaire) {
        const [inseree] = await bd('questionnaires_evaluation')
          .insert({ entite_id: entite.id, poste_code: questionnaire.posteCode })
          .returning('id');
        ligneQuestionnaire = inseree;
        console.log(`Questionnaire « ${libelleQuestionnaire} » créé pour « ${codeEntite} » (id=${ligneQuestionnaire.id}) ✔`);
      } else {
        console.log(`Questionnaire « ${libelleQuestionnaire} » déjà présent pour « ${codeEntite} » (id=${ligneQuestionnaire.id}) ✔`);
      }

      for (const question of questionnaire.questions) {
        let ligneQuestion = await bd('questions_evaluation')
          .where({ questionnaire_id: ligneQuestionnaire.id, code: question.code })
          .first();
        if (!ligneQuestion) {
          const [inseree] = await bd('questions_evaluation')
            .insert({
              questionnaire_id: ligneQuestionnaire.id,
              code: question.code,
              libelle: question.libelle,
              type_question: question.type,
              obligatoire: question.obligatoire,
              ordre: question.ordre,
            })
            .returning('id');
          ligneQuestion = inseree;
          console.log(`  Question « ${question.code} » créée (id=${ligneQuestion.id}) ✔`);
        } else {
          await bd('questions_evaluation').where({ id: ligneQuestion.id }).update({
            libelle: question.libelle,
            type_question: question.type,
            obligatoire: question.obligatoire,
            ordre: question.ordre,
          });
          console.log(`  Question « ${question.code} » déjà présente (id=${ligneQuestion.id}) — mise à jour ✔`);
        }

        for (const item of question.items) {
          const itemExistant = await bd('question_items_evaluation')
            .where({ question_id: ligneQuestion.id, code: item.code })
            .first();
          if (!itemExistant) {
            const [inseree] = await bd('question_items_evaluation')
              .insert({
                question_id: ligneQuestion.id,
                code: item.code,
                libelle: item.libelle,
                ordre: question.items.indexOf(item) + 1,
              })
              .returning('id');
            console.log(`    Item « ${item.code} » créé (id=${inseree.id}) ✔`);
          } else {
            await bd('question_items_evaluation')
              .where({ id: itemExistant.id })
              .update({ libelle: item.libelle, ordre: question.items.indexOf(item) + 1 });
            console.log(`    Item « ${item.code} » déjà présent (id=${itemExistant.id}) — mis à jour ✔`);
          }
        }
      }
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedQuestionnairesEvaluation.js <code_entite>');
  process.exit(1);
}

seedQuestionnairesEvaluation(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
