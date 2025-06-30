// netlify/functions/send-to-airtable.js

const Airtable = require('airtable'); // Importe la bibliothèque Airtable

// --- Fonctions utilitaires pour la gestion de la requête et d'Airtable ---

/**
 * Définit et retourne les en-têtes CORS pour la réponse HTTP.
 * @returns {Object} Les en-têtes CORS.
 */
function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // REMPLACER PAR LE DOMAINE SHOPIFY RÉEL
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

/**
 * Gère la requête de pré-vérification OPTIONS envoyée par les navigateurs.
 * @param {Object} event - L'objet événement de la requête HTTP.
 * @param {Object} headers - Les en-têtes CORS.
 * @returns {Object} La réponse HTTP pour la requête OPTIONS.
 */
function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: headers,
            body: '',
        };
    }
    return null; // Indique que la requête n'était pas de type OPTIONS
}

/**
 * Valide que la méthode HTTP est POST et que le corps de la requête est présent.
 * @param {Object} event - L'objet événement de la requête HTTP.
 * @param {Object} headers - Les en-têtes CORS.
 * @returns {Object|null} La réponse d'erreur HTTP si invalide, sinon null.
 */
function validatePostRequest(event, headers) {
    if (event.httpMethod !== 'POST' || !event.body) {
        return {
            statusCode: 405, // Method Not Allowed
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée ou corps de requête manquant.' }),
        };
    }
    return null;
}

/**
 * Parse le corps de la requête JSON.
 * @param {string} body - Le corps de la requête HTTP.
 * @param {Object} headers - Les en-têtes CORS pour les réponses d'erreur.
 * @returns {Object} L'objet JavaScript parsé.
 * @throws {Object} Une réponse d'erreur HTTP si le parsing échoue.
 */
function parseRequestBody(body, headers) {
    try {
        const parsedBody = JSON.parse(body);
        console.log('DEBUG SERVER: Corps de la requête JSON bien reçu.');
        return parsedBody;
    } catch (error) {
        console.error('Erreur de parsing JSON du corps de la requête :', error);
        throw { // Lance une exception qui sera capturée par le try/catch principal
            statusCode: 400, // Bad Request
            headers: headers,
            body: JSON.stringify({ message: 'Le corps de la requête n\'est pas un JSON valide.' }),
        };
    }
}

/**
 * Initialise le client Airtable avec les variables d'environnement.
 * @returns {Object} L'instance de la base Airtable.
 * @throws {Error} Si les variables d'environnement Airtable ne sont pas définies.
 */
function initializeAirtableBase() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
        throw new Error("Clé API Airtable ou ID de base manquant(e) dans les variables d'environnement.");
    }
    return new Airtable({ apiKey: apiKey }).base(baseId);
}

/**
 * Récupère les noms des tables Airtable depuis les variables d'environnement.
 * @returns {Object} Un objet contenant les noms des tables.
 * @throws {Error} Si une variable d'environnement pour une table est manquante.
 */
function getAirtableTableNames() {
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;
    // const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME; // Supprimé

    if (!supplierTableName || !productTableName || !answersTableName /* || !scoreTableName */) {
        throw new Error("Un ou plusieurs noms de tables Airtable (Supplier, Product, Answers) sont manquants dans les variables d'environnement.");
    }
    return { supplierTableName, productTableName, answersTableName /* , scoreTableName */ };
}

/**
 * Crée un enregistrement Fournisseur dans Airtable.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table Fournisseurs.
 * @param {Object} formData - Les données du formulaire.
 * @returns {string} L'ID de l'enregistrement Fournisseur créé.
 */
async function createSupplierRecord(base, tableName, formData) {
    const supplierRecord = await base(tableName).create(
        [{
            fields: {
                "prenom_fournisseur": formData.prenom_fournisseur,
                "nom_fournisseur": formData.nom_fournisseur,
                "email_fournisseur": formData.email_fournisseur,
                "entreprise_fournisseur": formData.entreprise_fournisseur,
                "siret_fournisseur": formData.siret_fournisseur,
            }
        }],
        { typecast: true }
    );
    console.log('Enregistrement Fournisseur créé avec ID :', supplierRecord[0].id);
    return supplierRecord[0].id;
}

/**
 * Crée un enregistrement Produit dans Airtable et le lie au fournisseur.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table Produits.
 * @param {Object} formData - Les données du formulaire.
 * @param {string} supplierId - L'ID du fournisseur lié.
 * @returns {string} L'ID de l'enregistrement Produit créé.
 */
