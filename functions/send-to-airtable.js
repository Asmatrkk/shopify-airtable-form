// Importe la bibliothèque Airtable
const Airtable = require('airtable');


/*
* Définition de la fonction de gestionnaire Netlify
* exports.handler = async (event) => { ... }; : C'est la signature standard d'une fonction Netlify.
*/
exports.handler = async (event) => {

    // ---- En-têtes CORS pour permettre l'accès depuis Shopify
    const headers = {
        // Spécifie les domaines autorisés à faire des requêtes à LA fonction. 
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // REMPLACEZ PAR DOMAINE SHOPIFY DE LOWREKA
        // Indique les méthodes HTTP autorisées 
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        // Spécifie les en-têtes HTTP autorisés dans les requêtes.
        'Access-Control-Allow-Headers': 'Content-Type'
    };


    /*
    * Gère les requêtes OPTIONS. Les navigateurs envoient une requête OPTIONS
    * avant une requête POST "réelle" pour vérifier que le serveur autorise la communication cross-origin.
    */
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: headers,
            body: '', // Le corps doit être vide pour une réponse OPTIONS 204
        };
    }

    /* 
    * Vérifie si la requête entrante est bien une requête POST et qu'elle contient un corps.
    * Si ce n'est pas le cas, elle renvoie un statut 405 (Method Not Allowed) avec un message d'erreur.
    */
    if (event.httpMethod !== 'POST' || !event.body) {
        return {
            statusCode: 405, // Méthode non autorisée
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée ou corps manquant.' }),
        };
    }

    /* 
    * Réception des données saisi 
    * Parsage du corps de la requête (event.body) qui est une chaîne JSON, en un objet JavaScript.
    */
    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
        console.log('DEBUG SERVER: Corps de la requête JSON bien reçu :', requestBody);
    } catch (error) {
        console.error('Erreur de parsing JSON : ', error);
        return {
            statusCode: 400, // Requête invalide
            headers: headers,
            body: JSON.stringify({ message: 'Le JSON n\'a pas pu être parsé.' }),
        };
    }

    /* --- RÉCUPÉRATION CORRECTE DES DONNÉES ---
    * Extrait les deux parties principales de l'objet requestBody que le client (Shopify) envoie : 
    * 1 - Les données soumises par l'utilisateur (formData) 
    * 2 - La structure/définition des questions (dynamicQuestions).
    * Documentation pour plus d'infos 
    */
    const formData = requestBody.formData;
    const dynamicQuestions = requestBody.dynamicQuestions;

    // Vérification formdata et dynamicQuestions
    if (!formData) {
        console.error('formData manquant');
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ message: 'Données du formulaire manquantes' }),
        };
    }
    if (!dynamicQuestions || !Array.isArray(dynamicQuestions)) {
        console.warn("dynamicQuestions n'est pas un tableau valide ou est manquant. Les réponses dynamiques ne pourront pas être liées à l'ID_questions ou utilisées pour le calcul EMTA.");
    }

    /* --- INITIALISATION DE LA BASE AIRTABLE ---
    * Initialise le client Airtable avec la clé API et l'ID de votre base, qui sont récupérés via process.env 
    * -> variables d'environnement Netlify, non exposées publiquement pour sécurisé
    * Documentation pour plus d'infos 
    * */
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Noms des tables Airtable : récupérés des variables d'environnement sur Netlify
    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME; // Table fournisseur
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME; // Table Produit
    const answersTableName = process.env.AIRTABLE_ANSWERS_TABLE_NAME; // Table Réponses
    const scoreTableName = process.env.AIRTABLE_SCORE_TABLE_NAME; // Table Score

    // Vérification que le nom de la table Score est bien défini
    if (!scoreTableName) {
        console.error(" La table Score n'est pas correctement défini ou pas défini");
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: "Configuration manquante: AIRTABLE_SCORE_TABLE_NAME." }),
        };
    }

    /* Création des enregistrement 
        * await base(tableName).create(...) : C'est la méthode de l'API Airtable pour créer un ou plusieurs enregistrements.
        * -> Elle prend :
        * - un tableau d'objets fields (où chaque objet représente un enregistrement à créer)
        * - ET un objet d'options { typecast: true / false }, permet à Airtable de tenter de convertir les types de données 
        *   ( ex : convertir une chaîne "123" en nombre si le champ Airtable est de type "Nombre")
        */
    try {
        // 1. Création de l'enregistrement Fournisseur
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

        // 2. Création de l'enregistrement Produit, en le liant au Fournisseur
        const productRecord = await base(productTableName).create(
            [
                {
                    fields: {
                        "nom_produit": formData.nom_produit,
                        "description_produit": formData.description_produit,
                        "ID_fournisseur": [supplierRecord[0].id] // Liaison avec le fournisseur -> Airtable attend un tableau d'IDs pour les champs de liaison.
                    }
                }
            ],
            { typecast: true }
        );
        console.log('Enregistrement Produit créé:', productRecord[0].id);
      
        // Initialisation du score total pour les questions Emat A
        let totalEmatA_Score = 0;
        let totalEmatB_Score = 0;
        let productA_Mass = null; 
        let productB_Mass = null; 

        // Création d'une Map pour stocker les définitions complètes des questions pour un accès rapide (questionLookupMap.get(key)) avec key = l'indicateur_questions
        const questionLookupMap = new Map();
        if (dynamicQuestions && Array.isArray(dynamicQuestions)) {
            dynamicQuestions.forEach(q => {
                if (q.indicateur_questions) { // indicateur_questions comme clé
                    questionLookupMap.set(q.indicateur_questions, q); // Stockage l'objet complet de la question
                }
            });
        }
        console.log('DEBUG SERVER: questionLookupMap après création:', questionLookupMap);

        // Création d'un tableau qui va stocker tous les objets fields des réponses dynamiques avant de les envoyer par lots à Airtable.
        const answersToCreate = [];
        for (const key in formData) {  // Parcour toutes les données soumises par le formulaire

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


            // -------- Récuperation de la masse A et B dans la table score --------

            if (key === 'MasseA') { // Indicateur pour la masse du produit A
                productA_Mass = parseFloat(answerValue);
                if (isNaN(productA_Mass)) {
                    console.warn(`DEBUG SERVER: Masse du produit A ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                    productA_Mass = answerValue;
                }
            }
            if (key === 'MasseB') { // Indicateur pour la masse du produit B
                productB_Mass = parseFloat(answerValue);
                if (isNaN(productB_Mass)) {
                    console.warn(`DEBUG SERVER: Masse du produit B ("${answerValue}") n'est pas un nombre valide. Stockée telle quelle.`);
                    productB_Mass = answerValue;
                }
            }

            // --- NOUVELLE LOGIQUE POUR CALCULER LES EMATA EN TEMPS RÉEL DANS LA FONCTION ---
            if (questionDef && questionDef.categorie_questions === 'EmatA') { // Vérifie si le type de question est 'EmatA' ( on est tjr dans la boucle for )
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

             // --- NOUVELLE LOGIQUE : Calculer les EmatB ---

            if (questionDef && questionDef.categorie_questions === 'EmatB') { 
                const numericAnswer = parseFloat(answerValue);
                const coefficient = parseFloat(questionDef.coeff_questions);
                if (!isNaN(numericAnswer) && !isNaN(coefficient)) {
                    const individualEmatBScore = numericAnswer * coefficient;
                    totalEmatB_Score += individualEmatBScore; 
                    console.log(`DEBUG SERVER: Calcul EmatB pour ${key}: ${numericAnswer} * ${coefficient} = ${individualEmatBScore}. Total EmatB accumulé: ${totalEmatB_Score}`);
                } else {
                    console.warn(`DEBUG SERVER: Réponse non numérique ou coefficient invalide pour question EmatB "${key}": Réponse "${answerValue}", Coeff "${questionDef.coeff_questions}". Cette question n'a pas contribué au total EmatB.`);
                }
            }

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
                        "EmatB": totalEmatB_Score,             // La somme calculée des scores EmatA
                        "MasseA": productA_Mass, // <-- Champ pour Masse A
                        "MasseB": productB_Mass  // <-- Champ pour Masse B
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