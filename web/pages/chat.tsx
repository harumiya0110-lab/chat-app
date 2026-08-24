import Head from 'next/head'
import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'

export default function ChatPage() {
  const [users, setUsers] = useState<any[]>([])
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    const socket = getSocket()
    socket.on('update-users', setUsers)
    return () => { socket.off('update-users', setUsers) }
  }, [])

  function join() {
    const name = username.trim()
    if (!name) return alert('ニックネームを入力してください')
    const socket = getSocket()
    socket.emit('set-username', name)
    socket.once('username-accepted', () => { setUsername(name); setJoined(true) })
    socket.once('username-error', (data: any) => alert(data.message))
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Head><title>チャットルーム | Rural-Urban Connect</title></Head>
      <Header />
      {!joined ? (
        <main className="mx-auto flex min-h-[calc(100vh-150px)] max-w-xl items-center px-4 py-10">
          <section className="w-full rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs font-bold uppercase tracking-[.22em] text-indigo-600">Live room</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">チャットルームに参加</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">オンラインのメンバーとリアルタイムで会話できます。</p>
            <div className="mt-7 flex gap-2">
              <input value={username} onChange={event => setUsername(event.target.value)} onKeyDown={event => event.key === 'Enter' && join()} placeholder="ニックネーム" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" />
              <button onClick={join} className="rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white hover:bg-indigo-700">参加する</button>
            </div>
          </section>
        </main>
      ) : (
        <main className="mx-auto flex max-w-[1280px] gap-4 px-4 py-5">
          <div className="flex min-h-[calc(100vh-180px)] flex-1 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <Sidebar users={users} />
            <ChatWindow />
          </div>
        </main>
      )}
    </div>
  )
}
