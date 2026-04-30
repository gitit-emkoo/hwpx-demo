import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'HWPX 치환자 데모',
  description: 'hwpx 신청서 치환자 자동화 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-gray-50 min-h-screen text-gray-900 antialiased">
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-semibold text-brand-600 text-sm tracking-tight">
              📄 HWPX 치환자 데모
            </Link>
            <div className="flex gap-1">
              <Link href="/admin" className="px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 text-gray-600 transition-colors">
                관리자
              </Link>
              <Link href="/apply" className="px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 text-gray-600 transition-colors">
                신청서 작성
              </Link>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
