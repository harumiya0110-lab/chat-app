import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const prisma = new PrismaClient();

type User = { id: string; username?: string };
const users: Record<string, User> = {};

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('set-username', (username: string) => {
    const taken = Object.values(users).some(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (taken) {
      socket.emit('username-error', { message: 'この名前は既に使用されています' });
      return;
    }
    users[socket.id] = { id: socket.id, username };
    socket.emit('username-accepted', { username });
    io.emit('update-users', Object.values(users));
  });

  socket.on('send-message', (data) => {
    const user = users[socket.id];
    if (!user) return;
    const payload = { username: user.username, message: data.message, timestamp: new Date().toISOString(), userId: socket.id };
    io.emit('receive-message', payload);
  });

  socket.on('send-image', (data) => {
    const user = users[socket.id];
    if (!user) return;
    io.emit('receive-image', { username: user.username, image: data.image, filename: data.filename, timestamp: new Date().toISOString() });
  });

  socket.on('send-video', (data) => {
    const user = users[socket.id];
    if (!user) return;
    io.emit('receive-video', { username: user.username, video: data.video, filename: data.filename, timestamp: new Date().toISOString() });
  });

  // WebRTC signaling
  socket.on('call-offer', (payload) => {
    const { targetId, offer } = payload || {};
    if (targetId && offer) io.to(targetId).emit('incoming-call', { from: socket.id, username: users[socket.id]?.username, offer });
  });
  socket.on('call-answer', (payload) => {
    const { targetId, answer } = payload || {};
    if (targetId && answer) io.to(targetId).emit('call-answered', { from: socket.id, answer });
  });
  socket.on('ice-candidate', (payload) => {
    const { targetId, candidate } = payload || {};
    if (targetId && candidate) io.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
  });
  socket.on('end-call', (payload) => {
    const { targetId } = payload || {};
    if (targetId) io.to(targetId).emit('call-ended', { from: socket.id });
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('update-users', Object.values(users));
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Provide ICE servers (STUN/TURN) to clients
app.get('/api/ice-servers', (req, res) => {
  const servers: any[] = [];
  const stunUrls = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(s=>s.trim()).filter(Boolean);
  servers.push({ urls: stunUrls });
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    servers.push({ urls: [process.env.TURN_URL], username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  }
  res.json({ iceServers: servers });
});

// Regions list
app.get('/api/regions', async (req, res) => {
  const regions = await prisma.region.findMany({ include: { posts: true } });
  res.json(regions);
});

// Create post
app.post('/api/posts', async (req, res) => {
  const { title, body, mediaUrl, authorUsername, regionCode } = req.body;
  if (!authorUsername || !title) return res.status(400).json({ error: 'missing fields' });
  let author = await prisma.user.findUnique({ where: { username: authorUsername } });
  if (!author) {
    author = await prisma.user.create({ data: { username: authorUsername } });
  }
  let region = null;
  if (regionCode) region = await prisma.region.findUnique({ where: { code: regionCode } });
  const post = await prisma.post.create({ data: { title, body, mediaUrl, authorId: author.id, regionId: region?.id } });
  res.json(post);
});

// List posts
app.get('/api/posts', async (req, res) => {
  const posts = await prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(posts);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('API server listening on', PORT));
