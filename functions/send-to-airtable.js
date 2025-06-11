// functions/send-to-airtable.js
const Airtable = require('airtable');

exports.handler = async function(event, context) {
    // Vérifiez que la requête est bien une méthode POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method Not Allowed' })
        };
    }

    try {
        // Parse les données envoyées par le formulaire Shopify
        const { name, email, message } = JSON.parse(event.body);

        // Initialisez la base Airtable avec votre clé API (sécurisée via les variables d'environnement)
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

        // Créez un nouvel enregistrement dans Airtable
        await base(process.env.AIRTABLE_TABLE_NAME).create([
            {
                "fields": {
                    "Nom": name,
                    "Email": email,
                    "Message": message,
                    "Date de soumission": new Date().toISOString() // Ajoute la date et l'heure
                }
            }
        ]);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Form submission successful!' })
        };

    } catch (error) {
        console.error("Error creating record in Airtable:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to submit form', error: error.message })
        };
    }
};