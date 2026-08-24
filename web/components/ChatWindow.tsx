import React, { useEffect, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

export default function ChatWindow() {
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement|null>(null)

  useEffect(() => {
    const socket = getSocket()
    socket.on('receive-message', (m:any) => setMessages(prev=>[...prev,m]))
    socket.on('receive-image', (m:any) => setMessages(prev=>[...prev,{...m,type:'image'}]))
    socket.on('receive-video', (m:any) => setMessages(prev=>[...prev,{...m,type:'video'}]))
    // WebRTC signaling handlers
    socket.on('incoming-call', async (data:any) => {
      const { from, username, offer } = data
      // dispatch an event so UI can show incoming call modal
      window.dispatchEvent(new CustomEvent('webrtc-incoming', { detail: { from, username, offer } }))
    })
    socket.on('call-answered', (data:any) => {
      const { from, answer } = data
      window.dispatchEvent(new CustomEvent('webrtc-answer', { detail: { from, answer } }))
    })
    socket.on('ice-candidate', (data:any) => {
      const { from, candidate } = data
      window.dispatchEvent(new CustomEvent('webrtc-ice', { detail: { from, candidate } }))
    })
    socket.on('call-ended', (data:any) => { window.dispatchEvent(new CustomEvent('webrtc-ended', { detail: data })) })
    return () => { socket.off('receive-message'); socket.off('receive-image'); socket.off('receive-video') }
  }, [])

  useEffect(()=>{
    const onIncoming = async (e:any) => {
      const { from, username, offer } = e.detail
      // auto-accept with audio only for now
      const { handleIncomingOffer } = await import('../lib/webrtc')
      const local = await (await import('../lib/webrtc')).getLocalStream(true, false)
      handleIncomingOffer(from, offer, local)
    }
    const onAnswer = (e:any) => { const { from, answer } = e.detail; (async()=>{ const w = await import('../lib/webrtc'); w.handleRemoteAnswer(from, answer) })() }
    const onIce = (e:any) => { const { from, candidate } = e.detail; (async()=>{ const w = await import('../lib/webrtc'); w.handleRemoteIce(from, candidate) })() }
    window.addEventListener('webrtc-incoming', onIncoming)
    window.addEventListener('webrtc-answer', onAnswer)
    window.addEventListener('webrtc-ice', onIce)
    return () => { window.removeEventListener('webrtc-incoming', onIncoming); window.removeEventListener('webrtc-answer', onAnswer); window.removeEventListener('webrtc-ice', onIce) }
  }, [])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function send() {
    const socket = getSocket()
    if (!input) return
    socket.emit('send-message', { message: input })
    setInput('')
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      <div ref={messagesRef} className="flex-1 p-4 overflow-auto space-y-4">
        {messages.map((m,i)=>(
          <div key={i} className="">
            <div className="text-xs text-gray-500">{m.username} • {new Date(m.timestamp).toLocaleString()}</div>
            {m.type==='image' && <img src={m.image} className="max-w-xs rounded" />}
            {m.type==='video' && <video src={m.video} controls className="max-w-md rounded" />}
            {(!m.type || m.type==='text') && <div className="mt-1 inline-block bg-white p-2 rounded shadow">{m.message}</div>}
          </div>
        ))}
      </div>
      <div className="p-3 border-t bg-white flex gap-2 items-center">
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="メッセージを入力..." className="flex-1 border rounded px-3 py-2" />
        <button onClick={send} className="bg-indigo-600 text-white px-4 py-2 rounded">送信</button>
        <button onClick={async ()=>{
          try{
            const cams = await (await import('../lib/webrtc')).listCameras()
            if(!cams.length) return alert('カメラが見つかりません')
            const current = cams[0]
            // cycle to next camera
            const deviceId = cams.length>1 ? cams[1].deviceId : cams[0].deviceId
            await (await import('../lib/webrtc')).switchCameraAll(deviceId)
            alert('カメラを切替えました')
          }catch(e){ alert('カメラ切替に失敗しました') }
        }} className="ml-2 bg-gray-200 text-gray-800 px-3 py-2 rounded">カメラ切替</button>
      </div>
    </div>
  )
}
