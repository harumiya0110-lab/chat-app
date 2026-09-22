import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let serviceAccount = null;
let projectId = '';
let enabled = false;
let accessToken = null;
let accessTokenExpiresAt = 0;
const reportTimestamps = new Map();

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return { stringValue: String(value) };
}
function documentsUrl(path='') {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${path}`;
}
try {
  if (rawServiceAccount) {
    serviceAccount = JSON.parse(rawServiceAccount);
    projectId = String(serviceAccount.project_id || '').trim();
    if (!serviceAccount.client_email || !serviceAccount.private_key || !projectId) throw new Error('service account JSON is incomplete');
    enabled = true;
  }
} catch (error) {
  console.error('Moderation persistence initialization failed:', error.message);
}

async function getAccessToken() {
  if (!enabled) return null;
  const now = Math.floor(Date.now()/1000);
  if (accessToken && accessTokenExpiresAt-now > 60) return accessToken;
  const header={alg:'RS256',typ:'JWT'};
  const payload={iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
  const unsigned=`${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer=crypto.createSign('RSA-SHA256');
  signer.update(unsigned); signer.end();
  const assertion=`${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
    signal:AbortSignal.timeout(8000)
  });
  if(!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);
  const result=await response.json();
  accessToken=result.access_token; accessTokenExpiresAt=now+Number(result.expires_in||3600);
  return accessToken;
}
async function firestoreRequest(path, options={}) {
  const token=await getAccessToken();
  if(!token) throw new Error('moderation persistence is disabled');
  const response=await fetch(documentsUrl(path),{
    ...options,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})},
    signal:options.signal||AbortSignal.timeout(8000)
  });
  const body=await response.text().catch(()=> '');
  if(!response.ok) throw new Error(`Firestore request failed: ${response.status} ${body.slice(0,300)}`);
  return body ? JSON.parse(body) : null;
}
function allowReport(socketId) {
  const now=Date.now();
  const recent=(reportTimestamps.get(socketId)||[]).filter(t=>now-t<10*60*1000);
  if(recent.length>=10) return false;
  recent.push(now); reportTimestamps.set(socketId,recent);
  return true;
}
function cleanText(value,max=500){return String(value||'').trim().slice(0,max);}
function cleanReportId(value){return /^[A-Za-z0-9_-]{1,120}$/.test(String(value||'')) ? String(value) : '';}

const originalServerOn=SocketIOServer.prototype.on;
SocketIOServer.prototype.on=function(eventName,listener){
  if(eventName!=='connection') return originalServerOn.call(this,eventName,listener);
  const wrapped=(socket,...rest)=>{
    socket.on('report-message',async(payload={},ack)=>{
      const reporter=socket.__moderationUsername||'';
      const messageId=cleanReportId(payload.id);
      const reason=cleanText(payload.reason,100);
      if(!reporter||!messageId||!reason) return typeof ack==='function'&&ack({ok:false,reason:'invalid'});
      if(!allowReport(socket.id)) return typeof ack==='function'&&ack({ok:false,reason:'rate-limit',message:'通報が多すぎます。しばらくしてから再試行してください。'});
      if(!enabled) return typeof ack==='function'&&ack({ok:false,reason:'disabled',message:'通報機能を一時的に利用できません。'});
      try{
        await firestoreRequest('/reports',{
          method:'POST',
          body:JSON.stringify({fields:{
            messageId:firestoreValue(messageId),
            reporter:firestoreValue(reporter),
            reporterId:firestoreValue(socket.id),
            reason:firestoreValue(reason),
            createdAt:firestoreValue(new Date().toISOString())
          }})
        });
        socket.server.emit('message-reported',{id:messageId});
        if(typeof ack==='function') ack({ok:true});
      }catch(error){
        console.error('Message report save failed:',error);
        if(typeof ack==='function') ack({ok:false,reason:'server-error'});
      }
    });
    socket.on('set-username',username=>{
      const clean=cleanText(username,20);
      if(clean) socket.__moderationUsername=clean;
    });
    socket.on('disconnect',()=>reportTimestamps.delete(socket.id));
    return listener(socket,...rest);
  };
  return originalServerOn.call(this,eventName,wrapped);
};
