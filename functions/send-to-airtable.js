// netlify/functions/send-to-airtable.js

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
        requestBody = JSON.parse(event.body);
        console.log('DEBUG SERVER: Corps de la requête JSON reçu par la fonction Netlify:', requestBody);
    } catch (error) {
        console.error('Erreur de parsing JSON du corps de la requête:', error);
        return {
            statusCode: 400, // Requête invalide
            headers: headers,
            body: JSON.stringify({ message: 'Corps de la requête invalide. Le JSON n\'a pas pu être parsé.' }),
        };
    }

    // --- RÉCUPÉRATION CORRECTE DES DONNÉES ---
    const formData = requestBody.formData;
    const dynamicQuestions = requestBody.dynamicQuestions;

    if (!formData) {
        console.error('formData est manquant dans le corps de la requête.');
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Données du formulaire (formData) manquantes.' }),
        };
    }
    if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
        console.warn("dynamicQuestions n'est pas un tableau valide ou est manquant. Les réponses dynamiques ne pourront pas être liées à l'ID_questions ou utilisées pour le calcul EMTA.");
    }

    // Initialisation de la base Airtable
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Noms des tables Airtable (récupérés des variables d'environnement)
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME;
    const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME; // NOUVEAU: Nom de la table Score

    // Vérification que le nom de la table Score est bien défini
    if (!scoreTableName) {
        console.error("AIRTABLE_SCORE_TABLE_NAME n'est pas défini dans les variables d'environnement.");
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: "Configuration manquante: AIRTABLE_SCORE_TABLE_NAME." }),
        };
    }

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

        // --- NOUVEAU : Initialiser le score total pour les questions EmatA ---
        let totalEmatA_Score = 0;
        // --- FIN NOUVEAU ---

        // Créer une map pour un accès rapide aux ID de question et aux définitions complètes
        const questionLookupMap = new Map();
        if (dynamicQuestions && Array.isArray(dynamicQuestions)) {
            dynamicQuestions.forEach(q => {
                if (q.indicateur_questions) { // Utilisez indicateur_questions comme clé
                    questionLookupMap.set(q.indicateur_questions, q); // Stockez l'objet complet de la question
                }
            });
        }
        console.log('DEBUG SERVER: questionLookupMap après création:', questionLookupMap);

        const answersToCreate = [];

        // Parcourir toutes les données soumises par le formulaire
        for (const key in formData) {
            // Ignorer les champs fixes déjà traités (Fournisseur, Produit, etc.)
            if ([
                'prenom_fournisseur', 'nom_fournisseur', 'email_fournisseur',
                'entreprise_fournisseur', 'siret_fournisseur', 'nom_produit',
                'description_produit', 'timestamp_soumission'
            ].includes(key)) {
                continue;
            }

            const questionDef = questionLookupMap.get(key); // Récupérer la définition complète de la question
            let answerValue = formData[key];

            // Gérer les réponses multiples (comme les checkboxes)
            if (Array.isArray(answerValue)) {
                answerValue = answerValue.join(', ');
            }

            // --- NOUVELLE LOGIQUE POUR CALCULER LES EMATA EN TEMPS RÉEL DANS LA FONCTION ---
            if (questionDef && questionDef.type_questions === 'EmatA') { // Vérifie si le type de question est 'EmatA'
                const numericAnswer = parseFloat(answerValue);
                const coefficient = parseFloat(questionDef.coeff_questions);

                // S'assurer que la réponse et le coefficient sont des nombres valides avant de calculer
                if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                    const individualEmatAScore = numericAnswer * coefficient;
                    totalEmatA_Score += individualEmatAScore; // Accumuler le score EmatA
                    console.log(`DEBUG SERVER: Calcul EmatA pour ${key}: ${numericAnswer} * ${coefficient} = ${individualEmatAScore}. Total EmatA accumulé: ${totalEmatA_Score}`);
                } else {
                    console.warn(`DEBUG SERVER: Réponse non numérique ou coefficient invalide pour question EmatA "${key}": Réponse "${answerValue}", Coeff "${questionDef.coeff_questions}". Cette question n'a pas contribué au total EmatA.`);
                }
            }
            // --- FIN DE LA NOUVELLE LOGIQUE POUR LES EMATA ---

            // Seulement créer une réponse dans la table "Réponses" si la valeur est non vide ET que nous avons une définition de question valide
            if (answerValue !== undefined && answerValue !== null && String(answerValue).trim() !== '' && questionDef && questionDef.id_question) {
                answersToCreate.push({
                    fields: {
                        "ID_produit": [productRecord[0].id],  // Liaison à l'enregistrement Produit
                        "ID_questions": [questionDef.id_question], // Liaison à l'enregistrement Question spécifique
                        "Réponse": String(answerValue),       // Le texte de la réponse
                    }
                });
            } else {
                if (!questionDef || !questionDef.id_question) {
                    console.warn(`DEBUG SERVER: Aucun ID_question trouvé pour l'indicateur "${key}". La réponse "${answerValue}" ne sera pas liée à une question spécifique dans la table Réponses.`);
                } else {
                    console.warn(`DEBUG SERVER: Réponse vide ou invalide pour l'indicateur "${key}". Réponse non enregistrée pour cette question dans la table Réponses.`);
                }
            }
        }
        console.log('DEBUG SERVER: answersToCreate AVANT envoi à Airtable:', answersToCreate);

        // Envoyer les réponses dynamiques à Airtable
        if (answersToCreate.length > 0) {
            console.log(`DEBUG SERVER: Tentative de création de ${answersToCreate.length} réponses dans Airtable.`);
            const batchSize = 10; // Limite de l'API Airtable pour les opérations en batch
            for (let i = 0; i < answersToCreate.length; i += batchSize) {
                const batch = answersToCreate.slice(i, i + batchSize);
                await base(answersTableName).create(batch, { typecast: true });
            }
            console.log(`${answersToCreate.length} réponses dynamiques créées.`);
        } else {
            console.log('DEBUG SERVER: Aucune réponse dynamique à créer.');
        }

        // --- NOUVEAU : Créer l'enregistrement Score avec le total EmatA ---
        console.log(`DEBUG SERVER: Création de l'enregistrement Score pour le Produit ID ${productRecord[0].id} avec EmatA total: ${totalEmatA_Score}`);
        const scoreRecord = await base(scoreTableName).create(
            [
                {
                    fields: {
                        "ID_produit": [productRecord[0].id], // Lier à l'enregistrement Produit créé précédemment
                        "EmatA": totalEmatA_Score,             // La somme calculée des scores EmatA
                        // Ajoutez ici d'autres champs de score si vous en avez (ex: autres catégories)
                    }
                }
            ],
            { typecast: true }
        );
        console.log('Enregistrement Score créé:', scoreRecord[0].id);
        // --- FIN NOUVEAU ---

        // Retourner une réponse de succès
        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: 'Informations (Fournisseur, Produit, Réponses, Score) envoyées avec succès !',
                supplierId: supplierRecord[0].id,
                productId: productRecord[0].id,
                scoreId: scoreRecord[0].id, // Retourne l'ID du score aussi
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