// netlify/functions/send-to-airtable.js

const Airtable = require('airtable');
const fetch = require('node-fetch'); // Nécessaire pour les appels à l'API Meta d'Airtable

// --- Configuration des variables d'environnement ---
// Il est essentiel que ces variables soient définies dans les paramètres de votre site Netlify
// ou dans un fichier .env si le test est effectué en local.
// AIRTABLE_API_KEY : Clé API Airtable (commence par 'pat...')
// AIRTABLE_BASE_ID : ID de la base Airtable (commence par 'app...')
// AIRTABLE_SUPPLIER_TABLE_NAME : Nom de la table des fournisseurs (ex: "Fournisseurs")
// AIRTABLE_PRODUCT_TABLE_NAME : Nom de la table des produits (ex: "Produits")
// AIRTABLE_ANSWERS_TABLE_NAME : Nom de la table des réponses (ex: "Réponses")
// AIRTABLE_SCORE_TABLE_NAME : Nom de la table des scores (ex: "Score")


// --- Fonctions utilitaires pour la gestion de la requête HTTP et de l'API Airtable ---

/**
 * Définit et retourne les en-têtes CORS pour la réponse HTTP, permettant l'accès depuis le domaine Shopify.
 * @returns {Object} Les en-têtes CORS nécessaires pour les requêtes cross-origin.
 */
function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // **IMPORTANT : Remplacer par le domaine Shopify réel de la boutique.**
        'Access-Control-Allow-Methods': 'POST, OPTIONS', // Autorise les méthodes POST et OPTIONS.
        'Access-Control-Allow-Headers': 'Content-Type', // Autorise l'en-tête Content-Type.
    };
}

/**
 * Gère la requête de pré-vérification CORS (OPTIONS) envoyée automatiquement par les navigateurs.
 * Si la requête est une OPTIONS, une réponse de succès (204 No Content) est envoyée avec les en-têtes CORS.
 * @param {Object} event - L'objet événement de la requête HTTP.
 * @param {Object} headers - Les en-têtes CORS à inclure dans la réponse.
 * @returns {Object|null} La réponse HTTP pour la requête OPTIONS si applicable, sinon null.
 */
function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        console.log('DEBUG SERVER: Requête OPTIONS reçue. Envoi de la réponse 204.');
        return {
            statusCode: 204, // Code 204 (No Content) est utilisé pour les requêtes OPTIONS réussies.
            headers: headers,
            body: '', // Corps vide pour les requêtes OPTIONS.
        };
    }
    return null; // Indique que la requête n'est pas de type OPTIONS.
}

/**
 * Valide que la méthode HTTP est POST et que le corps de la requête est présent.
 * Retourne une réponse d'erreur si les conditions ne sont pas remplies.
 * @param {Object} event - L'objet événement de la requête HTTP.
 * @param {Object} headers - Les en-têtes CORS pour les réponses d'erreur.
 * @returns {Object|null} La réponse d'erreur HTTP si la validation échoue, sinon null.
 */
function validatePostRequest(event, headers) {
    if (event.httpMethod !== 'POST') {
        console.error(`Erreur: Méthode non autorisée. Méthode reçue: ${event.httpMethod}`);
        return {
            statusCode: 405, // 405 Method Not Allowed.
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' }),
        };
    }
    if (!event.body) {
        console.error('Erreur: Corps de requête manquant pour une requête POST.');
        return {
            statusCode: 400, // 400 Bad Request.
            headers: headers,
            body: JSON.stringify({ message: 'Corps de requête manquant. Veuillez envoyer un JSON.' }),
        };
    }
    return null; // La requête est valide.
}

/**
 * Parse le corps de la requête JSON.
 * @param {string} body - Le corps de la requête HTTP (chaîne JSON).
 * @param {Object} headers - Les en-têtes CORS pour les réponses d'erreur.
 * @returns {Object} L'objet JavaScript parsé.
 * @throws {Object} Une réponse d'erreur HTTP structurée si le parsing échoue (pour être capturée par le try/catch global).
 */
function parseRequestBody(body, headers) {
    try {
        const parsedBody = JSON.parse(body);
        console.log('DEBUG SERVER: Corps de la requête JSON bien reçu et parsé.');
        return parsedBody;
    } catch (error) {
        console.error('Erreur de parsing JSON du corps de la requête :', error.message);
        throw { // Lance une exception avec la structure d'une réponse HTTP.
            statusCode: 400, // 400 Bad Request.
            headers: headers,
            body: JSON.stringify({ message: 'Le corps de la requête n\'est pas un JSON valide.' }),
        };
    }
}

