import Head from 'next/head'
import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'

export default function Home() {
  const [messages, setMessages] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [input, setInput] = useState('')

  useEffect(() => {
    const socket = getSocket()
    socket.on('receive-message', (m:any) => setMessages(prev => [...prev, m]))
    socket.on('update-users', (u:any) => setUsers(u))
    socket.on('receive-image', (d:any) => setMessages(prev => [...prev, {...d, type:'image'}]))
    socket.on('receive-video', (d:any) => setMessages(prev => [...prev, {...d, type:'video'}]))
    return () => { socket.off('receive-message'); socket.off('update-users') }
  }, [])

  function join() {
    const socket = getSocket();
    if (!username) return alert('ニックネームを入力')
    socket.emit('set-username', username)
    socket.once('username-accepted', () => setJoined(true))
    socket.once('username-error', (d:any) => alert(d.message))
  }

  function send() {
    const socket = getSocket();
    if (!input) return
    socket.emit('send-message', { message: input })
    setInput('')
  }

  return (
    <div>
      <Head><title>Rural-Urban Connect</title></Head>
      <main className="container">
        <h1 className="text-2xl font-bold">Rural-Urban Connect</h1>
        {!joined ? (
          <div className="mt-4">
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="ニックネーム" className="border p-2" />
            <button onClick={join} className="ml-2 bg-blue-600 text-white px-3 py-2">参加</button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <h2 className="font-semibold">オンライン</h2>
              <ul>
                {users.map(u=> <li key={u.id}>{u.username}</li>)}
              </ul>
            </div>
            <div className="col-span-2">
              <div className="h-96 border p-2 overflow-auto bg-white">
                {messages.map((m,i)=> (
                  <div key={i} className="mb-2">
                    <div className="text-xs text-gray-500">{m.username} • {new Date(m.timestamp).toLocaleString()}</div>
                    {m.type==='image' && <img src={m.image} alt="img" className="max-w-md" />}
                    {m.type==='video' && <video src={m.video} controls className="max-w-md" />}
                    {(!m.type || m.type==='text') && <div className="p-2 bg-gray-100 rounded">{m.message}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input value={input} onChange={e=>setInput(e.target.value)} className="flex-1 border p-2" />
                <button onClick={send} className="bg-blue-600 text-white px-3 py-2">送信</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
