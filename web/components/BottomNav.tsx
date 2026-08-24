import { useRouter } from 'next/router'

const items = [
  { href: '/chat', label: 'チャットルーム', icon: '吹' },
  { href: '/posts', label: '投稿', icon: '投' },
  { href: '/map', label: '地域マップ', icon: '地' }
]

export default function BottomNav() {
  const router = useRouter()

  return (
    <nav className="bottom-nav" aria-label="メインメニュー">
      <div className="bottom-nav__inner">
        {items.map(item => {
          const active = router.pathname === item.href
          return (
            <button key={item.href} onClick={() => router.push(item.href)} className={`bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`}>
              <span className="bottom-nav__icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
