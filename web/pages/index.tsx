import Head from 'next/head'
import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'
import FeedPanel from '../components/FeedPanel'
import MapPanel from '../components/MapPanel'

export default function Home() {
  const [users, setUsers] = useState<any[]>([])
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    const socket = getSocket()
    socket.on('update-users', (u:any) => setUsers(u))
    return () => { socket.off('update-users') }
  }, [])

  function join() {
    const socket = getSocket();
    if (!username) return alert('ニックネームを入力')
    socket.emit('set-username', username)
    socket.once('username-accepted', () => setJoined(true))
    socket.once('username-error', (d:any) => alert(d.message))
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Head><title>Rural-Urban Connect</title></Head>
      <Header />
      <div className="container flex gap-4 mt-6">
        {!joined ? (
          <div id="join" className="mx-auto w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold mb-3">ニックネームで参加</h2>
            <p className="mb-5 text-sm text-slate-500">投稿やチャットに参加する名前を入力してください。</p>
            <div className="flex gap-2">
              <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="ニックネーム" className="border p-2 rounded" />
              <button onClick={join} className="ml-2 bg-indigo-600 text-white px-4 py-2 rounded">参加</button>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3 border-t border-slate-100 pt-6">
              <a href="/posts" className="rounded-xl border border-indigo-200 p-4 text-center font-semibold text-indigo-700 hover:bg-indigo-50">投稿を見る</a>
              <a href="/map" className="rounded-xl border border-slate-200 p-4 text-center font-semibold text-slate-700 hover:bg-slate-50">地域マップを見る</a>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex bg-white rounded shadow overflow-hidden">
            <Sidebar users={users} />
            <div className="flex-1 flex flex-col">
              <FeedPanel username={username} />
            </div>
            <MapPanel />
          </div>
        )}
      </div>
    </div>
  )
}
