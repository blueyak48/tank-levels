const targetUrl = 'https://telematics.otodatanetwork.com:4431/v1.0/DataService.svc/devices';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Extract Auth Header from incoming request
  const authHeader = req.headers.authorization;
  const headers = new Headers();
  if (authHeader) headers.append("Authorization", authHeader);
  headers.append("Accept", "application/json");

  try {
    // Explicitly fetch Otodata using Node fetch natively supporting port 4431
    const apiRes = await fetch(targetUrl, {
      method: "GET",
      headers: headers
    });
    
    // Pass raw JSON back
    const data = await apiRes.json();
    res.status(apiRes.status).json(data);
  } catch (err) {
    console.error("Vercel Backend Error:", err.message);
    res.status(500).json({ error: "Backend network failure", msg: err.message });
  }
}
