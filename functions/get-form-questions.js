const Airtable = require('airtable');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://nayorajewelry.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Méthode non autorisée.' }) };
  }

  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

    // Récupérer les questions
    const questionsRecords = await base(process.env.AIRTABLE_QUESTIONS_TABLE_NAME).select({
      sort: [{ field: "etape_questions", direction: "asc" }]
    }).all();

    const questions = questionsRecords.map(record => ({
      id_question: record.get('ID_questions'),
      etape: record.get('etape_questions'),
      indicateur_questions: record.get('indicateur_questions'),
      titre: record.get('Titre_questions'),
      type_questions: record.get('type_questions'),
      coeff_questions: record.get('coef_questions'),
      categorie_questions: record.get('categorie_questions') || '',
      options: record.get('options') || '',
      description: record.get('description') || '',
      obligatoire: record.get('obligatoire') || false,
      ordre: record.get('ordre') || 0,
    }));

    // Récupérer les introductions
    const introsRecords = await base(process.env.AIRTABLE_INTRO_TABLE_NAME).select({
      sort: [{ field: "etape", direction: "asc" }]
    }).all();

    const intros = introsRecords.map(record => ({
      etape: record.get('etape'),
      titre: record.get('titre_etape'),
      introduction: record.get('introduction_etape'),
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ questions, intros }),
    };
  } catch (error) {
    console.error('Erreur Airtable:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message }) };
  }
};
