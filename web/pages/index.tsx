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
          <div className="bg-white p-6 rounded shadow mx-auto">
            <h2 className="text-xl font-semibold mb-3">ニックネームで参加</h2>
            <div className="flex gap-2">
              <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="ニックネーム" className="border p-2 rounded" />
              <button onClick={join} className="ml-2 bg-indigo-600 text-white px-4 py-2 rounded">参加</button>
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
