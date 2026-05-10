# CodeCollab 백엔드

## 실행 전 필수 준비

### 1. PostgreSQL 설치
https://www.postgresql.org/download/ 에서 설치

설치 후 DB 생성:
```
psql -U postgres
CREATE DATABASE collab_code;
\q
```

### 2. .env 파일 수정
DB_PASSWORD 를 PostgreSQL 설치 시 설정한 비밀번호로 변경

## 실행 방법

```bash
npm install
npm run dev
```

서버가 http://localhost:3000 에서 실행됩니다.

## API 목록

| Method | URL | 설명 |
|--------|-----|------|
| POST | /api/auth/register | 회원가입 |
| POST | /api/auth/login | 로그인 |
| GET | /api/sessions | 세션 목록 |
| POST | /api/sessions | 세션 생성 |
| GET | /api/sessions/:id | 세션 상세 |
| GET | /api/sessions/:id/comments | 댓글 목록 |
| POST | /api/sessions/:id/comments | 댓글 등록 |
| GET | /api/snippets | 스니펫 목록 |
| POST | /api/snippets | 스니펫 저장 |
| DELETE | /api/snippets/:id | 스니펫 삭제 |
