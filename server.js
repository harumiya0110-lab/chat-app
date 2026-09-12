import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { GoogleGenAI, Type } from '@google/genai';
import { claimAccountName, releaseAccountName, isAccountNameAvailable } from './firebase-persistence.mjs';
import { registerThemePersistence, initializeThemeForSocket } from './theme-persistence.mjs';
import { registerChatCustomizationPersistence } from './chat-customization-persistence.mjs';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 40 * 1024 * 1024
});
registerThemePersistence(io);
registerChatCustomizationPersistence(io);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventTypes = ['鳥獣目撃', '道路障害', '助け合い', 'イベント', 'その他'];
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'inaka-power-chat-map/1.0';

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/account-name/claim', async (req, res) => {
  const { accountName, uid, email } = req.body || {};
  const cleanName = typeof accountName === 'string' ? accountName.trim().slice(0, 20) : '';
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().slice(0, 320) : '';
  if (!cleanName || !cleanUid) return res.status(400).json({ ok: false, reason: 'invalid' });
  try {
    const result = await claimAccountName(cleanName, cleanUid, cleanEmail);
    if (!result.ok && result.reason === 'name-taken') return res.status(409).json(result);
    if (!result.ok) return res.status(503).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Account-name claim failed:', error);
    return res.status(500).json({ ok: false, reason: 'server-error' });
  }
});

app.get('/api/account-name/check', async (req, res) => {
  const accountName = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 20) : '';
  if (!accountName) return res.status(400).json({ ok: false, available: false, reason: 'invalid' });
  try {
    return res.json(await isAccountNameAvailable(accountName));
  } catch (error) {
    console.error('Account-name availability check failed:', error);
    return res.status(500).json({ ok: false, available: false, reason: 'server-error' });
  }
});

app.post('/api/account-name/release', async (req, res) => {
  const { accountName, uid } = req.body || {};
  const cleanName = typeof accountName === 'string' ? accountName.trim().slice(0, 20) : '';
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  if (!cleanName || !cleanUid) return res.status(400).json({ ok: false, reason: 'invalid' });
  try {
    return res.json(await releaseAccountName(cleanName, cleanUid));
  } catch (error) {
    console.error('Account-name release failed:', error);
    return res.status(500).json({ ok: false, reason: 'server-error' });
  }
});

function normalizeAnalysis(value) {
  if (!value || typeof value !== 'object') throw new Error('Geminiの解析結果が不正です');
  const hasLocation = value.hasLocation === true;
  const locationName = typeof value.locationName === 'string' ? value.locationName.trim().slice(0, 200) : '';
  const locationCandidates = Array.isArray(value.locationCandidates)
    ? value.locationCandidates.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 200)).slice(0, 5)
    : [];
  const eventType = eventTypes.includes(value.eventType) ? value.eventType : 'その他';
  const summary = typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim().slice(0, 100) : '地域のお知らせ';
  return { hasLocation: hasLocation && Boolean(locationName), locationName, locationCandidates, eventType, summary };
}