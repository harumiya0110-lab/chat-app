import { getSocket } from './socket'

type PCEntry = { pc: RTCPeerConnection, stream?: MediaStream }
const pcs: Record<string, PCEntry> = {}

function getPcEntries(){
  return Object.entries(pcs)
}

async function fetchIceServers(){
  try {
    const res = await fetch((process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000') + '/api/ice-servers')
    const j = await res.json()
    return j.iceServers || []
  } catch(e){
    return [{ urls: ['stun:stun.l.google.com:19302'] }]
  }
}

export async function startCall(targetId:string, localStream?: MediaStream){
  if (pcs[targetId]) return pcs[targetId].pc
  const iceServers = await fetchIceServers()
  const pc = new RTCPeerConnection({ iceServers })
  pcs[targetId] = { pc, stream: localStream }

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) getSocket().emit('ice-candidate', { targetId, candidate: e.candidate })
  }
  pc.ontrack = (e) => {
    const remoteStream = e.streams && e.streams[0]
    const ev = new CustomEvent('webrtc-remote-stream', { detail: { targetId, stream: remoteStream } })
    window.dispatchEvent(ev)
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  getSocket().emit('call-offer', { targetId, offer })
  return pc
}

export async function startVideoCall(targetId:string){
  const local = await getLocalStream(true, true)
  return startCall(targetId, local)
}

export async function handleIncomingOffer(fromId:string, offer:any, localStream?: MediaStream){
  const iceServers = await fetchIceServers()
  const pc = new RTCPeerConnection({ iceServers })
  pcs[fromId] = { pc, stream: localStream }

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream))

  pc.onicecandidate = (e) => { if (e.candidate) getSocket().emit('ice-candidate', { targetId: fromId, candidate: e.candidate }) }
  pc.ontrack = (e) => {
    const remoteStream = e.streams && e.streams[0]
    window.dispatchEvent(new CustomEvent('webrtc-remote-stream', { detail: { targetId: fromId, stream: remoteStream } }))
  }

  await pc.setRemoteDescription(offer)
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  getSocket().emit('call-answer', { targetId: fromId, answer })
  return pc
}

export function handleRemoteAnswer(fromId:string, answer:any){
  const entry = pcs[fromId]
  if (!entry) return
  entry.pc.setRemoteDescription(answer).catch(()=>{})
}

export function handleRemoteIce(fromId:string, candidate:any){
  const entry = pcs[fromId]
  if (!entry) return
  entry.pc.addIceCandidate(candidate).catch(()=>{})
}

export function endCall(targetId:string){
  const entry = pcs[targetId]
  if (!entry) return
  try { entry.pc.close() } catch(e){}
  delete pcs[targetId]
  getSocket().emit('end-call', { targetId })
}

export async function getLocalStream(audio=true, video=false){
  const constraints: any = { audio: !!audio }
  if (video === true) constraints.video = true
  else if (typeof video === 'string' || typeof video === 'object') constraints.video = video
  return navigator.mediaDevices.getUserMedia(constraints)
}

export async function switchCameraAll(deviceId?:string){
  const newStream = await getLocalStream(true, deviceId ? { deviceId: { exact: deviceId } } : true)
  getPcEntries().forEach(([peerId, entry])=>{
    const senders = entry.pc.getSenders()
    const videoSender = senders.find(s => s.track && s.track.kind === 'video')
    const newVideoTrack = newStream.getVideoTracks()[0]
    if (videoSender && newVideoTrack) videoSender.replaceTrack(newVideoTrack)
    // update stored stream
    entry.stream = newStream
  })
}

export async function listCameras(){
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter(d=>d.kind==='videoinput')
}
