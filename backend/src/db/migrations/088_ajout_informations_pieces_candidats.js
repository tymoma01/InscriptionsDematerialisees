// Informations lues par OCR sur la pièce d'identité et le RIB, puis confirmées par l'accueil
// (core/dossier/informationsPiecesService.js). Toutes nullables : rien n'est connu tant que
// l'accueil n'a pas confirmé, et les candidats existants n'en ont pas.
// IBAN chiffré comme le NIR (AES-256-GCM, même clé Key Vault, voir core/securite/nirCipher.js) :
// iban = données chiffrées + tag, iban_iv = IV. Le BIC, qui ne désigne que la banque, reste en clair.
exports.up = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.string('piece_identite_type', 30).nullable();
    table.string('piece_identite_numero', 30).nullable();
    table.date('piece_identite_delivree_le').nullable();
    table.date('piece_identite_expire_le').nullable();
    table.specificType('iban', 'bytea').nullable();
    table.specificType('iban_iv', 'bytea').nullable();
    table.string('bic', 11).nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropColumn('piece_identite_type');
    table.dropColumn('piece_identite_numero');
    table.dropColumn('piece_identite_delivree_le');
    table.dropColumn('piece_identite_expire_le');
    table.dropColumn('iban');
    table.dropColumn('iban_iv');
    table.dropColumn('bic');
  });
