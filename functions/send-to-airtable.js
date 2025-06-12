const Airtable = require('airtable');

exports.handler = async (event) => {
    // En-têtes CORS pour permettre l'accès depuis votre domaine Shopify
    const headers = {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // REMPLACEZ PAR VOTRE DOMAINE SHOPIFY
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Gérer les requêtes OPTIONS (pré-vérification CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: headers,
            body: '', // Le corps doit être vide pour une réponse OPTIONS 204
        };
    }

    // Vérifier la méthode HTTP et le corps pour les requêtes POST
    if (event.httpMethod !== 'POST' || !event.body) {
        return {
            statusCode: 405, // Méthode non autorisée
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée ou corps manquant.' }),
        };
    }

    let requestBody;
    try {
        // Le corps de la requête contient formData (vos réponses) et dynamicQuestions (définitions des questions)
        requestBody = JSON.parse(event.body);
    } catch (error) {
        console.error('Erreur de parsing JSON:', error);
        return {
            statusCode: 400, // Requête invalide
            headers: headers,
            body: JSON.stringify({ message: 'Corps de la requête invalide.' }),
        };
    }

    const formData = requestBody.formData; // Les données collectées du formulaire
    const dynamicQuestions = requestBody.dynamicQuestions; // Les définitions des questions dynamiques

    // Initialisation de la base Airtable
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Noms des tables Airtable (récupérés des variables d'environnement)
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;

    try {
        // 1. Créer l'enregistrement Fournisseur
        const supplierRecord = await base(supplierTableName).create(
            [
                {
                    // Chaque enregistrement doit être enveloppé dans un objet 'fields'
                    fields: {
                        "prenom_fournisseur": formData.prenom_fournisseur,
                        "nom_fournisseur": formData.nom_fournisseur,
                        "email_fournisseur": formData.email_fournisseur,
                        "entreprise_fournisseur": formData.entreprise_fournisseur,
                        "siret_fournisseur": formData.siret_fournisseur,
                    }
                }
            ],
            { typecast: true } // Permet à Airtable de convertir les types de données si nécessaire
        );
        console.log('Enregistrement Fournisseur créé:', supplierRecord[0].id); // [0] car create renvoie un tableau

        // 2. Créer l'enregistrement Produit, en le liant au Fournisseur
        const productRecord = await base(productTableName).create(
            [
                {
                    // Chaque enregistrement doit être enveloppé dans un objet 'fields'
                    fields: {
                        "nom_produit": formData.nom_produit,
                        "description_produit": formData.description_produit,
                        // Le champ de lien doit être un tableau d'ID d'enregistrement
                        "ID_fournisseur": [supplierRecord[0].id]
                    }
                }
            ],
            { typecast: true }
        );
        console.log('Enregistrement Produit créé:', productRecord[0].id); // [0] car create renvoie un tableau

        // 3. Traiter et enregistrer les réponses aux questions dynamiques
        const answersToCreate = [];
        // Créer une map pour un accès rapide aux ID de question par 'indicateur_questions' (le 'name' du champ HTML)
        const questionIdLookupMap = new Map();
        dynamicQuestions.forEach(q => {
            questionIdLookupMap.set(q.indicateur_questions, q.id_question);
        });

        // Parcourir toutes les données soumises par le formulaire
        for (const key in formData) {
            // Ignorer les champs fixes déjà traités (Fournisseur et Produit)
            if ([
                'prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur',
                'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit',
                'description_produit'
            ].includes(key)) {
                continue;
            }

            // Tenter de trouver l'ID de la question correspondante
            const questionId = questionIdLookupMap.get(key);
            if (questionId) {
                let answerValue = formData[key];

                // Gérer les réponses multiples (comme les checkboxes) qui arrivent en tant que tableau
                if (Array.isArray(answerValue)) {
                    answerValue = answerValue.join(', '); // Convertir le tableau en une chaîne séparée par des virgules
                }

                // Si une valeur de réponse est présente et non vide
                if (answerValue !== undefined && answerValue !== null && answerValue !== '') {
                    answersToCreate.push({
                        fields: { // Chaque réponse doit être enveloppée dans un objet 'fields'
                            "ID_produit": [productRecord[0].id],  // Lien vers l'ID du produit
                            "ID_questions": [questionId],         // Lien vers l'ID de la question
                            "Réponse": String(answerValue),       // Assurez-vous que la réponse est une chaîne
                            // Vous pouvez ajouter d'autres champs ici si nécessaire, par exemple:
                            // "Fournisseur (Link)": [supplierRecord[0].id] // Si vous voulez le lier aussi au fournisseur
                        }
                    });
                }
            } else {
                console.warn(`Aucune correspondance d'ID_question trouvée pour l'indicateur: ${key}. Réponse non enregistrée dans la table Réponses.`);
            }
        }

        // Si des réponses dynamiques sont à créer, les envoyer par lots à Airtable
        if (answersToCreate.length > 0) {
            const batchSize = 10; // Airtable API limite à 10 enregistrements par opération en batch
            for (let i = 0; i < answersToCreate.length; i += batchSize) {
                const batch = answersToCreate.slice(i, i + batchSize);
                await base(answersTableName).create(batch, { typecast: true });
            }
            console.log(`${answersToCreate.length} réponses dynamiques créées.`);
        }

        // Retourner une réponse de succès
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses) envoyées avec succès !',
                supplierId: supplierRecord[0].id, // Accéder à l'ID du premier élément créé
                productId: productRecord[0].id,   // Accéder à l'ID du premier élément créé
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