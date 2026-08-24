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
    return () => { socket.off('receive-message'); socket.off('receive-image'); socket.off('receive-video') }
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
      </div>
    </div>
  )
}
