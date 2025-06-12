const Airtable = require('airtable');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // REMPLACEZ PAR VOTRE DOMAINE SHOPIFY
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: headers,
            body: '',
        };
    }

    if (event.httpMethod !== 'POST' || !event.body) {
        return {
            statusCode: 405,
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée ou corps manquant.' }),
        };
    }

    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
    } catch (error) {
        console.error('Erreur de parsing JSON:', error);
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Corps de la requête invalide.' }),
        };
    }

    const formData = requestBody.formData;
    const dynamicQuestions = requestBody.dynamicQuestions;

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;

    try {
        // 1. Créer l'enregistrement Fournisseur
        const supplierRecord = await base(supplierTableName).create(
            {
                "prenom_fournisseur": formData.prenom_fournisseur,
                "nom_fournisseur": formData.nom_fournisseur,
                "email_fournisseur": formData.email_fournisseur,
                "entreprise_fournisseur": formData.entreprise_fournisseur,
                "siret_fournisseur": formData.siret_fournisseur,
            },
            { typecast: true }
        );
        console.log('Enregistrement Fournisseur créé:', supplierRecord.id);

        // 2. Créer l'enregistrement Produit, en le liant au Fournisseur
        const productRecord = await base(productTableName).create(
            {
                "nom_produit": formData.nom_produit,
                "description_produit": formData.description_produit,
                "ID_fournisseur": [supplierRecord.id]
            },
            { typecast: true }
        );
        console.log('Enregistrement Produit créé:', productRecord.id);

        // 3. Traiter et enregistrer les réponses aux questions dynamiques
        const answersToCreate = [];
        const questionIdLookupMap = new Map();
        dynamicQuestions.forEach(q => {
            questionIdLookupMap.set(q.indicateur_questions, q.id_question);
        });

        for (const key in formData) {
            if (['prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur', 'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit', 'description_produit'].includes(key)) {
                continue;
            }

            const questionId = questionIdLookupMap.get(key);
            if (questionId) {
                let answerValue = formData[key];

                if (Array.isArray(answerValue)) {
                    answerValue = answerValue.join(', ');
                }

                if (answerValue !== undefined && answerValue !== null && answerValue !== '') {
                    answersToCreate.push({
                        "ID_produit": [productRecord.id],  // Champ renommé
                        "ID_questions": [questionId],       // Champ renommé
                        "Réponse": String(answerValue)
                        // "Fournisseur (Link)" a été supprimé ici
                    });
                }
            } else {
                console.warn(`Aucune correspondance d'ID_question trouvée pour l'indicateur: ${key}. Réponse non enregistrée dans la table Réponses.`);
            }
        }

        if (answersToCreate.length > 0) {
            const batchSize = 10;
            for (let i = 0; i < answersToCreate.length; i += batchSize) {
                const batch = answersToCreate.slice(i, i + batchSize);
                await base(answersTableName).create(batch, { typecast: true });
            }
            console.log(`${answersToCreate.length} réponses dynamiques créées.`);
        }

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses) envoyées avec succès !',
                supplierId: supplierRecord.id,
                productId: productRecord.id,
            }),
        };

    } catch (error) {
        console.error('Erreur lors de l\'envoi à Airtable:', error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: `Erreur lors de l'envoi à Airtable: ${error.message}` }),
        };
    }
};