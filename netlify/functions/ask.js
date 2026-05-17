// netlify/functions/ask.js
// Proxies requests to the Google Gemini API so your secret key
// never appears in frontend code.
//
// Setup:
// 1. In your repo, create the folder: netlify/functions/
// 2. Put this file inside it as: netlify/functions/ask.js
// 3. In Netlify dashboard → Site settings → Environment variables
//    add: GEMINI_API_KEY = AIza...your key...
// 4. Redeploy. The frontend will call /.netlify/functions/ask

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const prompt = body.messages?.[0]?.content || '';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 800 },
      }),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Return in same shape the frontend expects from Anthropic
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        content: [{ type: 'text', text }]
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};