require('dotenv').config();

const base = process.env.API_URL || 'http://localhost:4000';

async function run(){
  try{
    const res = await fetch(base + '/api/ice-servers');
    const j = await res.json();
    console.log('ICE servers:', j.iceServers);
    const hasTurn = j.iceServers && j.iceServers.some(s => (s.urls||[]).some(u=>u.startsWith('turn:')));
    if(hasTurn) console.log('TURN server detected — test OK');
    else console.log('No TURN server detected — set TURN_URL/TURN_USERNAME/TURN_PASSWORD in .env to test');
  }catch(e){
    console.error('Failed to fetch /api/ice-servers', e && e.message ? e.message : e);
    process.exitCode = 2;
  }
}
run();