/**
 * Initialise le client Airtable avec la clé API et l'ID de base provenant des variables d'environnement.
 * @returns {Object} L'instance de la base Airtable.
 * @throws {Error} Si les variables d'environnement Airtable nécessaires ne sont pas définies.
 */
function initializeAirtableBase() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
        console.error("Erreur de configuration: Clé API Airtable ou ID de base manquant(e) dans les variables d'environnement.");
        throw new Error("Erreur de configuration: Impossible de se connecter à Airtable. Contacter l'administrateur.");
    }
    return new Airtable({ apiKey: apiKey }).base(baseId);
}

/**
 * Récupère les noms des tables Airtable à partir des variables d'environnement.
 * @returns {Object} Un objet contenant les noms des tables.
 * @throws {Error} Si l'une des variables d'environnement pour les noms de table est manquante.
 */
function getAirtableTableNames() {
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;
    const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME;

    if (!supplierTableName || !productTableName || !answersTableName || !scoreTableName) {
        console.error("Erreur de configuration: Un ou plusieurs noms de tables Airtable (Supplier, Product, Answers, Score) sont manquants dans les variables d'environnement.");
        throw new Error("Erreur de configuration: Noms de tables Airtable manquants. Contacter l'administrateur.");
    }
    return { supplierTableName, productTableName, answersTableName, scoreTableName };
}

/**
 * Crée un enregistrement pour un fournisseur dans la table spécifiée d'Airtable.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table des fournisseurs.
 * @param {Object} formData - Les données du formulaire soumises par l'utilisateur.
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
            },
        }],
        { typecast: true } // Active la conversion de type automatique par Airtable.
    );
    console.log('INFO: Enregistrement Fournisseur créé avec ID :', supplierRecord[0].id);
    return supplierRecord[0].id;
}

/**
 * Crée un enregistrement pour un produit dans la table spécifiée d'Airtable et le lie au fournisseur.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table des produits.
 * @param {Object} formData - Les données du formulaire soumises par l'utilisateur.
 * @param {string} supplierId - L'ID de l'enregistrement Fournisseur associé.
 * @returns {string} L'ID de l'enregistrement Produit créé.
 */
async function createProductRecord(base, tableName, formData, supplierId) {
    const productRecord = await base(tableName).create(
        [{
            fields: {
                "nom_produit": formData.nom_produit,
                "description_produit": formData.description_produit,
                "ID_fournisseur": [supplierId], // Liaison vers l'enregistrement Fournisseur.
            },
        }],
        { typecast: true }
    );
    console.log('INFO: Enregistrement Produit créé avec ID :', productRecord[0].id);
    return productRecord[0].id;
}

/**
 * Traite les réponses des questions dynamiques, calcule les indicateurs de score,
 * et prépare les réponses brutes pour la table "Réponses".
 * Gère également l'extraction des masses et durées de vie des produits A et B.
 * @param {Object} formData - Les données brutes du formulaire soumises par l'utilisateur.
 * @param {Array} dynamicQuestions - Les définitions des questions dynamiques (avec catégorie, coefficient, etc.).
 * @returns {Object} Un objet contenant les indicateurs calculés, les masses, les durées de vie, les réponses à créer pour la table "Réponses", et la map des questions.
 */
function processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions) {
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
    let productA_DureeVie = null;
    let productB_DureeVie = null;
    let productA_Price = null; 
    let productB_Price = null; 
    const answersToCreateForAnswersTable = [];

    // Crée une Map pour un accès rapide aux définitions complètes des questions par leur `indicateur_questions`.
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    // Parcours toutes les réponses du formulaire.
    for (const key in formData) {
        // Tente de trouver la définition de la question correspondante.
        const questionDef = questionLookupMap.get(key);
        let answerValue = formData[key];

        // Gère les réponses multiples (ex: checkboxes en tableau) en les joignant en une chaîne.
        if (Array.isArray(answerValue)) {
            answerValue = answerValue.join(', ');
        }

        // Extrait les masses des produits A et B.
        if (key === 'MasseA') {
            productA_Mass = parseFloat(answerValue);
            if (isNaN(productA_Mass)) console.warn(`DEBUG SERVER: Masse du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'MasseB') {
            productB_Mass = parseFloat(answerValue);
            if (isNaN(productB_Mass)) console.warn(`DEBUG SERVER: Masse du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Extrait les durées de vie des produits A et B.
        if (key === 'DureeVieA') {
            productA_DureeVie = parseFloat(answerValue);
            if (isNaN(productA_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'DureeVieB') {
            productB_DureeVie = parseFloat(answerValue);
            if (isNaN(productB_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Extrait les prix des produits A et B.
        if (key === 'PrixA') { // Clé exacte de la question pour le prix A
            productA_Price = parseFloat(answerValue);
            if (isNaN(productA_Price)) console.warn(`DEBUG SERVER: Prix du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'PrixB') { // Clé exacte de la question pour le prix B
            productB_Price = parseFloat(answerValue);
            if (isNaN(productB_Price)) console.warn(`DEBUG SERVER: Prix du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Calcule et accumule les scores pour les catégories d'indicateurs (EmatA, EapproB, etc.).
        // La question doit avoir une définition et sa catégorie doit être parmi les indicateurs attendus.
        if (questionDef && calculatedIndicators.hasOwnProperty(questionDef.categorie_questions)) {
            const numericAnswer = parseFloat(answerValue);
            const coefficient = parseFloat(questionDef.coeff_questions);

            if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                const individualScore = numericAnswer * coefficient;
                calculatedIndicators[questionDef.categorie_questions] += individualScore;
            } else {
                console.warn(`DEBUG SERVER: Réponse ou coefficient invalide pour question '${questionDef.titre}' (Catégorie: ${questionDef.categorie_questions}). Cette question n'a pas contribué au score.`);
            }
        }

        // Prépare les données pour l'enregistrement dans la table "Réponses".
        // Ne stocke que les réponses qui ont une définition de question et une ID de question.
        if (questionDef && questionDef.id_question && answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '') {
            answersToCreateForAnswersTable.push({
                fields: {
                    // "ID_produit" sera ajouté lors de la création en batch.
                    "ID_questions": [questionDef.id_question], // Liaison vers la question spécifique dans Airtable.
                    "Réponse": String(answerValue), // S'assure que la réponse est une chaîne.
                },
            });
        }
    }

    return {
        calculatedIndicators,
        productA_Mass,
        productB_Mass,
        productA_DureeVie,
        productB_DureeVie,
        answersToCreateForAnswersTable,
        questionLookupMap, // Retourne la map pour réutilisation ultérieure.
    };
}

/**
 * Calcule les coûts totaux d'usage pour les produits A et B,
 * en additionnant les coûts d'énergie et les coûts d'eau.
 * Les coûts d'énergie sont calculés comme (Réponse * PrixEnrj) sans coefficient.
 * Le prix de l'eau est également extrait du champ PrixEnrj des questions d'eau.
 *
 * @param {Object} formData - Les données du formulaire soumises par l'utilisateur.
 * @param {Map} questionLookupMap - Une carte pour rechercher les définitions de questions par leur `indicateur_questions`.
 * @returns {Object} Un objet contenant `totalUsageCostA` et `totalUsageCostB`.
 */
function calculateTotalUsageCost(formData, questionLookupMap) {
    let totalUsageCostA = 0;
    let totalUsageCostB = 0;

    // --- Calcul des coûts d'énergie (catégorie 'Enrj') ---
    for (const [key, questionDef] of questionLookupMap.entries()) {
        if (questionDef.categorie_questions === 'Enrj') {
            const answerValue = parseFloat(formData[key]);
            const energyPrice = parseFloat(questionDef.PrixEnrj); // Récupère PrixEnrj depuis la définition de la question.

            // Vérifie que les valeurs sont numériques avant de calculer.
            if (!isNaN(answerValue) && !isNaN(energyPrice)) {
                const cost = answerValue * energyPrice; // Calcul sans le coefficient comme spécifié.
                if (key.endsWith('A')) {
                    totalUsageCostA += cost;
                } else if (key.endsWith('B')) {
                    totalUsageCostB += cost;
                }
            } else {
                console.warn(`DEBUG SERVER: Valeur de réponse (${formData[key]}) ou PrixEnrj (${questionDef.PrixEnrj}) invalide pour question d'énergie '${questionDef.titre}' (${key}). Cette question n'a pas contribué au coût d'usage.`);
            }
        }
    }

    // --- Ajout des coûts d'eau ('eauUnAnA' et 'eauUnAnB') ---
    const waterQuestionsKeys = ['eauUnAnA', 'eauUnAnB'];

    waterQuestionsKeys.forEach(waterQKey => {
        const questionDef = questionLookupMap.get(waterQKey); // Obtient la définition de la question d'eau.
        if (questionDef) {
            const answerValue = parseFloat(formData[waterQKey]);
            const waterPrice = parseFloat(questionDef.PrixEnrj); // Le prix de l'eau utilise aussi le champ PrixEnrj.

            if (!isNaN(answerValue) && !isNaN(waterPrice)) {
                if (waterQKey === 'eauUnAnA') {
                    totalUsageCostA += (answerValue * waterPrice);
                } else if (waterQKey === 'eauUnAnB') {
                    totalUsageCostB += (answerValue * waterPrice);
                }
            } else {
                console.warn(`DEBUG SERVER: Valeur de réponse (${formData[waterQKey]}) ou PrixEnrj (${questionDef.PrixEnrj}) invalide pour question d'eau '${questionDef.titre}' (${waterQKey}). N'a pas contribué au coût d'usage.`);
            }
        } else {
            console.warn(`DEBUG SERVER: Définition de question pour '${waterQKey}' manquante dans dynamicQuestions. Impossible de calculer le coût de l'eau.`);
        }
    });

    return { totalUsageCostA, totalUsageCostB };
}


/**
 * Crée les enregistrements de réponses par lots dans Airtable.
 * Cela permet d'envoyer plusieurs réponses en une seule requête API, optimisant la performance.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table des réponses.
 * @param {Array} answersToCreate - Le tableau des objets réponses à créer.
 * @param {string} productId - L'ID de l'enregistrement Produit pour la liaison.
 */
async function batchCreateAnswersRecords(base, tableName, answersToCreate, productId) {
    if (answersToCreate.length === 0) {
        console.log('DEBUG SERVER: Aucune réponse dynamique à créer dans la table Réponses.');
        return;
    }

    console.log(`DEBUG SERVER: Tentative de création de ${answersToCreate.length} réponses dans la table Réponses.`);
    const batchSize = 10; // La limite de l'API Airtable pour les opérations en batch est de 10 enregistrements.

    // Parcourt les réponses par lots de 10.
    for (let i = 0; i < answersToCreate.length; i += batchSize) {
        const batch = answersToCreate.slice(i, i + batchSize);
        // Ajoute l'ID_produit à chaque enregistrement du lot avant l'envoi.
        batch.forEach(record => {
            record.fields["ID_produit"] = [productId];
        });
        await base(tableName).create(batch, { typecast: true });
    }
    console.log(`INFO: ${answersToCreate.length} réponses dynamiques créées dans la table Réponses.`);
}

/**
 * Crée un enregistrement dans la table "Score" avec les indicateurs calculés, les masses, les durées de vie,
 * et les coûts totaux d'usage.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table Score.
 * @param {string} productId - L'ID de l'enregistrement Produit lié.
 * @param {Object} calculatedIndicators - L'objet contenant tous les indicateurs (EmatA, EmatB, etc.).
 * @param {number|string} productA_Mass - La masse du produit A.
 * @param {number|string} productB_Mass - La masse du produit B.
 * @param {number|string} productA_DureeVie - La durée de vie du produit A.
 * @param {number|string} productB_DureeVie - La durée de vie du produit B.
 * @param {number} totalUsageCostA - Le coût total d'usage pour le produit A.
 * @param {number} totalUsageCostB - Le coût total d'usage pour le produit B.
 * @returns {string} L'ID de l'enregistrement Score créé.
 */
async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, totalUsageCostA, totalUsageCostB) {
    const scoreRecord = await base(tableName).create(
        [{
            fields: {
                "ID_produit": [productId], // Liaison vers l'enregistrement Produit.
                ...calculatedIndicators, // Dégage toutes les propriétés de calculatedIndicators directement dans les champs.
                "MasseA": productA_Mass,
                "MasseB": productB_Mass,
                "DureeVieA": productA_DureeVie,
                "DureeVieB": productB_DureeVie,
                "CoutTotalUsageA": totalUsageCostA, // Ajout du coût total d'usage A.
                "CoutTotalUsageB": totalUsageCostB,  // Ajout du coût total d'usage B.
            },
        }],
        { typecast: true }
    );
    console.log('INFO: Enregistrement Score créé avec ID :', scoreRecord[0].id);
    return scoreRecord[0].id;
}


// --- Fonction de gestionnaire principale Netlify ---

/**
 * Fonction de gestionnaire principale pour les requêtes HTTP entrantes vers ce service Netlify.
 * Elle orchestre le flux complet de traitement d'une soumission de formulaire :
 * validation, parsing, création d'enregistrements dans Airtable (Fournisseur, Produit, Réponses, Score).
 * @param {Object} event - L'objet événement de la requête HTTP entrante.
 * @returns {Object} La réponse HTTP à renvoyer au client.
 */
exports.handler = async (event) => {
    // 1. Récupère les en-têtes CORS pour toutes les réponses.
    const headers = getCorsHeaders();

    // 2. Gère les requêtes OPTIONS (pré-vérification CORS) et sort si applicable.
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) {
        return optionsResponse;
    }

    // 3. Valide la méthode HTTP (doit être POST) et la présence du corps de la requête.
    const validationError = validatePostRequest(event, headers);
    if (validationError) {
        return validationError;
    }

    try {
        // Le bloc try/catch principal englobe toutes les opérations asynchrones
        // pour une gestion centralisée et robuste des erreurs.

        // 4. Parse le corps de la requête JSON pour en extraire les données du formulaire et les définitions des questions.
        const requestBody = parseRequestBody(event.body, headers);
        const formData = requestBody.formData; // Données du formulaire soumises.
        const dynamicQuestions = requestBody.dynamicQuestions; // Définitions des questions (catégories, coefficients, PrixEnrj).

        // Validation initiale des données critiques.
        if (!formData) {
            console.error("Erreur: Données du formulaire (formData) manquantes dans la requête.");
            throw { statusCode: 400, headers: headers, body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }) };
        }
        if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
            // Un avertissement est suffisant ici, car le traitement peut se poursuivre pour d'autres tables.
            console.warn("DEBUG SERVER: dynamicQuestions n'est pas un tableau valide ou est manquant. Certains calculs d'indicateurs et de coûts d'usage pourraient être affectés, mais les données principales seront stockées.");
        }

        // 5. Initialise la connexion à la base Airtable et récupère les noms des tables configurés.
        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName } = getAirtableTableNames();

        // 6. Crée l'enregistrement pour le Fournisseur dans Airtable.
        const supplierId = await createSupplierRecord(base, supplierTableName, formData);

        // 7. Crée l'enregistrement pour le Produit dans Airtable et le lie au Fournisseur.
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

       // 8. Traite les questions dynamiques, calcule les indicateurs, et collecte les réponses pour la table "Réponses".
        const {
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price, // Récupération du prix A
            productB_Price, // Récupération du prix B
            answersToCreateForAnswersTable,
            questionLookupMap
        } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);


        // 9. Calcule les coûts totaux d'usage pour les produits A et B en utilisant la nouvelle fonction.
        const { totalUsageCostA, totalUsageCostB } = calculateTotalUsageCost(formData, questionLookupMap);
        console.log('DEBUG SERVER: Coût Total d\'Usage A calculé :', totalUsageCostA);
        console.log('DEBUG SERVER: Coût Total d\'Usage B calculé :', totalUsageCostB);

        // 10. Crée les enregistrements de Réponses par lots dans Airtable, en les liant au Produit.
        await batchCreateAnswersRecords(base, answersTableName, answersToCreateForAnswersTable, productId);

       // 11. Crée l'enregistrement dans la table "Score" avec tous les indicateurs, masses, durées de vie, et coûts d'usage.
        const scoreId = await createScoreRecord(
            base,
            scoreTableName,
            productId,
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price, 
            productB_Price, 
            totalUsageCostA,
            totalUsageCostB
        );

        // 12. Retourne une réponse de succès au client, incluant les IDs des enregistrements créés
        // et les coûts d'usage calculés.
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses et Score) envoyées avec succès !',
                supplierId: supplierId,
                productId: productId,
                scoreId: scoreId,
                totalUsageCostA: totalUsageCostA,
                totalUsageCostB: totalUsageCostB,
            }),
        };

    } catch (error) {
        // 13. Gestion centralisée des erreurs : capture toutes les exceptions lancées dans le bloc try.
        console.error('Erreur globale lors de l\'envoi à Airtable ou du traitement de la requête :', error);

        const statusCode = error.statusCode || 500; // Utilise le code d'erreur si défini, sinon 500.
        const errorMessage = error.body ? JSON.parse(error.body).message : `Erreur serveur inattendue: ${error.message || 'Une erreur inconnue est survenue.'}`;

        return {
            statusCode: statusCode,
            headers: headers,
            body: JSON.stringify({ message: errorMessage }),
        };
    }
};