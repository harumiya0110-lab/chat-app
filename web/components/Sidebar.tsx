import React from 'react'
import PostForm from './PostForm'

type Props = { users: any[], currentUsername?: string }

import { startCall } from '../lib/webrtc'

export default function Sidebar({ users, currentUsername }: Props) {
  return (
    <aside className="w-72 bg-white border-r p-4 overflow-auto">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700">オンライン</h2>
        <ul className="mt-2 space-y-2">
          {users.map(u => (
            <li key={u.id} className="text-sm text-gray-800 flex items-center justify-between">
              <span>{u.username}</span>
              <button className="text-xs text-indigo-600" onClick={()=>{ startCall(u.id).catch(()=>alert('通話開始に失敗しました')) }}>通話</button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">最近の投稿</h3>
        <div className="mt-2 space-y-2 text-sm text-gray-600">投稿の一覧はここに表示</div>
      </div>

      <PostForm defaultAuthor={currentUsername} />
    </aside>
  )
}
