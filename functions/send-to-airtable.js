// netlify/functions/send-to-airtable.js

const Airtable = require('airtable');
const fetch = require('node-fetch');

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // ⚠️ A remplacer par le domaine Lowreka
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        console.log('DEBUG SERVER: Requête OPTIONS reçue.');
        return {
            statusCode: 204,
            headers,
            body: '',
        };
    }
    return null;
}

function validatePostRequest(event, headers) {
    if (event.httpMethod !== 'POST') {
        console.error(`Erreur: Méthode non autorisée (${event.httpMethod})`);
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ message: 'Méthode non autorisée. Seules les requêtes POST sont acceptées.' }),
        };
    }
    if (!event.body) {
        console.error('Erreur: Corps de requête manquant.');
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Corps de requête manquant.' }),
        };
    }
    return null;
}

function parseRequestBody(body, headers) {
    try {
        return JSON.parse(body);
    } catch (error) {
        console.error('Erreur de parsing JSON :', error.message);
        throw {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Le corps de la requête n\'est pas un JSON valide.' }),
        };
    }
}

function initializeAirtableBase() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) {
        throw new Error('Clé API Airtable ou ID de base manquant.');
    }
    return new Airtable({ apiKey }).base(baseId);
}

function getAirtableTableNames() {
    const supplier = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const product = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answers = process.env.AIRTABLE_ANSWERS_TABLE_NAME;
    const score = process.env.AIRTABLE_SCORE_TABLE_NAME;
    if (!supplier || !product || !answers || !score) {
        throw new Error('Un ou plusieurs noms de tables Airtable manquants.');
    }
    return { supplier, product, answers, score };
}

async function createSupplierRecord(base, tableName, formData) {
    const rec = await base(tableName).create([{
        fields: {
            "prenom_fournisseur": formData.prenom_fournisseur,
            "nom_fournisseur": formData.nom_fournisseur,
            "email_fournisseur": formData.email_fournisseur,
            "entreprise_fournisseur": formData.entreprise_fournisseur,
            "siret_fournisseur": formData.siret_fournisseur,
        },
    }], { typecast: true });
    return rec[0].id;
}

async function createProductRecord(base, tableName, formData, supplierId) {
    const rec = await base(tableName).create([{
        fields: {
            "nom_produit": formData.nom_produit,
            "description_produit": formData.description_produit,
            "ID_fournisseur": [supplierId],
        },
    }], { typecast: true });
    return rec[0].id;
}

/**
 * Nouveau: calcul séparé des émissions
 */
function calculateEmissionsByLifecycleStage(formData, questionLookupMap) {
    const emissions = {
        EmatA: 0, EmatB: 0,
        EapproA: 0, EapproB: 0,
        EfabA: 0, EfabB: 0,
        EdistribA: 0, EdistribB: 0,
        EnrjA: 0, EnrjB: 0,
        EeauA: 0, EeauB: 0,
        EfdvA: 0, EfdvB: 0,
    };

    for (const [key, def] of questionLookupMap.entries()) {
        if (def && emissions.hasOwnProperty(def.categorie_questions)) {
            const n = parseFloat(formData[key]);
            const c = parseFloat(def.coeff_questions);
            if (!isNaN(n) && !isNaN(c)) {
                emissions[def.categorie_questions] += n * c;
            }
        }
    }
    return emissions;
}

/**
 * Traitement des questions dynamiques et extraction des données
 */
function processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions) {
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    const calculatedIndicators = calculateEmissionsByLifecycleStage(formData, questionLookupMap);

    let productA_Mass = null, productB_Mass = null;
    let productA_DureeVie = null, productB_DureeVie = null;
    let productA_Price = null, productB_Price = null;
    let EnrjUnAnA = null, EnrjUnAnB = null, eauUnAnA = null, eauUnAnB = null;

    const answers = [];

    for (const key in formData) {
        const def = questionLookupMap.get(key);
        let val = formData[key];
        if (Array.isArray(val)) val = val.join(', ');

        if (key === 'MasseA') productA_Mass = parseFloat(val);
        if (key === 'MasseB') productB_Mass = parseFloat(val);
        if (key === 'DureeVieA') productA_DureeVie = parseFloat(val);
        if (key === 'DureeVieB') productB_DureeVie = parseFloat(val);
        if (key === 'PrixA') productA_Price = parseFloat(val);
        if (key === 'PrixB') productB_Price = parseFloat(val);
        if (key === 'EnrjUnAnA') EnrjUnAnA = parseFloat(val);
        if (key === 'EnrjUnAnB') EnrjUnAnB = parseFloat(val);
        if (key === 'eauUnAnA') eauUnAnA = parseFloat(val);
        if (key === 'eauUnAnB') eauUnAnB = parseFloat(val);

        if (def && def.id_question && String(val).trim() !== '') {
            answers.push({
                fields: {
                    "ID_questions": [def.id_question],
                    "Réponse": String(val),
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
        EnrjUnAnA,
        EnrjUnAnB,
        answersToCreateForAnswersTable: answers,
        questionLookupMap,
        eauUnAnA,
        eauUnAnB,
    };
}

// (Pas modifié) calculateTotalUsageCost, batchCreateAnswersRecords, createScoreRecord restent identiques

exports.handler = async (event) => {
    const headers = getCorsHeaders();
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) return optionsResponse;

    const validationError = validatePostRequest(event, headers);
    if (validationError) return validationError;

    try {
        const requestBody = parseRequestBody(event.body, headers);
        const { formData, dynamicQuestions } = requestBody;

        if (!formData) throw { statusCode: 400, headers, body: JSON.stringify({ message: 'formData manquant.' }) };

        const base = initializeAirtableBase();
        const { supplier, product, answers, score } = getAirtableTableNames();

        const supplierId = await createSupplierRecord(base, supplier, formData);
        const productId = await createProductRecord(base, product, formData, supplierId);

        const {
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price,
            productB_Price,
            EnrjUnAnA,
            EnrjUnAnB,
            answersToCreateForAnswersTable,
            questionLookupMap,
            eauUnAnA,
            eauUnAnB,
        } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        const { totalUsageCostA, totalUsageCostB } = calculateTotalUsageCost(formData, questionLookupMap, EnrjUnAnA, EnrjUnAnB);

        await batchCreateAnswersRecords(base, answers, answersToCreateForAnswersTable, productId);

        const scoreId = await createScoreRecord(
            base,
            score,
            productId,
            calculatedIndicators,
            productA_Mass,
            productB_Mass,
            productA_DureeVie,
            productB_DureeVie,
            productA_Price,
            productB_Price,
            totalUsageCostA,
            totalUsageCostB,
            EnrjUnAnA,
            EnrjUnAnB,
            eauUnAnA,
            eauUnAnB
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Enregistrement réussi.',
                supplierId,
                productId,
                scoreId,
                totalUsageCostA,
                totalUsageCostB,
            }),
        };
    } catch (error) {
        console.error('Erreur globale :', error);
        const statusCode = error.statusCode || 500;
        const message = error.body ? JSON.parse(error.body).message : error.message || 'Erreur inconnue.';
        return {
            statusCode,
            headers,
            body: JSON.stringify({ message }),
        };
    }
};
