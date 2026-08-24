import React from 'react'
type Props = { users: any[] }

import { startCall } from '../lib/webrtc'

export default function Sidebar({ users }: Props) {
  return (
    <aside className="w-72 bg-white border-r p-4 overflow-auto">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700">オンライン</h2>
        <ul className="mt-2 space-y-2">
          {users.map(u => (
            <li key={u.id} className="text-sm text-gray-800 flex items-center justify-between">
              <span>{u.username}</span>
              <button className="text-xs text-indigo-600" onClick={async ()=>{
                try{
                  const useVideo = confirm('ビデオ通話にしますか？（OK=ビデオ／キャンセル=音声のみ）')
                  if(useVideo) await (await import('../lib/webrtc')).startVideoCall(u.id)
                  else { const local = await (await import('../lib/webrtc')).getLocalStream(true,false); await (await import('../lib/webrtc')).startCall(u.id, local) }
                }catch(e){ alert('通話開始に失敗しました') }
              }}>通話</button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">地域コミュニティ</h3>
        <div className="mt-2 text-sm leading-6 text-gray-500">地域の投稿は中央のホームフィードに表示されます。</div>
      </div>
    </aside>
  )
}
