const Airtable = require('airtable');
const fetch = require('node-fetch');

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        console.log('DEBUG SERVER: Requête OPTIONS reçue. Envoi de la réponse 204.');
        return {
            statusCode: 204,
            headers: headers,
            body: '',
        };
    }
    return null;
}

function validatePostRequest(event, headers) {
    if (event.httpMethod !== 'POST') {
        console.error(`Erreur: Méthode non autorisée. Méthode reçue: ${event.httpMethod}`);
        return {
            statusCode: 405,
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' }),
        };
    }
    if (!event.body) {
        console.error('Erreur: Corps de requête manquant pour une requête POST.');
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Corps de requête manquant. Veuillez envoyer un JSON.' }),
        };
    }
    return null;
}

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

function initializeAirtableBase() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
        console.error("Erreur de configuration: Clé API Airtable ou ID de base manquant(e) dans les variables d'environnement.");
        throw new Error("Erreur de configuration: Impossible de se connecter à Airtable. Contacter l'administrateur.");
    }
    return new Airtable({ apiKey: apiKey }).base(baseId);
}

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
        { typecast: true }
    );
    console.log('INFO: Enregistrement Fournisseur créé avec ID :', supplierRecord[0].id);
    return supplierRecord[0].id;
}

async function createProductRecord(base, tableName, formData, supplierId) {
    const productRecord = await base(tableName).create(
        [{
            fields: {
                "nom_produit": formData.nom_produit,
                "description_produit": formData.description_produit,
                "ID_fournisseur": [supplierId],
            },
        }],
        { typecast: true }
    );
    console.log('INFO: Enregistrement Produit créé avec ID :', productRecord[0].id);
    return productRecord[0].id;
}

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

    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    for (const key in formData) {
        const questionDef = questionLookupMap.get(key);
        let answerValue = formData[key];

        if (Array.isArray(answerValue)) {
            answerValue = answerValue.join(', ');
        }

        if (key === 'MasseA') {
            productA_Mass = parseFloat(answerValue);
            if (isNaN(productA_Mass)) console.warn(`DEBUG SERVER: Masse du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'MasseB') {
            productB_Mass = parseFloat(answerValue);
            if (isNaN(productB_Mass)) console.warn(`DEBUG SERVER: Masse du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        if (key === 'DureeVieA') {
            productA_DureeVie = parseFloat(answerValue);
            if (isNaN(productA_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'DureeVieB') {
            productB_DureeVie = parseFloat(answerValue);
            if (isNaN(productB_DureeVie)) console.warn(`DEBUG SERVER: Durée de vie du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

        if (key === 'PrixA') {
            productA_Price = parseFloat(answerValue);
            if (isNaN(productA_Price)) console.warn(`DEBUG SERVER: Prix du produit A ("${answerValue}") n'est pas un nombre valide.`);
        }
        if (key === 'PrixB') {
            productB_Price = parseFloat(answerValue);
            if (isNaN(productB_Price)) console.warn(`DEBUG SERVER: Prix du produit B ("${answerValue}") n'est pas un nombre valide.`);
        }

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

        if (questionDef && questionDef.id_question && answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '') {
            answersToCreateForAnswersTable.push({
                fields: {
                    "ID_questions": [questionDef.id_question],
                    "Réponse": String(answerValue),
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
        productA_Price,
        productB_Price,
        answersToCreateForAnswersTable,
        questionLookupMap,
    };
}

function calculateTotalUsageCost(formData, questionLookupMap) {
    let totalUsageCostA = 0;
    let totalUsageCostB = 0;

    for (const [key, questionDef] of questionLookupMap.entries()) {
        if (questionDef.categorie_questions === 'Enrj') {
            const answerValue = parseFloat(formData[key]);
            const energyPrice = parseFloat(questionDef.PrixEnrj);

            if (!isNaN(answerValue) && !isNaN(energyPrice)) {
                const cost = answerValue * energyPrice;
                if (key.endsWith('A')) {
                    totalUsageCostA += cost;
                } else if (key.endsWith('B')) {
                    totalUsageCostB += cost;
                }
            } else {
                console.warn(`DEBUG SERVER: Valeur de réponse (${formData[key]}) ou PrixEnrj (${questionDef.PrixEnrj}) invalide pour question d'énergie '${questionDef.titre}' (${key}). N'a pas contribué au coût d'usage.`);
            }
        }
    }

    const waterQuestionsKeys = ['eauUnAnA', 'eauUnAnB'];

    waterQuestionsKeys.forEach(waterQKey => {
        const questionDef = questionLookupMap.get(waterQKey);
        if (questionDef) {
            const answerValue = parseFloat(formData[waterQKey]);
            const waterPrice = parseFloat(questionDef.PrixEnrj);

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

async function batchCreateAnswersRecords(base, tableName, answersToCreate, productId) {
    if (answersToCreate.length === 0) {
        console.log('DEBUG SERVER: Aucune réponse dynamique à créer dans la table Réponses.');
        return;
    }

    console.log(`DEBUG SERVER: Tentative de création de ${answersToCreate.length} réponses dans la table Réponses.`);
    const batchSize = 10;

    for (let i = 0; i < answersToCreate.length; i += batchSize) {
        const batch = answersToCreate.slice(i, i + batchSize);
        batch.forEach(record => {
            record.fields["ID_produit"] = [productId];
        });
        await base(tableName).create(batch, { typecast: true });
    }
    console.log(`INFO: ${answersToCreate.length} réponses dynamiques créées dans la table Réponses.`);
}

async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, totalUsageCostA, totalUsageCostB) {
    const fieldsToSend = {
        "ID_produit": [productId],
        ...calculatedIndicators,
        "MasseA": productA_Mass,
        "MasseB": productB_Mass,
        "DureeVieA": productA_DureeVie,
        "DureeVieB": productB_DureeVie,
        "PrixA": productA_Price,
        "PrixB": productB_Price,
        "CoutTotalUsageA": totalUsageCostA,
        "CoutTotalUsageB": totalUsageCostB,
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

exports.handler = async (event) => {
    const headers = getCorsHeaders();

    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) {
        return optionsResponse;
    }

    const validationError = validatePostRequest(event, headers);
    if (validationError) {
        return validationError;
    }

    try {
        const requestBody = parseRequestBody(event.body, headers);
        const formData = requestBody.formData;
        const dynamicQuestions = requestBody.dynamicQuestions;

        if (!formData) {
            console.error("Erreur: Données du formulaire (formData) manquantes dans la requête.");
            throw { statusCode: 400, headers: headers, body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }) };
        }
        if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
            console.warn("DEBUG SERVER: dynamicQuestions n'est pas un tableau valide ou est manquant. Certains calculs d'indicateurs et de coûts d'usage pourraient être affectés, mais les données principales seront stockées.");
        }

        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName } = getAirtableTableNames();

        const supplierId = await createSupplierRecord(base, supplierTableName, formData);

        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        const {
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price,
            productB_Price,
            answersToCreateForAnswersTable,
            questionLookupMap
        } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        const { totalUsageCostA, totalUsageCostB } = calculateTotalUsageCost(formData, questionLookupMap);
        console.log('DEBUG SERVER: Coût Total d\'Usage A calculé :', totalUsageCostA);
        console.log('DEBUG SERVER: Coût Total d\'Usage B calculé :', totalUsageCostB);

        await batchCreateAnswersRecords(base, answersTableName, answersToCreateForAnswersTable, productId);

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