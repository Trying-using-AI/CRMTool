import { createServer } from 'node:http';
import { createCrmApplication } from './app.js';

const app = createCrmApplication();
const port = Number(process.env.PORT ?? 3001);

const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true, service: 'crmtool-api' }));
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/campaigns')) {
    const tenantId =
      new URL(req.url, `http://${req.headers.host}`).searchParams.get('tenant_id') ?? 'demo';
    res.end(JSON.stringify(app.campaigns.list(tenantId)));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(JSON.stringify({ message: 'CRMTool API listening', port }));
});
