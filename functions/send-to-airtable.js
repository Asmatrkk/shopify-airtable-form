const Airtable = require('airtable');

exports.handler = async (event) => {
    // Headers CORS à inclure dans toutes les réponses
    const headers = {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // <--- TRÈS IMPORTANT : REMPLACEZ PAR VOTRE DOMAINE SHOPIFY
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        // 'Access-Control-Max-Age': '86400', // Facultatif: met en cache la réponse preflight OPTIONS pour 24h
    };

    // Gérer la requête OPTIONS (pré-vérification CORS)
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
            statusCode: 405,
            headers: headers, // Inclure les headers CORS même en cas d'erreur de méthode
            body: JSON.stringify({ message: 'Méthode non autorisée ou corps manquant.' }),
        };
    }

    let formData;
    try {
        formData = JSON.parse(event.body);
    } catch (error) {
        console.error('Erreur de parsing JSON:', error);
        return {
            statusCode: 400,
            headers: headers, // Inclure les headers CORS même en cas d'erreur de parsing
            body: JSON.stringify({ message: 'Corps de la requête invalide.' }),
        };
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    const supplierTableName = process.env.AIRTABLE_SUPPLIER_TABLE_NAME;
    const productTableName = process.env.AIRTABLE_PRODUCT_TABLE_NAME;

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
                "Fournisseur (Link)": [supplierRecord.id]
            },
            { typecast: true }
        );
        console.log('Enregistrement Produit créé:', productRecord.id);

        return {
            statusCode: 200,
            headers: headers, // TRÈS IMPORTANT : Inclure les headers CORS ici pour la réponse de succès
            body: JSON.stringify({
                message: 'Informations Fournisseur et Produit envoyées avec succès !',
                supplierId: supplierRecord.id,
                productId: productRecord.id,
            }),
        };

    } catch (error) {
        console.error('Erreur lors de l\'envoi à Airtable:', error);
        return {
            statusCode: 500,
            headers: headers, // TRÈS IMPORTANT : Inclure les headers CORS ici pour la réponse d'erreur
            body: JSON.stringify({ message: `Erreur lors de l'envoi à Airtable: ${error.message}` }),
        };
    }
};