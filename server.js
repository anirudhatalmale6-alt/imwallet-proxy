const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PROXY_SECRET = process.env.PROXY_SECRET || 'biq_imw_proxy_2026';
const IMWALLET_BASE = 'https://partner.imwallet.in';

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://optioninsights.in');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }

    // Auth check
    const proxySecret = req.headers['x-proxy-secret'];
    if (proxySecret !== PROXY_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // Only allow /web_services/ paths
    const parsed = url.parse(req.url, true);
    if (!parsed.pathname.startsWith('/web_services/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
    }

    // Build target URL
    const targetUrl = IMWALLET_BASE + req.url;
    const targetParsed = url.parse(targetUrl);

    const options = {
        hostname: targetParsed.hostname,
        port: targetParsed.port || 443,
        path: targetParsed.path,
        method: req.method,
        headers: {
            'User-Agent': 'BudgetIQ-Proxy/1.0',
            'Accept': 'application/json',
        },
        timeout: 25000,
    };

    console.log(`[${new Date().toISOString()}] ${req.method} ${parsed.pathname}`);

    const proxyReq = https.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', (chunk) => { body += chunk; });
        proxyRes.on('end', () => {
            console.log(`  -> ${proxyRes.statusCode} (${body.length} bytes)`);
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            });
            res.end(body);
        });
    });

    proxyReq.on('error', (err) => {
        console.error(`  -> ERROR: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy connection failed', detail: err.message }));
    });

    proxyReq.on('timeout', () => {
        console.error('  -> TIMEOUT');
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy timeout' }));
    });

    // Forward POST body if present
    if (req.method === 'POST') {
        let reqBody = '';
        req.on('data', (chunk) => { reqBody += chunk; });
        req.on('end', () => {
            proxyReq.write(reqBody);
            proxyReq.end();
        });
    } else {
        proxyReq.end();
    }
});

server.listen(PORT, () => {
    console.log(`IMwalleT Proxy running on port ${PORT}`);
});
