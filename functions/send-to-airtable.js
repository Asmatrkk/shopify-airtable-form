// netlify/functions/send-to-airtable.js

const Airtable = require('airtable');
const fetch = require('node-fetch');

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // à remplacer par le domaine Lowreka
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
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
        return {
            statusCode: 405,
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' }),
        };
    }
    if (!event.body) {
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
        return JSON.parse(body);
    } catch (error) {
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
        throw new Error("Erreur de configuration: Impossible de se connecter à Airtable. Contacter l'administrateur.");
    }
    return new Airtable({ apiKey }).base(baseId);
}

function getAirtableTableNames() {
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;
    const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME;
    if (!supplierTableName || !productTableName || !answersTableName || !scoreTableName) {
        throw new Error("Erreur de configuration: Noms de tables Airtable manquants.");
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

    let productA_Mass = null, productB_Mass = null;
    let productA_DureeVie = null, productB_DureeVie = null;
    let productA_Price = null, productB_Price = null;
    let EnrjUnAnA = null, EnrjUnAnB = null;
    let eauUnAnA = null, eauUnAnB = null;

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

        if (key === 'MasseA') productA_Mass = parseFloat(answerValue);
        if (key === 'MasseB') productB_Mass = parseFloat(answerValue);
        if (key === 'DureeVieA') productA_DureeVie = parseFloat(answerValue);
        if (key === 'DureeVieB') productB_DureeVie = parseFloat(answerValue);
        if (key === 'PrixA') productA_Price = parseFloat(answerValue);
        if (key === 'PrixB') productB_Price = parseFloat(answerValue);
        if (key === 'EnrjUnAnA') EnrjUnAnA = parseFloat(answerValue);
        if (key === 'EnrjUnAnB') EnrjUnAnB = parseFloat(answerValue);
        if (key === 'eauUnAnA') eauUnAnA = parseFloat(answerValue);
        if (key === 'eauUnAnB') eauUnAnB = parseFloat(answerValue);

        if (questionDef && calculatedIndicators.hasOwnProperty(questionDef.categorie_questions)) {
            const numericAnswer = parseFloat(answerValue);
            const coefficient = parseFloat(questionDef.coeff_questions);
            if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                calculatedIndicators[questionDef.categorie_questions] += numericAnswer * coefficient;
            }
        }

        if (questionDef && questionDef.id_question && String(answerValue).trim() !== '') {
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
        productA_Mass, productB_Mass,
        productA_DureeVie, productB_DureeVie,
        productA_Price, productB_Price,
        EnrjUnAnA, EnrjUnAnB,
        eauUnAnA, eauUnAnB,
        answersToCreateForAnswersTable,
        questionLookupMap
    };
}

function calculateTotalUsageCost(formData, questionLookupMap, EnrjUnAnA, EnrjUnAnB) {
    let totalUsageCostA = 0, totalUsageCostB = 0;

    for (const [key, questionDef] of questionLookupMap.entries()) {
        if (questionDef.categorie_questions === 'EnrjA' || questionDef.categorie_questions === 'EnrjB') {
            const answerValue = parseFloat(formData[key]);
            const energyPrice = parseFloat(questionDef.PrixEnrj);
            if (!isNaN(answerValue) && !isNaN(energyPrice)) {
                const cost = answerValue * energyPrice;
                if (key.endsWith('A')) totalUsageCostA += cost;
                else if (key.endsWith('B')) totalUsageCostB += cost;
            }
        }
    }

    ['eauUnAnA', 'eauUnAnB'].forEach(waterKey => {
        const questionDef = questionLookupMap.get(waterKey);
        if (questionDef) {
            const answerValue = parseFloat(formData[waterKey]);
            const waterPrice = parseFloat(questionDef.PrixEnrj);
            if (!isNaN(answerValue) && !isNaN(waterPrice)) {
                let waterCost = answerValue * waterPrice;
                if (waterKey === 'eauUnAnA' && !isNaN(EnrjUnAnA)) {
                    waterCost *= EnrjUnAnA;
                    totalUsageCostA *= EnrjUnAnA;
                    totalUsageCostA += waterCost;
                } else if (waterKey === 'eauUnAnB' && !isNaN(EnrjUnAnB)) {
                    waterCost *= EnrjUnAnB;
                    totalUsageCostB *= EnrjUnAnB;
                    totalUsageCostB += waterCost;
                } else {
                    if (waterKey === 'eauUnAnA') totalUsageCostA += waterCost;
                    if (waterKey === 'eauUnAnB') totalUsageCostB += waterCost;
                }
            }
        }
    });

    return { totalUsageCostA, totalUsageCostB };
}

async function batchCreateAnswersRecords(base, tableName, answersToCreate, productId) {
    if (answersToCreate.length === 0) return;
    const batchSize = 10;
    for (let i = 0; i < answersToCreate.length; i += batchSize) {
        const batch = answersToCreate.slice(i, i + batchSize);
        batch.forEach(record => {
            record.fields["ID_produit"] = [productId];
        });
        await base(tableName).create(batch, { typecast: true });
    }
}

async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, totalUsageCostA, totalUsageCostB, EnrjUnAnA, EnrjUnAnB, eauUnAnA, eauUnAnB) {
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
        "EnrjUnAnA": EnrjUnAnA,
        "EnrjUnAnB": EnrjUnAnB,
        "eauUnAnA": eauUnAnA,
        "eauUnAnB": eauUnAnB,
    };
    const scoreRecord = await base(tableName).create([{ fields: fieldsToSend }], { typecast: true });
    return scoreRecord[0].id;
}

exports.handler = async (event) => {
    const headers = getCorsHeaders();
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) return optionsResponse;

    const validationError = validatePostRequest(event, headers);
    if (validationError) return validationError;

    try {
        const requestBody = parseRequestBody(event.body, headers);
        const formData = requestBody.formData;
        const dynamicQuestions = requestBody.dynamicQuestions;

        if (!formData) {
            throw { statusCode: 400, headers, body: JSON.stringify({ message: 'Données du formulaire manquantes.' }) };
        }

        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName } = getAirtableTableNames();

        const supplierId = await createSupplierRecord(base, supplierTableName, formData);
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        const {
            calculatedIndicators,
            productA_Mass, productB_Mass,
            productA_DureeVie, productB_DureeVie,
            productA_Price, productB_Price,
            EnrjUnAnA, EnrjUnAnB,
            answersToCreateForAnswersTable,
            questionLookupMap,
            eauUnAnA, eauUnAnB
        } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        const { totalUsageCostA, totalUsageCostB } = calculateTotalUsageCost(formData, questionLookupMap, EnrjUnAnA, EnrjUnAnB);

        await batchCreateAnswersRecords(base, answersTableName, answersToCreateForAnswersTable, productId);

        const scoreId = await createScoreRecord(
            base, scoreTableName, productId,
            calculatedIndicators,
            productA_Mass, productB_Mass,
            productA_DureeVie, productB_DureeVie,
            productA_Price, productB_Price,
            totalUsageCostA, totalUsageCostB,
            EnrjUnAnA, EnrjUnAnB,
            eauUnAnA, eauUnAnB
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Données enregistrées avec succès.',
                supplierId,
                productId,
                scoreId,
                totalUsageCostA,
                totalUsageCostB
            }),
        };
    } catch (error) {
        const statusCode = error.statusCode || 500;
        const message = error.body ? JSON.parse(error.body).message : `Erreur: ${error.message}`;
        return { statusCode, headers, body: JSON.stringify({ message }) };
    }
};
