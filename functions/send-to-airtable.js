// netlify/functions/send-to-airtable.js

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
        // Le corps de la requête doit maintenant contenir { formData: ..., dynamicQuestions: ... }
        requestBody = JSON.parse(event.body);
        console.log('Corps de la requête JSON reçu par la fonction Netlify:', requestBody); // TRÈS IMPORTANT pour le débogage
    } catch (error) {
        console.error('Erreur de parsing JSON du corps de la requête:', error);
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Corps de la requête invalide. Le JSON n\'a pas pu être parsé.' }),
        };
    }

    // --- RÉCUPÉRATION CORRECTE DES DONNÉES EN FONCTION DU NOUVEAU FORMAT ATTENDU ---
    const formData = requestBody.formData;             // Les données du formulaire soumises
    const dynamicQuestions = requestBody.dynamicQuestions; // Les définitions des questions dynamiques

    // Vérifications de base pour s'assurer que les données essentielles sont présentes
    if (!formData) {
        console.error('formData est manquant dans le corps de la requête.');
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }),
        };
    }
    if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
        console.warn("dynamicQuestions n'est pas un tableau valide ou est manquant. Les réponses dynamiques ne pourront pas être liées à l'ID_questions.");
        // Note: Nous ne retournons pas d'erreur 400 ici pour permettre la soumission même si les questions dynamiques ne peuvent pas être liées.
        // Si la liaison est MANDATORY, changer en 400.
    }


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
                    fields: {
                        "prenom_fournisseur": formData.prenom_fournisseur,
                        "nom_fournisseur": formData.nom_fournisseur,
                        "email_fournisseur": formData.email_fournisseur,
                        "entreprise_fournisseur": formData.entreprise_fournisseur,
                        "siret_fournisseur": formData.siret_fournisseur,
                    }
                }
            ],
            { typecast: true }
        );
        console.log('Enregistrement Fournisseur créé:', supplierRecord[0].id);

        // 2. Créer l'enregistrement Produit, en le liant au Fournisseur
        const productRecord = await base(productTableName).create(
            [
                {
                    fields: {
                        "nom_produit": formData.nom_produit,
                        "description_produit": formData.description_produit,
                        "ID_fournisseur": [supplierRecord[0].id]
                    }
                }
            ],
            { typecast: true }
        );
        console.log('Enregistrement Produit créé:', productRecord[0].id);

        // 3. Traiter et enregistrer les réponses aux questions dynamiques
        const answersToCreate = [];
        
        // Créer une map pour un accès rapide aux ID de question par 'indicateur_questions'
        const questionIdLookupMap = new Map();
        if (dynamicQuestions && Array.isArray(dynamicQuestions)) {
            dynamicQuestions.forEach(q => {
                if (q.indicateur_questions && q.id_question) {
                    questionIdLookupMap.set(q.indicateur_questions, q.id_question);
                }
            });
        }

        // Parcourir toutes les données soumises par le formulaire
        for (const key in formData) {
            // Ignorer les champs fixes déjà traités (Fournisseur, Produit, et timestamp si présent)
            if ([
                'prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur',
                'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit',
                'description_produit', 'timestamp_soumission' // Ajoutez tous les autres champs "fixes" si nécessaire
            ].includes(key)) {
                continue;
            }

            const questionId = questionIdLookupMap.get(key); // Tente de trouver l'ID de la question
            let answerValue = formData[key];

            // Gérer les réponses multiples (comme les checkboxes)
            if (Array.isArray(answerValue)) {
                answerValue = answerValue.join(', '); // Convertit le tableau en une chaîne séparée par des virgules
            }

            // Seulement créer une réponse si la valeur est non vide ET que nous avons un ID de question valide
            if (answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '' && questionId) {
                answersToCreate.push({
                    fields: {
                        "ID_produit": [productRecord[0].id],  // Liaison à l'enregistrement Produit
                        "ID_questions": [questionId],         // Liaison à l'enregistrement Question spécifique
                        "Réponse": String(answerValue),       // Le texte de la réponse (assurez-vous que cette colonne existe et est de type "Single line text" ou "Long text" dans votre table Airtable "Answers")
                    }
                });
            } else {
                if (!questionId) {
                    console.warn(`Aucun ID_question trouvé pour l'indicateur "${key}". La réponse "${answerValue}" ne sera pas liée à une question spécifique.`);
                    // Si vous avez une colonne générique pour les réponses non-liées, vous pourriez l'ajouter ici:
                    // if (answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '') {
                    //     answersToCreate.push({
                    //         fields: {
                    //             "ID_produit": [productRecord[0].id],
                    //             "Réponse_Générique": String(answerValue), // Exemple: ajoutez une colonne "Réponse_Générique" dans Airtable
                    //             "Nom_Champ_Formulaire": key // Pour savoir de quel champ cela vient
                    //         }
                    //     });
                    // }
                } else {
                    console.warn(`Réponse vide ou invalide pour l'indicateur "${key}". Réponse non enregistrée pour cette question.`);
                }
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

        // Retourner une réponse de succès
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses) envoyées avec succès !',
                supplierId: supplierRecord[0].id,
                productId: productRecord[0].id,
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