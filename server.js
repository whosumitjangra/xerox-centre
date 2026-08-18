// ===================================================================
// Xerox Centre — AIT Pune  |  Backend server (pure Node.js, no npm packages needed)
// Run with: node server.js
// ===================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FILES_FILE = path.join(DATA_DIR, 'files.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// ---------- make sure folders/files exist ----------
[UPLOADS_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(FILES_FILE)) fs.writeFileSync(FILES_FILE, '[]');
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

// ---------- pricing rules (₹ per page) ----------
const PRICE_TABLE = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

// ---------- order status based on elapsed time (demo/mock logic) ----------
function computeOrderStatus(createdAt) {
  const minutesElapsed = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutesElapsed < 1) return 'Order Received';
  if (minutesElapsed < 3) return 'Printing in Progress';
  if (minutesElapsed < 6) return 'Ready for Pickup';
  return 'Completed';
}

// ---------- tiny "database" helpers (JSON files) ----------
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- in-memory sessions ----------
// token -> { userId, name, email }
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, name: user.name, email: user.email });
  return token;
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return null;
  return sessions.get(token) || null;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

// ---------- password hashing (built-in crypto, no bcrypt needed) ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------- body parsing helpers ----------
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 60 * 1024 * 1024; // 60MB hard cap
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    return {};
  }
}

// ---------- minimal multipart/form-data parser ----------
// Handles simple file + field uploads without any external library.
async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!match) throw new Error('No boundary found in Content-Type');
  const boundary = '--' + (match[1] || match[2]).trim();
  const raw = await readRawBody(req);

  const boundaryBuf = Buffer.from(boundary);
  const parts = [];
  let start = raw.indexOf(boundaryBuf, 0);
  while (start !== -1) {
    const next = raw.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    // slice between this boundary and next boundary
    let chunk = raw.slice(start + boundaryBuf.length, next);
    // trim leading CRLF and trailing CRLF/--
    if (chunk.slice(0, 2).toString() === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString() === '\r\n') chunk = chunk.slice(0, -2);
    if (chunk.length > 0 && chunk.toString() !== '--') {
      parts.push(chunk);
    }
    start = next;
  }

  const fields = {};
  const files = [];

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf-8');
    const body = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    const fieldName = nameMatch ? nameMatch[1] : null;

    if (filenameMatch && filenameMatch[1] !== '') {
      files.push({
        fieldName,
        filename: filenameMatch[1],
        data: body
      });
    } else if (fieldName) {
      fields[fieldName] = body.toString('utf-8');
    }
  }

  return { fields, files };
}

