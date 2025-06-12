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

    let receivedData; // Renommé de requestBody pour plus de clarté
    try {
        // Le corps de la requête contient directement les données collectées du formulaire
        receivedData = JSON.parse(event.body);
        console.log('Données JSON reçues et parsées par la fonction Netlify:', receivedData); // TRÈS IMPORTANT pour déboguer !
    } catch (error) {
        console.error('Erreur de parsing JSON:', error);
        return {
            statusCode: 400, // Requête invalide
            headers: headers,
            body: JSON.stringify({ message: 'Corps de la requête invalide. Le JSON n\'a pas pu être parsé.' }),
        };
    }

    // --- CORRECTION CLÉ ICI ---
    // La variable `receivedData` contient déjà toutes les données du formulaire (formDataCollected).
    // Il n'y a pas besoin d'accéder à `receivedData.formData`.
    const formData = receivedData; 
    // Si vous envoyiez dynamicQuestions séparément, vous devriez le récupérer ici:
    // const dynamicQuestions = receivedData.dynamicQuestions; // (décommenter si nécessaire et si vous les envoyez vraiment)

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
                        "prenom_fournisseur": formData.prenom_fournisseur, // Accès direct à formData
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
        
        // --- Vérification et Mappage des questions dynamiques ---
        // Votre client n'envoie plus `dynamicQuestions` dans le corps du POST,
        // donc `questionIdLookupMap` ne peut plus être construit comme avant.
        // Vous devrez soit:
        // A) Renvoyer `dynamicQuestions` avec le `formData` dans le POST du client,
        // B) Ou refaire une requête à `get-form-questions` DANS CETTE FONCTION NETLIFY
        //    pour obtenir les définitions des questions,
        // C) Ou vous baser uniquement sur les `indicateur_questions` pour vos noms de colonnes Airtable.

        // Pour l'instant, je vais laisser le code qui utilise `dynamicQuestions`
        // mais gardez à l'esprit que `dynamicQuestions` sera `undefined`
        // à moins que vous ne le renvoyiez depuis le client ou ne le récupériez ici.
        // Si `dynamicQuestions` est undefined, la boucle for..in pour `formData`
        // sera votre meilleure chance de capturer les champs dynamiques.

        // --- Option C (la plus simple si vous ne renvoyez pas `dynamicQuestions`):
        // Assurez-vous que les `name` de vos champs HTML dynamiques
        // (qui sont les `indicateur_questions`) sont les noms exacts des colonnes
        // dans votre table Airtable "Answers".
        // Alors, vous n'avez pas besoin de `questionIdLookupMap` ici si chaque réponse dynamique
        // est insérée dans la table "Answers" avec le nom de la colonne qui correspond à l'indicateur.

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
                        // "ID_questions": [questionId],         // <-- CE CHAMP REQUIERT ID_questions.
                                                              // Si vous n'avez plus dynamicQuestions,
                                                              // vous ne pouvez plus obtenir questionId.
                                                              // Alternative : créer une colonne "Réponse de [Indicateur]" dans Airtable
                                                              // et envoyer directement la clé/valeur.
                        // Exemple si votre table "Answers" peut stocker n'importe quel champ en tant que réponse:
                        // [key]: String(answerValue), // Ceci enverra `indicateur_questions` comme nom de colonne.
                        // Assurez-vous que la colonne `Réponse` dans Airtable est un champ texte simple pour stocker la valeur.
                        "Réponse_Dynamique": String(answerValue), // Utilisez un champ générique pour stocker la réponse textuelle
                        // Et si vous voulez lier à la question via son ID, vous devez trouver un moyen de le faire
                        // soit en le renvoyant depuis le client, soit en le recherchant à nouveau.
                        // Pour l'instant, je retire la liaison directe à ID_questions ici pour éviter l'erreur.
                        // Vous devrez ajuster votre table Airtable "Answers" en conséquence.
                    }
                });
            } else {
                console.warn(`Aucune valeur de réponse valide pour l'indicateur: ${key}.`);
            }
        }
        
        // --- FIN de la vérification et Mappage des questions dynamiques ---

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