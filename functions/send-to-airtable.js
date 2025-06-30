// netlify/functions/send-to-airtable.js

const Airtable = require('airtable');
const fetch = require('node-fetch'); // Nécessaire pour les appels à l'API Meta d'Airtable

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
    const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME;
    const bddProductsTableName = process.env.AIRTABLE_BDD_PRODUCTS_TABLE_NAME;

    if (!supplierTableName || !productTableName || !answersTableName || !scoreTableName || !bddProductsTableName) {
        throw new Error("Un ou plusieurs noms de tables Airtable (Supplier, Product, Answers, Score, BDD Products) sont manquants dans les variables d'environnement.");
    }
    return { supplierTableName, productTableName, answersTableName, scoreTableName, bddProductsTableName };
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
 * Traite les réponses dynamiques, calcule les indicateurs de score (EmatA, EapproB, etc.)
 * et collecte toutes les réponses du formulaire pour la table BDD produits.
 * @param {Object} formData - Les données du formulaire soumises par l'utilisateur.
 * @param {Array} dynamicQuestions - Les définitions des questions dynamiques (avec catégorie et coefficient).
 * @returns {Object} Un objet contenant les indicateurs calculés, les masses, les durées de vie, toutes les réponses brutes et les réponses à créer pour la table "Answers".
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
    const answersToCreateForAnswersTable = [];
    const allRelevantFormDataForBddProducts = {};

    // Liste des clés de formData à ignorer pour BDD produits car elles sont gérées ailleurs ou non pertinentes
    const ignoredKeys = [
        'prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur',
        'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit',
        'description_produit', 'timestamp_soumission'
    ];

    // Crée une Map pour un accès rapide aux définitions complètes des questions.
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    // --- DÉBUT DE LA BOUCLE ---
    for (const key in formData) {
        // *** DÉCLARATION ET ASSIGNATION DE QUESTIONDEF ICI ***
        // C'est le premier point où 'questionDef' est défini pour chaque 'key'
        const questionDef = questionLookupMap.get(key);

        let answerValue = formData[key];

        // Gère les réponses multiples (ex: checkboxes)
        if (Array.isArray(answerValue)) {
            answerValue = answerValue.join(', ');
        }

        // Collecte toutes les réponses pertinentes pour la table BDD produits
        // N'ajoute pas les champs Fournisseur/Produit déjà gérés ou non des questions
        if (!ignoredKeys.includes(key)) {
            allRelevantFormDataForBddProducts[key] = answerValue;
        }

        // Récupère les masses
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

        // Récupère les durées de vie
        if (key === 'DureeVieA') {
            productA_DureeVie = parseFloat(answerValue);
            if (isNaN(productA_DureeVie)) {
                console.warn(`DEBUG SERVER: Durée de vie du produit A ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                productA_DureeVie = answerValue;
            }
        }
        if (key === 'DureeVieB') {
            productB_DureeVie = parseFloat(answerValue);
            if (isNaN(productB_DureeVie)) {
                console.warn(`DEBUG SERVER: Durée de vie du produit B ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                productB_DureeVie = answerValue;
            }
        }

        // Calcule et accumule les scores pour les catégories définies.
        // La vérification 'if (questionDef)' est CRUCIALE ici.
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

        // Prépare les données pour l'enregistrement dans la table "Réponses" (liée aux questions par ID)
        // La vérification 'if (questionDef)' est CRUCIALE ici.
        if (questionDef && answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '' && questionDef.id_question) {
            answersToCreateForAnswersTable.push({
                fields: {
                    "ID_produit": [],
                    "ID_questions": [questionDef.id_question],
                    "Réponse": String(answerValue),
                }
            });
        }
    }
    // --- FIN DE LA BOUCLE ---

    // Assurez-vous d'inclure les indicateurs calculés, masses et durées de vie dans allRelevantFormDataForBddProducts
    // pour qu'ils soient aussi créés ou mis à jour dans la table BDD produits.
    Object.assign(allRelevantFormDataForBddProducts, calculatedIndicators);
    if (productA_Mass !== null) allRelevantFormDataForBddProducts["MasseA"] = productA_Mass;
    if (productB_Mass !== null) allRelevantFormDataForBddProducts["MasseB"] = productB_Mass;
    if (productA_DureeVie !== null) allRelevantFormDataForBddProducts["DureeVieA"] = productA_DureeVie;
    if (productB_DureeVie !== null) allRelevantFormDataForBddProducts["DureeVieB"] = productB_DureeVie;

    return {
        calculatedIndicators,
        productA_Mass,
        productB_Mass,
        productA_DureeVie,
        productB_DureeVie,
        answersToCreateForAnswersTable,
        allRelevantFormDataForBddProducts
    };
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

/**
 * Crée l'enregistrement dans la table "Score" avec les indicateurs individuels, les masses et les durées de vie.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table Score.
 * @param {string} productId - L'ID du produit lié.
 * @param {Object} calculatedIndicators - L'objet contenant tous les indicateurs (EmatA, EmatB, etc.).
 * @param {number|string} productA_Mass - La masse du produit A.
 * @param {number|string} productB_Mass - La masse du produit B.
 * @param {number|string} productA_DureeVie - La durée de vie du produit A.
 * @param {number|string} productB_DureeVie - La durée de vie du produit B.
 * @returns {string} L'ID de l'enregistrement Score créé.
 */
async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie) {
    const scoreRecord = await base(tableName).create(
        [{
            fields: {
                "ID_produit": [productId], // Liaison avec l'enregistrement Produit créé.
                ...calculatedIndicators, // Dégage tous les indicateurs (EmatA, EmatB, etc.) dans l'objet fields.
                "MasseA": productA_Mass,
                "MasseB": productB_Mass,
                "DureeVieA": productA_DureeVie,
                "DureeVieB": productB_DureeVie,
            }
        }],
        { typecast: true }
    );
    console.log('Enregistrement Score créé avec ID :', scoreRecord[0].id);
    return scoreRecord[0].id;
}

