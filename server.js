const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PROXY_SECRET = process.env.PROXY_SECRET || 'biq_imw_proxy_2026';
const IMWALLET_BASE = 'https://partner.imwallet.in';

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsed = url.parse(req.url, true);

    // Health check
    if (parsed.pathname === '/health' || parsed.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }

    // IP check - fetches outbound IP so we know what to whitelist
    if (parsed.pathname === '/ip') {
        https.get('https://api.ipify.org?format=json', (ipRes) => {
            let body = '';
            ipRes.on('data', (c) => { body += c; });
            ipRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    outbound_ip: JSON.parse(body).ip,
                    note: 'Whitelist this IP in IMwalleT panel'
                }));
            });
        }).on('error', () => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not detect IP' }));
        });
        return;
    }

    // Auth check
    const proxySecret = req.headers['x-proxy-secret'];
    if (proxySecret !== PROXY_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // Route: /api/proxy?path=/web_services/...&param1=val1&param2=val2
    // Also supports direct: /web_services/...?params
    let targetPath;
    let targetParams = {};

    if (parsed.pathname === '/api/proxy') {
        targetPath = parsed.query.path;
        // Copy all query params except 'path'
        Object.keys(parsed.query).forEach(k => {
            if (k !== 'path') targetParams[k] = parsed.query[k];
        });
    } else if (parsed.pathname.startsWith('/web_services/')) {
        targetPath = parsed.pathname;
        targetParams = parsed.query || {};
    } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
    }

    if (!targetPath || !targetPath.startsWith('/web_services/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path must start with /web_services/' }));
        return;
    }

    // Build target URL
    const qs = new URLSearchParams(targetParams).toString();
    const targetUrl = IMWALLET_BASE + targetPath + (qs ? '?' + qs : '');
    const targetParsed = url.parse(targetUrl);

    console.log(`[${new Date().toISOString()}] PROXY ${targetPath}`);

    // Direct connection to IMwalleT (Render's IP must be whitelisted)
    const options = {
        hostname: targetParsed.hostname,
        port: 443,
        path: targetParsed.path,
        method: 'GET',
        headers: {
            'User-Agent': 'BudgetIQ-Proxy/1.0',
            'Accept': 'application/json',
        },
        timeout: 30000,
    };

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
        res.end(JSON.stringify({
            error: 'Proxy connection failed',
            detail: err.message,
            hint: 'Ensure Render IP is whitelisted in IMwalleT'
        }));
    });

    proxyReq.on('timeout', () => {
        console.error('  -> TIMEOUT');
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy timeout' }));
    });

    proxyReq.end();
});

server.listen(PORT, () => {
    console.log(`IMwalleT Proxy running on port ${PORT}`);

    // Self-ping every 10 min to prevent Render free tier from sleeping
    const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(() => {
        const pingUrl = KEEP_ALIVE_URL + '/health';
        const mod = pingUrl.startsWith('https') ? https : http;
        mod.get(pingUrl, (r) => {
            let b = '';
            r.on('data', (c) => { b += c; });
            r.on('end', () => { console.log(`[keep-alive] ${r.statusCode}`); });
        }).on('error', (e) => { console.log(`[keep-alive] err: ${e.message}`); });
    }, 10 * 60 * 1000);
});
