import React from 'react'

type Props = { users: any[] }

export default function Sidebar({ users }: Props) {
  return (
    <aside className="w-72 bg-white border-r p-4 overflow-auto">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-700">オンライン</h2>
        <ul className="mt-2 space-y-2">
          {users.map(u => (
            <li key={u.id} className="text-sm text-gray-800">{u.username}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700">最近の投稿</h3>
        <div className="mt-2 space-y-2 text-sm text-gray-600">投稿の一覧はここに表示</div>
      </div>
    </aside>
  )
}
