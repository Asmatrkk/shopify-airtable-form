// netlify/functions/send-to-airtable.js

// Importe les modules nécessaires.
// `airtable` est la bibliothèque client pour interagir avec l'API Airtable.
// `node-fetch` est un module pour effectuer des requêtes HTTP (bien que non utilisé directement pour les opérations Airtable ici,
// il est souvent présent pour d'autres appels d'API).
const Airtable = require('airtable');
const fetch = require('node-fetch');

/**
 * @function getCorsHeaders
 * @description Configure et retourne les en-têtes CORS (Cross-Origin Resource Sharing).
 * Ces en-têtes sont cruciaux pour la sécurité et la permission des requêtes provenant
 * d'un domaine externe (comme Shopify) d'accéder à cette fonction Netlify.
 * @returns {Object} Un objet contenant les en-têtes CORS.
 */
function getCorsHeaders() {
    return {
        // Définit l'origine spécifique (ton domaine Shopify) autorisée à effectuer des requêtes.
        // C'est une mesure de sécurité essentielle pour éviter les requêtes non autorisées.
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com',
        // Spécifie les méthodes HTTP (POST, OPTIONS) que le client est autorisé à utiliser.
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        // Indique les en-têtes HTTP que le client peut inclure dans sa requête.
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

/**
 * @function handleOptionsRequest
 * @description Gère les requêtes HTTP de type 'OPTIONS'. Ces requêtes sont des "pre-flight requests" CORS,
 * automatiquement envoyées par les navigateurs avant la requête réelle (ex: POST) pour vérifier les permissions.
 * @param {Object} event L'objet événement Netlify Lambda représentant la requête HTTP entrante.
 * @param {Object} headers Les en-têtes CORS à inclure dans la réponse.
 * @returns {Object|null} Une réponse HTTP 204 (No Content) si la requête est OPTIONS, sinon `null`.
 */
function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        console.log('DEBUG SERVER: Requête OPTIONS reçue. Envoi de la réponse 204.');
        return {
            statusCode: 204, // 204 No Content indique un succès pour la pré-vérification OPTIONS.
            headers: headers,
            body: '', // Le corps de la réponse est vide pour les requêtes OPTIONS.
        };
    }
    return null;
}

/**
 * @function validatePostRequest
 * @description Valide que la requête HTTP est bien de type 'POST' et qu'elle contient un corps.
 * Si la validation échoue, une réponse d'erreur appropriée est générée et retournée.
 * @param {Object} event L'objet événement Netlify Lambda de la requête.
 * @param {Object} headers Les en-têtes CORS pour les réponses d'erreur.
 * @returns {Object|null} Une réponse d'erreur HTTP si la validation échoue, sinon `null`.
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
    return null;
}

/**
 * @function parseRequestBody
 * @description Tente de parser le corps de la requête HTTP (attendu au format JSON) en un objet JavaScript.
 * Gère les erreurs de parsing si le corps n'est pas un JSON valide.
 * @param {string} body Le corps brut de la requête HTTP.
 * @param {Object} headers Les en-têtes CORS pour les réponses d'erreur.
 * @returns {Object} L'objet JavaScript parsé.
 * @throws {Object} Une réponse d'erreur HTTP structurée si le parsing échoue.
 */
function parseRequestBody(body, headers) {
    try {
        const parsedBody = JSON.parse(body);
        console.log('DEBUG SERVER: Corps de la requête JSON bien reçu et parsé.');
        return parsedBody;
    } catch (error) {
        console.error('Erreur de parsing JSON du corps de la requête :', error.message);
        throw {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Le corps de la requête n\'est pas un JSON valide.' }),
        };
    }
}

