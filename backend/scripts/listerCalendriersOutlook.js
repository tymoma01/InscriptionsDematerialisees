// Script de diagnostic manuel — pas un test automatisé (voir
// src/integrations/calendrier/graphCalendarService.test.js, qui mocke tout) : liste les VRAIS
// calendriers (id + displayName) d'une boîte Microsoft 365 via GET /users/{email}/calendars, avec
// les mêmes credentials app-only (Key Vault) que graphCalendarService.js.
//
// Sert à identifier l'id Graph du sous-calendrier "TEST TERTIAIRE" observé côté Outlook sur
// tertiaire2@accecit.com : graphCalendarService.obtenirDisponibilites/creerEvenement lisent et
// écrivent aujourd'hui uniquement sur le calendrier PAR DÉFAUT de la boîte
// (/users/{email}/calendarView, /users/{email}/events, sans id de calendrier), jamais sur un
// sous-calendrier nommé — d'où le rapprochement suspecté avec le calendrier "tertiaire2" qui
// n'affiche pas les bonnes infos.
//
// Usage : node scripts/listerCalendriersOutlook.js [email]
// (email par défaut : tertiaire2@accecit.com)
const graphClient = require('../src/integrations/stockage/graphClient');

async function main() {
  const email = process.argv[2] || 'tertiaire2@accecit.com';
  const client = await graphClient.obtenirClientGraph();

  console.log(`--- GET /users/${email}/calendars ---`);
  const reponse = await client.api(`/users/${email}/calendars`).select('id,name,isDefaultCalendar').get();

  for (const calendrier of reponse.value ?? []) {
    console.log(
      `id=${calendrier.id}  isDefaultCalendar=${calendrier.isDefaultCalendar}  name="${calendrier.name}"`,
    );
  }

  if (!reponse.value?.length) {
    console.log('(aucun calendrier retourné)');
  }
}

main().catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exit(1);
});