// ---------- response helpers ----------
function sendJSON(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ===================================================================
// ROUTES
// ===================================================================

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  try {
    // ---------------- AUTH: SIGNUP ----------------
    if (pathname === '/api/signup' && req.method === 'POST') {
      const { name, email, password } = await readJSONBody(req);
      if (!name || !email || !password) {
        return sendJSON(res, 400, { error: 'Name, email and password are required.' });
      }
      const users = readJSON(USERS_FILE);
      if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return sendJSON(res, 409, { error: 'An account with this email already exists.' });
      }
      const salt = makeSalt();
      const passwordHash = hashPassword(password, salt);
      const newUser = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        email,
        salt,
        passwordHash,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      writeJSON(USERS_FILE, users);

      const token = createSession(newUser);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
      return sendJSON(res, 200, { success: true, name: newUser.name, email: newUser.email });
    }

    // ---------------- AUTH: LOGIN ----------------
    if (pathname === '/api/login' && req.method === 'POST') {
      const { email, password } = await readJSONBody(req);
      if (!email || !password) {
        return sendJSON(res, 400, { error: 'Email and password are required.' });
      }
      const users = readJSON(USERS_FILE);
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        return sendJSON(res, 401, { error: 'Invalid email or password.' });
      }
      const hash = hashPassword(password, user.salt);
      if (hash !== user.passwordHash) {
        return sendJSON(res, 401, { error: 'Invalid email or password.' });
      }
      const token = createSession(user);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
      return sendJSON(res, 200, { success: true, name: user.name, email: user.email });
    }

    // ---------------- AUTH: LOGOUT ----------------
    if (pathname === '/api/logout' && req.method === 'POST') {
      const cookies = parseCookies(req);
      if (cookies.session) sessions.delete(cookies.session);
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
      return sendJSON(res, 200, { success: true });
    }

    // ---------------- AUTH: CURRENT USER ----------------
    if (pathname === '/api/me' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      return sendJSON(res, 200, { name: session.name, email: session.email });
    }

    // ---------------- FILES: UPLOAD ----------------
    if (pathname === '/api/upload' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'You must be logged in to upload files.' });

      const { files } = await parseMultipart(req);
      if (!files.length) return sendJSON(res, 400, { error: 'No files received.' });

      const filesDb = readJSON(FILES_FILE);
      const userUploadDir = path.join(UPLOADS_DIR, session.userId);
      if (!fs.existsSync(userUploadDir)) fs.mkdirSync(userUploadDir, { recursive: true });

      const saved = [];
      for (const f of files) {
        const id = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(f.filename);
        const storedName = id + ext;
        fs.writeFileSync(path.join(userUploadDir, storedName), f.data);
        const record = {
          id,
          ownerId: session.userId,
          originalName: f.filename,
          storedName,
          size: f.data.length,
          uploadedAt: new Date().toISOString()
        };
        filesDb.push(record);
        saved.push(record);
      }
      writeJSON(FILES_FILE, filesDb);
      return sendJSON(res, 200, { success: true, files: saved });
    }

    // ---------------- FILES: LIST ----------------
    if (pathname === '/api/files' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const filesDb = readJSON(FILES_FILE);
      const mine = filesDb.filter(f => f.ownerId === session.userId);
      return sendJSON(res, 200, { files: mine });
    }

    // ---------------- FILES: DELETE ----------------
    if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const id = pathname.split('/').pop();
      const filesDb = readJSON(FILES_FILE);
      const idx = filesDb.findIndex(f => f.id === id && f.ownerId === session.userId);
      if (idx === -1) return sendJSON(res, 404, { error: 'File not found.' });
      const record = filesDb[idx];
      const filePath = path.join(UPLOADS_DIR, record.ownerId, record.storedName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      filesDb.splice(idx, 1);
      writeJSON(FILES_FILE, filesDb);
      return sendJSON(res, 200, { success: true });
    }

    // ---------------- ORDERS: CREATE (after "payment") ----------------
    if (pathname === '/api/orders' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'You must be logged in to place an order.' });

      const { items } = await readJSONBody(req);
      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: 'No items in this order.' });
      }

      // recompute price on the server too (never trust the client's total)
      let total = 0;
      const cleanItems = [];
      for (const item of items) {
        const pages = parseInt(item.pages, 10);
        const sides = item.sides === 'double' ? 'double' : 'single';
        const color = item.color === 'color' ? 'color' : 'bw';
        if (!pages || pages < 1) {
          return sendJSON(res, 400, { error: `Invalid page count for ${item.originalName || 'a file'}.` });
        }
        const rate = PRICE_TABLE[`${color}-${sides}`];
        const linePrice = rate * pages;
        total += linePrice;
        cleanItems.push({
          fileId: item.fileId,
          originalName: item.originalName,
          pages,
          sides,
          color,
          price: linePrice
        });
      }

      const orders = readJSON(ORDERS_FILE);
      const orderId = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const order = {
        orderId,
        ownerId: session.userId,
        ownerName: session.name,
        items: cleanItems,
        total,
        createdAt: new Date().toISOString()
      };
      orders.push(order);
      writeJSON(ORDERS_FILE, orders);

      return sendJSON(res, 200, { success: true, orderId, total });
    }

    // ---------------- ORDERS: LIST MY ORDERS ----------------
    if (pathname === '/api/orders' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const orders = readJSON(ORDERS_FILE);
      const mine = orders
        .filter(o => o.ownerId === session.userId)
        .map(o => ({ orderId: o.orderId, total: o.total, createdAt: o.createdAt, status: computeOrderStatus(o.createdAt) }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJSON(res, 200, { orders: mine });
    }

    // ---------------- ORDERS: TRACK / GET ONE ----------------
    if (pathname.startsWith('/api/orders/') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const orderId = decodeURIComponent(pathname.split('/').pop());
      const orders = readJSON(ORDERS_FILE);
      const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());
      if (!order) return sendJSON(res, 404, { error: 'No order found with that ID.' });
      return sendJSON(res, 200, {
        orderId: order.orderId,
        items: order.items,
        total: order.total,
        createdAt: order.createdAt,
        status: computeOrderStatus(order.createdAt)
      });
    }

    // ---------------- FILES: DOWNLOAD / PREVIEW ----------------
    if (pathname.startsWith('/api/download/') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const id = pathname.split('/').pop();
      const filesDb = readJSON(FILES_FILE);
      const record = filesDb.find(f => f.id === id && f.ownerId === session.userId);
      if (!record) return sendJSON(res, 404, { error: 'File not found.' });
      const filePath = path.join(UPLOADS_DIR, record.ownerId, record.storedName);

      const ext = path.extname(record.originalName).toLowerCase();
      const isPreviewable = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
      const wantsInline = parsed.query && parsed.query.inline === '1';

      if (!(isPreviewable && wantsInline)) {
        res.setHeader('Content-Disposition', `attachment; filename="${record.originalName}"`);
      }
      const contentType = MIME[ext] || 'application/octet-stream';
      return sendFile(res, filePath, contentType);
    }

    // ---------------- STATIC FILES ----------------
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);

    // security: prevent path traversal outside public dir
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      return sendFile(res, filePath, MIME[ext] || 'application/octet-stream');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');

  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Server error: ' + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Xerox Centre server running at http://localhost:${PORT}`);
});