/**
 * Vérifie l'existence des champs dans la table BDD produits et les crée si nécessaire.
 * Nécessite un jeton Airtable avec la portée `schema.bases:write`.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} bddProductsTableName - Le nom de la table BDD produits.
 * @param {string} baseId - L'ID de la base Airtable.
 * @param {Object} dataForBddProduct - Les données que nous allons insérer, utilisées pour déterminer les champs à créer.
 * @returns {Promise<void>}
 */
async function ensureAirtableFieldsExist(base, bddProductsTableName, baseId, dataForBddProduct) {
    const airtableApiUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
    const apiKey = process.env.AIRTABLE_API_KEY;

    try {
        // 1. Récupérer le schéma de la base pour trouver l'ID de la table BDD produits
        const metaResponse = await fetch(airtableApiUrl, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
        });
        if (!metaResponse.ok) {
            throw new Error(`Erreur lors de la récupération du schéma Airtable: ${metaResponse.statusText}. Code: ${metaResponse.status}`);
        }
        const metaData = await metaResponse.json();
        const bddTable = metaData.tables.find(table => table.name === bddProductsTableName);

        if (!bddTable) {
            console.error(`Table "${bddProductsTableName}" non trouvée dans la base. Impossible de créer des champs.`);
            throw new Error(`Table Airtable "${bddProductsTableName}" introuvable.`);
        }

        const existingFieldNames = new Set(bddTable.fields.map(field => field.name));
        const fieldsToCreate = [];

        // Les champs de liaison ont un type spécial, et Nom du produit est généralement textuel.
        // On les exclut de la création automatique pour éviter des erreurs ou des types incorrects.
        const alwaysPresentFields = ["ID Produit", "Nom du produit"];

        for (const fieldName in dataForBddProduct) {
            if (!existingFieldNames.has(fieldName) && !alwaysPresentFields.includes(fieldName)) {
                // Tente de déterminer le type de champ basé sur la valeur.
                // Attention: C'est une simplification. Pour une robustesse totale, vous auriez besoin
                // d'une configuration plus explicite (e.g., une map en dur des types de champs).
                let fieldType = 'singleLineText'; // Type par défaut si non spécifié ou indéterminable
                const value = dataForBddProduct[fieldName];

                if (typeof value === 'number' || (typeof value === 'string' && value.match(/^-?\d+(\.\d+)?$/) && !isNaN(parseFloat(value)))) {
                    fieldType = 'number';
                } else if (typeof value === 'boolean') {
                    fieldType = 'checkbox';
                }
                // Vous pouvez ajouter d'autres détections de type ici (date, email, url, etc.)

                fieldsToCreate.push({
                    name: fieldName,
                    type: fieldType,
                    // Si 'number', vous pouvez ajouter des options: "options": {"precision": "0.01"}
                });
            }
        }

        if (fieldsToCreate.length > 0) {
            console.log(`DEBUG SERVER: Tentative de création de ${fieldsToCreate.length} nouveaux champs dans la table "${bddProductsTableName}".`);
            const createFieldsUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${bddTable.id}/fields`;
            const createFieldsResponse = await fetch(createFieldsUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fields: fieldsToCreate }),
            });

            const createFieldsResult = await createFieldsResponse.json();

            if (!createFieldsResponse.ok) {
                console.error('Erreur lors de la création des champs Airtable:', createFieldsResult);
                // Ne pas jeter d'erreur ici si on veut que l'enregistrement se poursuive même si la création de champ échoue
                // mais loggez l'erreur pour débogage.
            } else {
                console.log('Champs Airtable créés avec succès ou déjà existants.');
            }
        } else {
            console.log('DEBUG SERVER: Aucun nouveau champ à créer dans la table "${bddProductsTableName}". Tous les champs nécessaires existent.');
        }

    } catch (error) {
        console.error('Erreur dans ensureAirtableFieldsExist :', error.message);
        // On peut choisir de ne pas relancer l'erreur ici pour que l'enregistrement des données ne soit pas bloqué
        // même si la création de champ échoue. C'est un compromis.
    }
}


/**
 * Crée un enregistrement dans la nouvelle table "BDD produits" pour un visuel global.
 * Ce record inclura toutes les réponses pertinentes du formulaire.
 * @param {Object} base - L'instance de la base Airtable.
 * @param {string} tableName - Le nom de la table "BDD produits".
 * @param {string} productId - L'ID du produit lié.
 * @param {Object} formData - Les données brutes du formulaire (pour récupérer nom_produit).
 * @param {Object} allRelevantFormDataForBddProducts - L'objet contenant toutes les questions/réponses pertinentes du formulaire.
 * @returns {string} L'ID de l'enregistrement BDD Produit créé.
 */
async function createBddProductRecord(base, tableName, productId, formData, allRelevantFormDataForBddProducts) {
    const fieldsToCreate = {
        "ID Produit": [productId], // Liaison optionnelle avec la table Produit
        "Nom du produit": formData.nom_produit, // Pour un visuel rapide
        ...allRelevantFormDataForBddProducts // Toutes les réponses dynamiques du formulaire
    };

    const bddProductRecord = await base(tableName).create(
        [{
            fields: fieldsToCreate
        }],
        { typecast: true }
    );
    console.log('Enregistrement BDD Produit créé avec ID :', bddProductRecord[0].id);
    return bddProductRecord[0].id;
}

// --- Fonction de gestionnaire principale Netlify ---

/**
 * Fonction de gestionnaire principale pour les requêtes HTTP entrantes vers ce service Netlify.
 * Elle orchestre le flux complet de traitement d'une soumission de formulaire :
 * validation, parsing, création d'enregistrements dans Airtable (Fournisseur, Produit, Réponses, Score, BDD Produits).
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
            console.warn("dynamicQuestions n'est pas un tableau valide ou est manquant. Cela peut affecter les calculs des indicateurs. Cependant, toutes les données du formulaire seront tout de même envoyées à BDD produits.");
        }

        // 4. Initialiser la connexion à la base Airtable et récupérer les noms de tables configurés.
        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName, bddProductsTableName } = getAirtableTableNames();
        const baseId = process.env.AIRTABLE_BASE_ID; // Récupère l'ID de la base pour l'API Meta

        // 5. Créer l'enregistrement pour le Fournisseur dans Airtable.
        const supplierId = await createSupplierRecord(base, supplierTableName, formData);

        // 6. Créer l'enregistrement pour le Produit dans Airtable et le lier au Fournisseur.
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        // 7. Traiter les questions dynamiques et collecter toutes les réponses.
        const { calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, answersToCreateForAnswersTable, allRelevantFormDataForBddProducts } =
            processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        // 8. Avant de créer l'enregistrement, assurez-vous que tous les champs nécessaires existent dans la table BDD produits.
        await ensureAirtableFieldsExist(base, bddProductsTableName, baseId, allRelevantFormDataForBddProducts);

        // 9. Créer les enregistrements de Réponses par lots dans Airtable.
        await batchCreateAnswersRecords(base, answersTableName, answersToCreateForAnswersTable, productId);

        // 10. Créer l'enregistrement dans la table "Score" avec les indicateurs individuels, les masses et les durées de vie.
        const scoreId = await createScoreRecord(base, scoreTableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie);

        // 11. Créer l'enregistrement dans la nouvelle table "BDD produits" avec TOUTES les réponses du formulaire.
        const bddProductId = await createBddProductRecord(base, bddProductsTableName, productId, formData, allRelevantFormDataForBddProducts);

        // 12. Retourner une réponse de succès au client.
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses, Score, BDD produits) envoyées avec succès !',
                supplierId: supplierId,
                productId: productId,
                scoreId: scoreId,
                bddProductId: bddProductId,
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