async function createProductRecord(base, tableName, formData, supplierId) {
    const productRecord = await base(tableName).create(
        [{
            fields: {
                "nom_produit": formData.nom_produit,
                "description_produit": formData.description_produit,
                "ID_fournisseur": [supplierId]
            }
        }],
        { typecast: true }
    );
    console.log('Enregistrement Produit créé avec ID :', productRecord[0].id);
    return productRecord[0].id;
}

/**
 * Traite les réponses dynamiques et prépare les enregistrements pour la table des réponses.
 * Les calculs de score et de masse sont effectués ici pour être utilisés si besoin par d'autres fonctions.
 * @param {Object} formData - Les données du formulaire soumises par l'utilisateur.
 * @param {Array} dynamicQuestions - Les définitions des questions dynamiques (avec catégorie et coefficient).
 * @returns {Object} Un objet contenant les indicateurs calculés, les masses et les réponses à créer.
 */
function processDynamicQuestionsAndCalculateScores(formData, dynamicQuestions) {
    // Ces indicateurs sont toujours calculés car ils sont potentiellement utiles même sans enregistrement direct du score.
    const calculatedIndicators = {
        EmatA: 0, EmatB: 0,
        EapproA: 0, EapproB: 0,
        EfabA: 0, EfabB: 0,
        EdistribA: 0, EdistribB: 0,
        EnrjA: 0, EnrjB: 0,
        EeauA: 0, EeauB: 0,
        EfdvA: 0, EfdvB: 0,
    };
    let productA_Mass = null;
    let productB_Mass = null;
    const answersToCreate = [];

    // Crée une Map pour un accès rapide aux définitions complètes des questions.
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    for (const key in formData) {
        // Ignore les champs non liés aux questions dynamiques ou déjà traités.
        if ([
            'prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur',
            'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit',
            'description_produit', 'timestamp_soumission'
        ].includes(key)) {
            continue;
        }

        const questionDef = questionLookupMap.get(key);
        let answerValue = formData[key];

        // Gère les réponses multiples (ex: checkboxes)
        if (Array.isArray(answerValue)) {
            answerValue = answerValue.join(', ');
        }

        // Récupère les masses si les indicateurs correspondants sont trouvés.
        if (key === 'MasseA') {
            productA_Mass = parseFloat(answerValue);
            if (isNaN(productA_Mass)) {
                console.warn(`DEBUG SERVER: Masse du produit A ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                productA_Mass = answerValue;
            }
        }
        if (key === 'MasseB') {
            productB_Mass = parseFloat(answerValue);
            if (isNaN(productB_Mass)) {
                console.warn(`DEBUG SERVER: Masse du produit B ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                productB_Mass = answerValue;
            }
        }

        // Calcule et accumule les scores pour les catégories définies.
        if (questionDef && calculatedIndicators.hasOwnProperty(questionDef.categorie_questions)) {
            const numericAnswer = parseFloat(answerValue);
            const coefficient = parseFloat(questionDef.coeff_questions);

            if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                const individualScore = numericAnswer * coefficient;
                calculatedIndicators[questionDef.categorie_questions] += individualScore;
                console.log(`DEBUG SERVER: Calcul pour ${questionDef.categorie_questions} (${key}): ${numericAnswer} * ${coefficient} = ${individualScore}. Total accumulé: ${calculatedIndicators[questionDef.categorie_questions]}`);
            } else {
                console.warn(`DEBUG SERVER: Réponse ou coefficient invalide pour question '${questionDef.titre}' (Catégorie: ${questionDef.categorie_questions}). Cette question n'a pas contribué au score.`);
            }
        }

        // Prépare les données pour l'enregistrement dans la table "Réponses".
        if (answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '' && questionDef && questionDef.id_question) {
            answersToCreate.push({
                fields: {
                    "ID_produit": [], // L'ID produit sera ajouté plus tard.
                    "ID_questions": [questionDef.id_question],
                    "Réponse": String(answerValue),
                }
            });
        }
    }

    return { calculatedIndicators, productA_Mass, productB_Mass, answersToCreate };
}

/**
 * Crée les enregistrements de réponses par lots dans Airtable.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table Réponses.
 * @param {Array} answersToCreate - Le tableau des réponses à créer.
 * @param {string} productId - L'ID du produit pour lier les réponses.
 */
