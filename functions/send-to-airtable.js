const Airtable = require('airtable');
const fetch = require('node-fetch');

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function handleOptionsRequest(event, headers) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }
    return null;
}

function validatePostRequest(event, headers) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ message: 'Seules les requêtes POST sont acceptées.' }),
        };
    }
    if (!event.body) {
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
    } catch {
        throw {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Le corps n\'est pas un JSON valide.' }),
        };
    }
}

function initializeAirtableBase() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) {
        throw new Error("Clé API ou ID de base Airtable manquant.");
    }
    return new Airtable({ apiKey }).base(baseId);
}

function getAirtableTableNames() {
    return {
        supplierTableName: process.env.AIRTABLE_SUPPLIER_TABLE_NAME,
        productTableName: process.env.AIRTABLE_PRODUCT_TABLE_NAME,
        answersTableName: process.env.AIRTABLE_ANSWERS_TABLE_NAME,
        scoreTableName: process.env.AIRTABLE_SCORE_TABLE_NAME,
        bddProductsTableName: process.env.AIRTABLE_BDD_PRODUCTS_TABLE_NAME,
    };
}

async function createSupplierRecord(base, tableName, formData) {
    const rec = await base(tableName).create([{ fields: {
        "prenom_fournisseur": formData.prenom_fournisseur,
        "nom_fournisseur": formData.nom_fournisseur,
        "email_fournisseur": formData.email_fournisseur,
        "entreprise_fournisseur": formData.entreprise_fournisseur,
        "siret_fournisseur": formData.siret_fournisseur,
    }}], { typecast: true });
    return rec[0].id;
}

async function createProductRecord(base, tableName, formData, supplierId) {
    const rec = await base(tableName).create([{ fields: {
        "nom_produit": formData.nom_produit,
        "description_produit": formData.description_produit,
        "ID_fournisseur": [supplierId],
    }}], { typecast: true });
    return rec[0].id;
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
    let productA_Mass = null, productB_Mass = null,
        productA_DureeVie = null, productB_DureeVie = null,
        productA_Price = null, productB_Price = null,
        EnrjUnAnA = null, EnrjUnAnB = null,
        eauUnAnA = null, eauUnAnB = null;

    const answersToCreate = [];
    const questionLookupMap = new Map();
    if (Array.isArray(dynamicQuestions)) {
        dynamicQuestions.forEach(q => {
            if (q.indicateur_questions) {
                questionLookupMap.set(q.indicateur_questions, q);
            }
        });
    }

    console.log('🔵 DEBUG - Clés présentes dans formData:', Object.keys(formData));

    for (const key in formData) {
        const q = questionLookupMap.get(key);
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

        if (q && calculatedIndicators.hasOwnProperty(q.categorie_questions)) {
            const num = parseFloat(val);
            const coef = parseFloat(q.coeff_questions);
            if (!isNaN(num) && !isNaN(coef)) {
                calculatedIndicators[q.categorie_questions] += num * coef;
            }
        }
        if (q && q.id_question && val !== undefined && val !== null && String(val).trim() !== '') {
            answersToCreate.push({ fields: {
                "ID_questions": [q.id_question],
                "Réponse": String(val),
            }});
        }
    }

    return {
        calculatedIndicators,
        productA_Mass, productB_Mass,
        productA_DureeVie, productB_DureeVie,
        productA_Price, productB_Price,
        EnrjUnAnA, EnrjUnAnB,
        answersToCreate,
        questionLookupMap,
        eauUnAnA, eauUnAnB,
    };
}

async function batchCreateAnswersRecords(base, tableName, answers, productId) {
    if (!answers.length) return;
    const batchSize = 10;
    for (let i = 0; i < answers.length; i += batchSize) {
        const batch = answers.slice(i, i + batchSize);
        batch.forEach(r => { r.fields["ID_produit"] = [productId]; });
        await base(tableName).create(batch, { typecast: true });
    }
}

