import Link from 'next/link'

export default function Home() {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="text-5xl mb-6">📄</div>
      <h1 className="text-3xl font-bold mb-3 text-gray-900">HWPX 치환자 자동화</h1>
      <p className="text-gray-500 mb-10 leading-relaxed">
        hwpx 신청서를 업로드하면 Claude AI가 입력 필드를 자동으로 감지하고<br />
        모바일/웹에서 작성 가능한 폼을 생성합니다.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-10">
        {[
          { step: '01', title: 'hwpx 업로드', desc: '관리자가 원본 신청서 파일 업로드', icon: '⬆️' },
          { step: '02', title: 'AI 분석', desc: 'Claude가 빈칸을 찾아 치환자 자동 생성', icon: '🤖' },
          { step: '03', title: '폼 생성', desc: '치환자 기반 입력 폼이 자동으로 완성', icon: '📋' },
          { step: '04', title: 'hwpx 다운로드', desc: '작성된 내용이 반영된 hwpx 파일 저장', icon: '⬇️' },
        ].map(item => (
          <div key={item.step} className="card p-5 text-left">
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="text-xs text-brand-500 font-mono mb-1">STEP {item.step}</div>
            <div className="font-semibold text-sm mb-1">{item.title}</div>
            <div className="text-xs text-gray-500">{item.desc}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 justify-center">
        <Link href="/admin" className="btn-primary">
          관리자 — 신청서 등록
        </Link>
        <Link href="/apply" className="btn-secondary">
          신청서 작성하기
        </Link>
      </div>
    </div>
  )
}