async function batchCreateAnswersRecords(base, tableName, answersToCreate, productId) {
    if (answersToCreate.length === 0) {
        console.log('DEBUG SERVER: Aucune réponse dynamique à créer dans la table Réponses.');
        return;
    }

    console.log(`DEBUG SERVER: Tentative de création de ${answersToCreate.length} réponses dans la table Réponses.`);
    const batchSize = 10; // Limite de l'API Airtable pour les opérations en batch.
    for (let i = 0; i < answersToCreate.length; i += batchSize) {
        const batch = answersToCreate.slice(i, i + batchSize);
        // Ajoute l'ID_produit à chaque enregistrement du lot
        batch.forEach(record => {
            record.fields["ID_produit"] = [productId];
        });
        await base(tableName).create(batch, { typecast: true });
    }
    console.log(`${answersToCreate.length} réponses dynamiques créées dans la table Réponses.`);
}


// --- Fonction de gestionnaire principale Netlify ---

/**
 * Fonction de gestionnaire principale pour les requêtes HTTP entrantes vers ce service Netlify.
 * Elle orchestre le flux complet de traitement d'une soumission de formulaire :
 * validation, parsing, création d'enregistrements dans Airtable (Fournisseur, Produit, Réponses).
 * @param {Object} event - L'objet événement de la requête HTTP entrante, contenant toutes les informations (méthode, en-têtes, corps).
 * @returns {Object} La réponse HTTP à renvoyer au client, incluant le statut, les en-têtes et le corps JSON.
 */
exports.handler = async (event) => {
    const headers = getCorsHeaders(); // Récupère les en-têtes CORS standards pour les réponses.

    // 1. Gérer les requêtes OPTIONS (pré-vérification CORS).
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) {
        return optionsResponse;
    }

    // 2. Valider la méthode HTTP (doit être POST) et la présence d'un corps de requête.
    const validationError = validatePostRequest(event, headers);
    if (validationError) {
        return validationError;
    }

    try {
        // Le bloc try/catch principal englobe toutes les opérations asynchrones pour une gestion centralisée des erreurs.

        // 3. Parser le corps de la requête JSON pour en extraire les données.
        const requestBody = parseRequestBody(event.body, headers);
        const formData = requestBody.formData; // Données brutes du formulaire soumis par l'utilisateur.
        const dynamicQuestions = requestBody.dynamicQuestions; // Définitions des questions (catégories, coefficients).

        // Validation initiale des données critiques.
        if (!formData) {
            throw { statusCode: 400, headers: headers, body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }) };
        }
        if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
            console.warn("dynamicQuestions n'est pas un tableau valide ou est manquant. Cela peut affecter les calculs des indicateurs.");
        }

        // 4. Initialiser la connexion à la base Airtable et récupérer les noms de tables configurés.
        const base = initializeAirtableBase();
        // Note: 'scoreTableName' a été retiré de getAirtableTableNames et n'est plus nécessaire ici.
        const { supplierTableName, productTableName, answersTableName } = getAirtableTableNames();

        // 5. Créer l'enregistrement pour le Fournisseur dans Airtable.
        const supplierId = await createSupplierRecord(base, supplierTableName, formData);

        // 6. Créer l'enregistrement pour le Produit dans Airtable et le lier au Fournisseur.
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        // 7. Traiter les questions dynamiques et préparer les réponses.
        // Les indicateurs sont toujours calculés, mais ne sont plus explicitement enregistrés dans une table "Score".
        // Ils pourraient être utilisés pour des logs ou des traitements ultérieurs non liés à Airtable.
        const { calculatedIndicators, productA_Mass, productB_Mass, answersToCreate } =
            processDynamicQuestionsAndCalculateScores(formData, dynamicQuestions);

        // 8. Créer les enregistrements de Réponses par lots dans Airtable.
        await batchCreateAnswersRecords(base, answersTableName, answersToCreate, productId);

        // 9. Retourner une réponse de succès au client.
        // Note: 'scoreId' a été retiré de la réponse car la table Score n'est plus utilisée.
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses) envoyées avec succès !',
                supplierId: supplierId,
                productId: productId,
            }),
        };

    } catch (error) {
        // Gestion centralisée des erreurs : capture toutes les exceptions lancées dans le bloc try.
        console.error('Erreur globale lors de l\'envoi à Airtable ou du traitement de la requête :', error);

        const statusCode = error.statusCode || 500;
        const errorMessage = error.body ? JSON.parse(error.body).message : `Erreur serveur inattendue: ${error.message || 'Une erreur inconnue est survenue.'}`;

        return {
            statusCode: statusCode,
            headers: headers,
            body: JSON.stringify({ message: errorMessage }),
        };
    }
};