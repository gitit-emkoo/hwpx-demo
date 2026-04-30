# HWPX 치환자 데모

hwpx 신청서를 업로드하면 Claude AI가 입력 필드를 자동 감지하고, 웹 폼으로 작성 후 hwpx로 다운로드하는 시스템입니다.

## 기술 스택

- **Frontend/Backend**: Next.js 14 (App Router) + TypeScript
- **DB/Storage**: Firebase Firestore + Firebase Storage
- **AI**: Anthropic Claude API
- **배포**: Vercel

---

## 1단계 — Firebase 프로젝트 생성

1. https://console.firebase.google.com 접속 → **새 프로젝트 만들기**
2. 프로젝트 이름 입력 (예: `hwpx-demo`)
3. Google Analytics는 선택 사항 → **프로젝트 만들기**

### Firestore 활성화
- 좌측 **Firestore Database** → **데이터베이스 만들기**
- **테스트 모드**로 시작 (30일 후 규칙 수정 필요)
- 리전: `asia-northeast3` (서울) 권장

### Storage 활성화
- 좌측 **Storage** → **시작하기**
- **테스트 모드**로 시작
- 리전: `asia-northeast3`

### 웹 앱 등록 (클라이언트 키)
- 프로젝트 설정 → **앱 추가** → 웹(`</>`)
- 앱 이름 입력 → **Firebase SDK 구성** 복사

### 서비스 계정 키 (서버용)
- 프로젝트 설정 → **서비스 계정** → **새 비공개 키 생성** → JSON 다운로드

---

## 2단계 — 환경 변수 설정

`.env.local.example`을 복사해서 `.env.local` 생성:

```bash
cp .env.local.example .env.local
```

값을 채워넣기:

```env
# Firebase 웹 앱 설정에서 복사
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=hwpx-demo.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=hwpx-demo
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=hwpx-demo.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123...

# 서비스 계정 JSON에서 복사
FIREBASE_PROJECT_ID=hwpx-demo
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@hwpx-demo.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Anthropic API 키
ANTHROPIC_API_KEY=sk-ant-...
```

> ⚠️ `FIREBASE_PRIVATE_KEY`는 줄바꿈을 `\n`으로 표현해야 합니다.
> JSON 파일에서 복사할 때 큰따옴표로 감싸주세요.

---

## 3단계 — 로컬 실행

```bash
npm install
npm run dev
```

http://localhost:3000 접속

---

## 4단계 — Vercel 배포

### GitHub에 푸시
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_ID/hwpx-demo.git
git push -u origin main
```

### Vercel 연결
1. https://vercel.com → **Add New Project**
2. GitHub 저장소 선택
3. **Environment Variables**에 `.env.local` 내용 모두 입력
4. **Deploy** 클릭

> ⚠️ Vercel에서 `FIREBASE_PRIVATE_KEY` 입력 시:
> - 값에서 `\n`을 **실제 줄바꿈**으로 바꿔서 입력하거나
> - 큰따옴표 없이 raw 값으로 입력

---

## 프로젝트 구조

```
src/
├── app/
│   ├── page.tsx              # 홈
│   ├── admin/page.tsx        # 관리자 (업로드 + AI 분석)
│   ├── apply/page.tsx        # 유저 (폼 작성 + 다운로드)
│   └── api/
│       ├── upload/route.ts   # hwpx 업로드 + Claude 분석
│       ├── templates/        # 템플릿 CRUD
│       └── download/route.ts # 치환자 적용 + hwpx 반환
├── lib/
│   ├── firebase.ts           # 클라이언트 Firebase
│   ├── firebase-admin.ts     # 서버 Firebase Admin
│   ├── hwpx.ts               # hwpx 파싱 + 치환자 적용
│   └── types.ts              # 공통 타입
```

## 동작 흐름

```
관리자
 ① hwpx 업로드
 ② 서버: JSZip으로 XML 추출 → 텍스트 파싱
 ③ Claude API: "빈칸을 {{치환자}}로 바꿔줘" → JSON 반환
 ④ Firestore에 템플릿 저장, Storage에 원본 hwpx 저장
 ⑤ 관리자가 레이블·타입 수정 후 확정

유저
 ① 신청서 목록에서 선택
 ② 치환자 기반 자동 생성 폼 작성
 ③ 서버: Storage에서 원본 hwpx → XML 내 {{치환자}} replace
 ④ 완성된 hwpx 파일 다운로드
```