/**
 * @function initializeAirtableBase
 * @description Initialise et retourne une instance de la base Airtable.
 * Elle utilise les clés API et l'ID de la base stockés en toute sécurité dans les variables d'environnement Netlify.
 * Il est crucial de s'assurer que ces variables (AIRTABLE_API_KEY, AIRTABLE_BASE_ID) sont correctement configurées.
 * @returns {Object} L'instance de la base Airtable connectée.
 * @throws {Error} Si les variables d'environnement requises sont manquantes, empêchant la connexion.
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
 * @function getAirtableTableNames
 * @description Récupère les noms des différentes tables Airtable utilisées par la fonction à partir des variables d'environnement.
 * Cette pratique centralise la configuration des noms de tables et facilite leur gestion.
 * Assure-toi que les variables d'environnement correspondantes sont définies dans Netlify.
 * @returns {Object} Un objet contenant les noms des tables (supplier, product, answers, score).
 * @throws {Error} Si un ou plusieurs noms de tables sont manquants dans les variables d'environnement.
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
 * @async
 * @function createSupplierRecord
 * @description Crée un nouvel enregistrement dans la table des Fournisseurs d'Airtable.
 * Les champs sont directement mappés à partir des données du formulaire soumises par l'utilisateur.
 * @param {Object} base L'instance de la base Airtable.
 * @param {string} tableName Le nom de la table des fournisseurs.
 * @param {Object} formData Les données du formulaire contenant les informations du fournisseur.
 * @returns {Promise<string>} Une promesse qui se résout avec l'ID de l'enregistrement Fournisseur créé.
 */
async function createSupplierRecord(base, tableName, formData) {
    const supplierRecord = await base(tableName).create(
        [{
            fields: {
                // Mappage direct des champs du formulaire aux champs Airtable.
                "prenom_fournisseur": formData.prenom_fournisseur,
                "nom_fournisseur": formData.nom_fournisseur,
                "email_fournisseur": formData.email_fournisseur,
                "entreprise_fournisseur": formData.entreprise_fournisseur,
                "siret_fournisseur": formData.siret_fournisseur,
            },
        }],
        { typecast: true } // Permet à Airtable de convertir automatiquement les types de données si nécessaire.
    );
    console.log('INFO: Enregistrement Fournisseur créé avec ID :', supplierRecord[0].id);
    return supplierRecord[0].id;
}

/**
 * @async
 * @function createProductRecord
 * @description Crée un nouvel enregistrement dans la table des Produits d'Airtable.
 * Cet enregistrement est lié à l'enregistrement du fournisseur via son ID, établissant une relation.
 * @param {Object} base L'instance de la base Airtable.
 * @param {string} tableName Le nom de la table des produits.
 * @param {Object} formData Les données du formulaire contenant les informations du produit.
 * @param {string} supplierId L'ID de l'enregistrement Fournisseur auquel ce produit est lié.
 * @returns {Promise<string>} Une promesse qui se résout avec l'ID de l'enregistrement Produit créé.
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
 * @function processDynamicQuestionsAndCollectAllAnswers
 * @description Traite les réponses aux questions dynamiques du formulaire.
 * Cette fonction effectue plusieurs opérations clés :
 * 1. Initialise et calcule les indicateurs de score (ex: EmatA, EfabB).
 * 2. Extrait les données spécifiques comme la masse, la durée de vie et les prix des produits A et B.
 * 3. Prépare les réponses individuelles pour un enregistrement ultérieur dans la table 'Réponses'.
 * 4. Construit une carte de recherche (`questionLookupMap`) pour un accès rapide aux définitions de questions.
 * @param {Object} formData Les données brutes soumises par le formulaire.
 * @param {Array} dynamicQuestions Un tableau d'objets définissant les questions (catégorie, coefficient, id_question, etc.).
 * @returns {Object} Un objet contenant tous les résultats traités : les indicateurs calculés,
 * les masses, les durées de vie, les prix, les valeurs d'énergie annuelles (EnrjUnAnA/B),
 * les réponses formatées pour la table 'Réponses', et la carte de recherche des questions.
 */
function processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions) {
    // Initialisation des indicateurs de score à zéro.
    const calculatedIndicators = {
        EmatA: 0, EmatB: 0,
        EapproA: 0, EapproB: 0,
        EfabA: 0, EfabB: 0,
        EdistribA: 0, EdistribB: 0,
        EnrjA: 0, EnrjB: 0,
        EeauA: 0, EeauB: 0,
        EfdvA: 0, EfdvB: 0,
    };
    // Initialisation des variables pour les données spécifiques des produits.
    let productA_Mass = null;
    let productB_Mass = null;
    let productA_DureeVie = null;
    let productB_DureeVie = null;
    let productA_Price = null;
    let productB_Price = null;
    let EnrjUnAnA = null; // Variable pour la valeur annuelle d'énergie du produit A.
    let EnrjUnAnB = null; // Variable pour la valeur annuelle d'énergie du produit B.

    const answersToCreateForAnswersTable = []; // Tableau pour stocker les réponses individuelles.

    // Création d'une Map pour un accès rapide aux définitions de questions par leur 'indicateur_questions'.
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    // Parcours toutes les clés (noms de champs) des données du formulaire.
    for (const key in formData) {
        const questionDef = questionLookupMap.get(key); // Récupère la définition de la question correspondante.
        let answerValue = formData[key];

        // Gère les réponses qui sont des tableaux (ex: sélections multiples ou cases à cocher)
        // en les joignant en une seule chaîne.
        if (Array.isArray(answerValue)) {
            answerValue = answerValue.join(', ');
        }

        // Extraction des masses des produits A et B.
        if (key === 'MasseA') {
            productA_Mass = parseFloat(answerValue);
            if (isNaN(productA_Mass)) console.warn(`DEBUG SERVER: Masse du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'MasseB') {
            productB_Mass = parseFloat(answerValue);
            if (isNaN(productB_Mass)) console.warn(`DEBUG SERVER: Masse du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Extraction des durées de vie des produits A et B.
        if (key === 'DureeVieA') {
            productA_DureeVie = parseFloat(answerValue);
            if (isNaN(productA_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'DureeVieB') {
            productB_DureeVie = parseFloat(answerValue);
            if (isNaN(productB_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Extraction des prix des produits A et B.
        if (key === 'PrixA') {
            productA_Price = parseFloat(answerValue);
            if (isNaN(productA_Price)) console.warn(`DEBUG SERVER: Prix du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'PrixB') {
            productB_Price = parseFloat(answerValue);
            if (isNaN(productB_Price)) console.warn(`DEBUG SERVER: Prix du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Capture des valeurs annuelles d'énergie pour les produits A et B.
        if (key === 'EnrjUnAnA') {
            EnrjUnAnA = parseFloat(answerValue);
            if (isNaN(EnrjUnAnA)) console.warn(`DEBUG SERVER: EnrjUnAnA ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'EnrjUnAnB') {
            EnrjUnAnB = parseFloat(answerValue);
            if (isNaN(EnrjUnAnB)) console.warn(`DEBUG SERVER: EnrjUnAnB ("${answerValue}") n'est pas un nombre valide.`);
        }

        // Calcul des scores pour chaque catégorie d'indicateurs (EmatA, EfabB, etc.).
        // Vérifie si une définition de question existe et si la catégorie est une propriété de `calculatedIndicators`.
        if (questionDef && calculatedIndicators.hasOwnProperty(questionDef.categorie_questions)) {
            const numericAnswer = parseFloat(answerValue);
            const coefficient = parseFloat(questionDef.coeff_questions);

            // Effectue le calcul seulement si la réponse et le coefficient sont des nombres valides.
            if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                const individualScore = numericAnswer * coefficient;
                calculatedIndicators[questionDef.categorie_questions] += individualScore;
            } else {
                console.warn(`DEBUG SERVER: Réponse (${answerValue}) ou coefficient (${questionDef.coeff_questions}) invalide pour question '${questionDef.titre}' (Catégorie: ${questionDef.categorie_questions}). Cette question n'a pas contribué au score.`);
            }
        }

        // Préparation des réponses individuelles pour l'insertion dans la table "Réponses".
        // S'assure que la réponse a une définition de question valide, n'est pas nulle/undefined, et n'est pas vide.
        if (questionDef && questionDef.id_question && answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '') {
            answersToCreateForAnswersTable.push({
                fields: {
                    "ID_questions": [questionDef.id_question], // Liaison vers l'enregistrement Questions.
                    "Réponse": String(answerValue), // S'assure que la réponse est stockée comme une chaîne.
                },
            });
        }
    }

    // Retourne un objet contenant toutes les données traitées et collectées.
    return {
        calculatedIndicators,
        productA_Mass,
        productB_Mass,
        productA_DureeVie,
        productB_DureeVie,
        productA_Price,
        productB_Price,
        EnrjUnAnA, // Inclus dans le retour pour être passé à la fonction de calcul des coûts.
        EnrjUnAnB, // Inclus dans le retour pour être passé à la fonction de calcul des coûts.
        answersToCreateForAnswersTable,
        questionLookupMap,
    };
}

/**
 * @function calculateTotalUsageCost
 * @description Calcule les coûts totaux d'usage pour les produits A et B.
 * Cela inclut les coûts liés à l'énergie (EnrjA/B) et à l'eau (eauUnAnA/B),
 * en tenant compte des prix et des multiplicateurs spécifiques.
 * @param {Object} formData Les données du formulaire soumises.
 * @param {Map} questionLookupMap Une carte pour rechercher rapidement les définitions de questions.
 * @param {number|null} EnrjUnAnA La valeur annuelle d'énergie pour le produit A, utilisée comme multiplicateur pour l'eau A.
 * @param {number|null} EnrjUnAnB La valeur annuelle d'énergie pour le produit B, utilisée comme multiplicateur pour l'eau B.
 * @returns {Object} Un objet contenant `totalUsageCostA` et `totalUsageCostB`.
 */
function calculateTotalUsageCost(formData, questionLookupMap, EnrjUnAnA, EnrjUnAnB) {
    let totalUsageCostA = 0;
    let totalUsageCostB = 0;

    // Calcul des coûts d'énergie pour les catégories spécifiques 'EnrjA' et 'EnrjB'.
    for (const [key, questionDef] of questionLookupMap.entries()) {
        // Vérifie si la question appartient spécifiquement à 'EnrjA' ou 'EnrjB'.
        if (questionDef.categorie_questions === 'EnrjA' || questionDef.categorie_questions === 'EnrjB') {
            const answerValue = parseFloat(formData[key]);
            const energyPrice = parseFloat(questionDef.PrixEnrj);

            if (!isNaN(answerValue) && !isNaN(energyPrice)) {
                const cost = answerValue * energyPrice;
                if (key.endsWith('A')) { // Si la clé se termine par 'A', ajoute au coût du produit A.
                    totalUsageCostA += cost;
                } else if (key.endsWith('B')) { // Si la clé se termine par 'B', ajoute au coût du produit B.
                    totalUsageCostB += cost;
                }
            } else {
                console.warn(`DEBUG SERVER: Valeur de réponse (${formData[key]}) ou PrixEnrj (${questionDef.PrixEnrj}) invalide pour question d'énergie '${questionDef.titre}' (${key}). N'a pas contribué au coût d'usage.`);
            }
        }
    }

    // Calcul et ajout des coûts d'eau, avec multiplication par la consommation énergétique annuelle.
    const waterQuestionsKeys = ['eauUnAnA', 'eauUnAnB'];

    waterQuestionsKeys.forEach(waterQKey => {
        const questionDef = questionLookupMap.get(waterQKey);
        if (questionDef) {
            const answerValue = parseFloat(formData[waterQKey]);
            const waterPrice = parseFloat(questionDef.PrixEnrj); // Le prix de l'eau est également tiré de 'PrixEnrj'.

            if (!isNaN(answerValue) && !isNaN(waterPrice)) {
                let waterCost = answerValue * waterPrice;

                // Applique le multiplicateur EnrjUnAnA/B si disponible et valide.
                if (waterQKey === 'eauUnAnA' && !isNaN(EnrjUnAnA)) {
                    totalUsageCostA *= EnrjUnAnA;
                    totalUsageCostA += waterCost;
                } else if (waterQKey === 'eauUnAnB' && !isNaN(EnrjUnAnB)) {
                    totalUsageCostB *= EnrjUnAnB;
                    totalUsageCostB += waterCost;
                } else {
                     // Si EnrjUnAn n'est pas un nombre valide, le coût de l'eau est ajouté sans multiplication.
                     // C'est une décision de conception : on pourrait aussi choisir d'ignorer ce coût si le multiplicateur est invalide.
                     console.warn(`DEBUG SERVER: Multiplicateur EnrjUnAn pour ${waterQKey} n'est pas un nombre valide. Coût de l'eau ajouté sans multiplication.`);
                     if (waterQKey === 'eauUnAnA') totalUsageCostA += waterCost;
                     if (waterQKey === 'eauUnAnB') totalUsageCostB += waterCost;
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
 * @async
 * @function batchCreateAnswersRecords
 * @description Crée des enregistrements de réponses par lots dans la table Airtable spécifiée.
 * Cette fonction optimise les performances en regroupant les opérations d'écriture,
 * respectant la limite de 10 enregistrements par lot d'Airtable. Chaque réponse est liée à un produit.
 * @param {Object} base L'instance de la base Airtable.
 * @param {string} tableName Le nom de la table des réponses.
 * @param {Array<Object>} answersToCreate Un tableau d'objets représentant les réponses à créer.
 * @param {string} productId L'ID de l'enregistrement Produit auquel lier ces réponses.
 * @returns {Promise<void>} Une promesse qui se résout une fois que tous les lots ont été traités.
 */
async function batchCreateAnswersRecords(base, tableName, answersToCreate, productId) {
    if (answersToCreate.length === 0) {
        console.log('DEBUG SERVER: Aucune réponse dynamique à créer dans la table Réponses.');
        return;
    }

    console.log(`DEBUG SERVER: Tentative de création de ${answersToCreate.length} réponses dans la table Réponses.`);
    const batchSize = 10; // Taille maximale du lot d'enregistrements pour une seule requête Airtable.

    // Boucle pour traiter les réponses par lots.
    for (let i = 0; i < answersToCreate.length; i += batchSize) {
        const batch = answersToCreate.slice(i, i + batchSize);
        // Ajoute la liaison du produit à chaque enregistrement du lot avant l'envoi.
        batch.forEach(record => {
            record.fields["ID_produit"] = [productId];
        });
        await base(tableName).create(batch, { typecast: true });
    }
    console.log(`INFO: ${answersToCreate.length} réponses dynamiques créées dans la table Réponses.`);
}

/**
 * @async
 * @function createScoreRecord
 * @description Crée l'enregistrement final dans la table "Score" d'Airtable.
 * Cet enregistrement agrège toutes les données calculées et collectées :
 * les indicateurs de score, les masses, les durées de vie, les prix des produits,
 * et les coûts totaux d'usage, en les liant à l'enregistrement du produit correspondant.
 * @param {Object} base L'instance de la base Airtable.
 * @param {string} tableName Le nom de la table Score.
 * @param {string} productId L'ID de l'enregistrement Produit lié.
 * @param {Object} calculatedIndicators Un objet contenant les scores calculés par catégorie.
 * @param {number|null} productA_Mass La masse du produit A.
 * @param {number|null} productB_Mass La masse du produit B.
 * @param {number|null} productA_DureeVie La durée de vie du produit A.
 * @param {number|null} productB_DureeVie La durée de vie du produit B.
 * @param {number|null} productA_Price Le prix du produit A.
 * @param {number|null} productB_Price Le prix du produit B.
 * @param {number} totalUsageCostA Le coût total d'usage pour le produit A.
 * @param {number} totalUsageCostB Le coût total d'usage pour le produit B.
 * @returns {Promise<string>} Une promesse qui se résout avec l'ID de l'enregistrement Score créé.
 */
async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, totalUsageCostA, totalUsageCostB) {
    // Construction de l'objet 'fields' qui sera envoyé à Airtable.
    const fieldsToSend = {
        "ID_produit": [productId], // Liaison vers le produit principal.
        ...calculatedIndicators, // Utilise l'opérateur de décomposition pour inclure tous les indicateurs.
        "MasseA": productA_Mass,
        "MasseB": productB_Mass,
        "DureeVieA": productA_DureeVie,
        "DureeVieB": productB_DureeVie,
        "PrixA": productA_Price, // Champ Airtable pour le prix du produit A.
        "PrixB": productB_Price, // Champ Airtable pour le prix du produit B.
        "CoutTotalUsageA": totalUsageCostA, // Champ Airtable pour le coût total d'usage du produit A.
        "CoutTotalUsageB": totalUsageCostB,  // Champ Airtable pour le coût total d'usage du produit B.
    };

    console.log('DEBUG SERVER: Champs préparés pour la table Score Airtable :', fieldsToSend);

    const scoreRecord = await base(tableName).create(
        [{
            fields: fieldsToSend,
        }],
        { typecast: true }
    );
    console.log('INFO: Enregistrement Score créé avec ID :', scoreRecord[0].id);
    return scoreRecord[0].id;
}

/**
 * @async
 * @function handler
 * @description Fonction de gestionnaire principale de la fonction Netlify.
 * C'est le point d'entrée pour toutes les requêtes HTTP adressées à cette fonction.
 * Elle orchestre le flux complet : validation de la requête, parsing, interaction avec Airtable
 * pour la création des enregistrements (fournisseur, produit, réponses, score) et gestion des erreurs.
 * @param {Object} event L'objet événement Netlify Lambda représentant la requête HTTP entrante.
 * @returns {Promise<Object>} Une promesse qui se résout avec l'objet de réponse HTTP à renvoyer au client.
 */
exports.handler = async (event) => {
    // Étape 1: Récupération des en-têtes CORS, appliqués à toutes les réponses.
    const headers = getCorsHeaders();

    // Étape 2: Gestion des requêtes OPTIONS (pré-vérification CORS). Si c'est une OPTIONS, on répond immédiatement.
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) {
        return optionsResponse;
    }

    // Étape 3: Validation de la requête POST (méthode et présence du corps).
    const validationError = validatePostRequest(event, headers);
    if (validationError) {
        return validationError;
    }

    try {
        // Le bloc try/catch englobe toute la logique métier pour une gestion centralisée des erreurs.

        // Étape 4: Parsing du corps de la requête pour extraire les données du formulaire et les définitions de questions.
        const requestBody = parseRequestBody(event.body, headers);
        const formData = requestBody.formData;
        const dynamicQuestions = requestBody.dynamicQuestions;

        // Validation de la présence des données essentielles du formulaire.
        if (!formData) {
            console.error("Erreur: Données du formulaire (formData) manquantes dans la requête.");
            throw { statusCode: 400, headers: headers, body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }) };
        }
        // Avertissement si les questions dynamiques sont manquantes ou mal formatées, car elles sont nécessaires pour certains calculs.
        if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
            console.warn("DEBUG SERVER: dynamicQuestions n'est pas un tableau valide ou est manquant. Certains calculs d'indicateurs et de coûts d'usage pourraient être affectés, mais les données principales seront stockées.");
        }

        // Étape 5: Initialisation de la connexion à Airtable et récupération des noms de tables à partir des variables d'environnement.
        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName } = getAirtableTableNames();

        // Étape 6: Création de l'enregistrement du Fournisseur.
        const supplierId = await createSupplierRecord(base, supplierTableName, formData);

        // Étape 7: Création de l'enregistrement du Produit, lié au Fournisseur nouvellement créé.
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        // Étape 8: Traitement des questions dynamiques : calcul des indicateurs, extraction des masses/durées de vie/prix/énergies annuelles
        // et préparation des réponses individuelles.
        const {
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price,
            productB_Price,
            EnrjUnAnA, // Récupération de la valeur EnrjUnAnA
            EnrjUnAnB, // Récupération de la valeur EnrjUnAnB
            answersToCreateForAnswersTable,
            questionLookupMap
        } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        // Étape 9: Calcul des coûts totaux d'usage pour les produits A et B, en utilisant les valeurs EnrjUnAnA/B.
        const { totalUsageCostA, totalUsageCostB } = calculateTotalUsageCost(formData, questionLookupMap, EnrjUnAnA, EnrjUnAnB);
        console.log('DEBUG SERVER: Coût Total d\'Usage A calculé :', totalUsageCostA);
        console.log('DEBUG SERVER: Coût Total d\'Usage B calculé :', totalUsageCostB);

        // Étape 10: Création par lots des enregistrements de réponses individuelles.
        await batchCreateAnswersRecords(base, answersTableName, answersToCreateForAnswersTable, productId);

        // Étape 11: Création de l'enregistrement final dans la table Score avec toutes les données agrégées.
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

        // Étape 12: Retourne une réponse de succès au client, incluant les IDs des enregistrements créés
        // et les coûts totaux d'usage.
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
        // Étape 13: Gestion centralisée de toutes les erreurs survenues dans le bloc try.
        // Cela inclut les erreurs de parsing, de connexion Airtable, ou d'autres problèmes inattendus.
        console.error('Erreur globale lors de l\'envoi à Airtable ou du traitement de la requête :', error);

        // Définit le code de statut et le message d'erreur appropriés pour la réponse au client.
        const statusCode = error.statusCode || 500; // Utilise le statut d'erreur spécifié ou 500 (Internal Server Error) par défaut.
        const errorMessage = error.body ? JSON.parse(error.body).message : `Erreur serveur inattendue: ${error.message || 'Une erreur inconnue est survenue.'}`;

        return {
            statusCode: statusCode,
            headers: headers,
            body: JSON.stringify({ message: errorMessage }),
        };
    }
};