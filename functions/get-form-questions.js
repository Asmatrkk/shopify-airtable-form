const Airtable = require('airtable');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': 'https://nayorajewelry.com', // REMPLACEZ PAR VOTRE DOMAINE SHOPIFY
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: headers,
            body: '',
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: headers,
            body: JSON.stringify({ message: 'Méthode non autorisée. Seul GET est supporté.' }),
        };
    }

    try {
        const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
        const questionsTableName = process.env.AIRTABLE_QUESTIONS_TABLE_NAME;

        if (!questionsTableName) {
            throw new Error("AIRTABLE_QUESTIONS_TABLE_NAME n'est pas défini dans les variables d'environnement.");
        }

        const records = await base(questionsTableName).select({
            sort: [{field: "etape_questions", direction: "asc"}, {field: "ID_questions", direction: "asc"}]
        }).firstPage();

        const questions = records.map(record => ({
            id_question: record.get('ID_questions'),
            etape: record.get('etape_questions'),
            indicateur_questions: record.get('indicateur_questions'),
            titre: record.get('Titre_questions'),
            type_questions: record.get('type_questions'),
            coeff_questions: record.get('coef_questions') || 0,
            categorie_questions: record.get('categorie_questions') || ''
        }));

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(questions),
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des questions depuis Airtable:', error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: `Erreur interne du serveur lors de la récupération des questions: ${error.message}` }),
        };
    }
};