const https = require('https');
const url = require('url');

const PROXY_SECRET = process.env.PROXY_SECRET || 'biq_imw_proxy_2026';
const IMWALLET_BASE = 'https://partner.imwallet.in';

module.exports = (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    // Auth
    const secret = req.headers['x-proxy-secret'];
    if (secret !== PROXY_SECRET) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
    }

    // Extract target path from query
    const targetPath = req.query.path;
    if (!targetPath || !targetPath.startsWith('/web_services/')) {
        res.status(400).json({ error: 'Invalid path. Use ?path=/web_services/...' });
        return;
    }

    // Build full query string (exclude 'path' param)
    const params = { ...req.query };
    delete params.path;
    const qs = new URLSearchParams(params).toString();
    const targetUrl = IMWALLET_BASE + targetPath + (qs ? '?' + qs : '');
    const parsed = url.parse(targetUrl);

    const options = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.path,
        method: 'GET',
        headers: {
            'User-Agent': 'BudgetIQ-Proxy/1.0',
            'Accept': 'application/json',
        },
        timeout: 25000,
    };

    const proxyReq = https.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', (chunk) => { body += chunk; });
        proxyRes.on('end', () => {
            res.status(proxyRes.statusCode);
            res.setHeader('Content-Type', 'application/json');
            res.end(body);
        });
    });

    proxyReq.on('error', (err) => {
        res.status(502).json({ error: 'Proxy error', detail: err.message });
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.status(504).json({ error: 'Proxy timeout' });
    });

    proxyReq.end();
};