async function createBDDProductsRecord(base, tableName, questionLookupMap, formData, productId) {
    const fieldsPerIndicator = {};

    for (const [key, questionDef] of questionLookupMap.entries()) {
        const value = formData[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            // Sauter si c'est le champ nom_produit (pour éviter l'erreur)
            if (questionDef.indicateur_questions === 'nom_produit') {
                console.log(`DEBUG BDD PRODUITS: Champ "${key}" ignoré car il correspond à un champ calculé.`);
                continue;
            }
            fieldsPerIndicator[questionDef.indicateur_questions] = String(value);
            console.log(`DEBUG BDD PRODUITS: Champ ajouté "${questionDef.indicateur_questions}" = "${value}"`);
        } else {
            console.log(`DEBUG BDD PRODUITS: Champ ignoré "${key}" car vide ou invalide.`);
        }
    }

    const fieldsToSend = {
        "ID_produit": [productId],
        ...fieldsPerIndicator
    };

    const record = await base(tableName).create([{ fields: fieldsToSend }], { typecast: true });
    console.log(`INFO: Enregistrement BDD Produits créé avec ID : ${record[0].id}`);
    return record[0].id;
}


async function createScoreRecord(base, tableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, EnrjUnAnA, EnrjUnAnB, eauUnAnA, eauUnAnB) {
    const rec = await base(tableName).create([{
        fields: {
            "ID_produit": [productId],
            ...calculatedIndicators,
            "MasseA": productA_Mass,
            "MasseB": productB_Mass,
            "DureeVieA": productA_DureeVie,
            "DureeVieB": productB_DureeVie,
            "PrixA": productA_Price,
            "PrixB": productB_Price,
            "EnrjUnAnA": EnrjUnAnA,
            "EnrjUnAnB": EnrjUnAnB,
            "eauUnAnA": eauUnAnA,
            "eauUnAnB": eauUnAnB,
        }
    }], { typecast: true });
    return rec[0].id;
}

exports.handler = async (event) => {
    const headers = getCorsHeaders();
    const optionsResponse = handleOptionsRequest(event, headers);
    if (optionsResponse) return optionsResponse;

    const validationError = validatePostRequest(event, headers);
    if (validationError) return validationError;

    try {
        const { formData, dynamicQuestions } = parseRequestBody(event.body, headers);
        if (!formData) throw { statusCode: 400, headers, body: JSON.stringify({ message: 'Données du formulaire manquantes.' }) };

        const base = initializeAirtableBase();
        const { supplierTableName, productTableName, answersTableName, scoreTableName, bddProductsTableName } = getAirtableTableNames();

        const supplierId = await createSupplierRecord(base, supplierTableName, formData);
        const productId = await createProductRecord(base, productTableName, formData, supplierId);

        const { calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, EnrjUnAnA, EnrjUnAnB, answersToCreate, questionLookupMap, eauUnAnA, eauUnAnB } = processDynamicQuestionsAndCollectAllAnswers(formData, dynamicQuestions);

        await batchCreateAnswersRecords(base, answersTableName, answersToCreate, productId);
        await createBDDProductsRecord(base, bddProductsTableName, questionLookupMap, formData, productId, formData.nom_produit);
        const scoreId = await createScoreRecord(base, scoreTableName, productId, calculatedIndicators, productA_Mass, productB_Mass, productA_DureeVie, productB_DureeVie, productA_Price, productB_Price, EnrjUnAnA, EnrjUnAnB, eauUnAnA, eauUnAnB);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Tout a été traité et enregistré.',
                supplierId,
                productId,
                scoreId
            }),
        };
    } catch (err) {
        console.error('❌ Erreur globale:', err);
        return {
            statusCode: err.statusCode || 500,
            headers,
            body: JSON.stringify({ message: err.body ? JSON.parse(err.body).message : err.message }),
        };
    }
};
