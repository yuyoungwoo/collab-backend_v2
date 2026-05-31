// ================================================================
// 파일명  : index.js
// 위치    : src/db/index.js
// 역할    : PostgreSQL 데이터베이스 연결 & 테이블 자동 생성
//
// [쉬운 설명]
// 이 파일은 우리 서비스의 "데이터 창고(DB)"에 연결하고,
// 창고 안에 필요한 "선반(테이블)"들을 자동으로 만들어줘요.
// 서버가 시작될 때 딱 한 번 실행됩니다.
// ================================================================

// pg 라이브러리에서 Pool 클래스를 가져옴
// pg = node-postgres = Node.js에서 PostgreSQL을 쓸 수 있게 해주는 도구
// Pool = "연결 풀" = DB 연결을 미리 여러 개 만들어두는 연결 대기실
//        요청마다 새 연결을 맺으면 느리므로, 미리 만든 연결을 재사용함
const { Pool } = require('pg')

// 새 연결 풀 생성
// process.env.XXX = .env 파일에서 읽어온 환경변수
// 비밀번호 같은 민감한 정보를 코드에 직접 쓰지 않기 위해 .env에 따로 저장
const pool = new Pool({
  host:     process.env.DB_HOST,     // DB 서버 주소 (보통 localhost)
  port:     process.env.DB_PORT,     // DB 포트 번호 (PostgreSQL 기본: 5432)
  database: process.env.DB_NAME,     // 접속할 DB 이름 (우리는 collab_code)
  user:     process.env.DB_USER,     // DB 접속 계정 (보통 postgres)
  password: process.env.DB_PASSWORD, // DB 비밀번호 (.env에서 가져옴)

  // Neon 같은 외부 PostgreSQL 서비스는 보안 연결(SSL)을 요구함.
  // 로컬 DB는 SSL 없이도 연결되지만, 배포 환경(Render → Neon)에서는
  // SSL 옵션이 없으면 "connection is insecure" 오류가 발생할 수 있음.
  // rejectUnauthorized: false는 Neon의 인증서 검증 문제로 연결이 막히지 않도록 설정하는 옵션임.
  ssl: {
    rejectUnauthorized: false
  }
});

// initDB = initialize Database = 데이터베이스 초기화 함수
// async = 이 함수 안에 비동기 작업(await)이 있다는 표시
// 비동기 = 결과가 올 때까지 기다리는 방식 (DB 작업은 시간이 걸리므로 필요)
async function initDB() {

  // pool.connect() = 연결 풀에서 DB 연결 하나를 빌려옴
  // await = 연결이 완료될 때까지 기다림
  const client = await pool.connect()

  try {
    // client.query() = SQL 명령을 DB에 전송
    // 백틱(`)으로 감싸서 여러 줄 SQL을 한 번에 작성
    await client.query(`

      -- ▼ users 테이블: 회원 정보 저장
      -- IF NOT EXISTS: 이미 테이블이 있으면 무시 (서버 재시작해도 안 지워짐)
      CREATE TABLE IF NOT EXISTS users (

        -- id: 기본키(Primary Key) = 각 행을 구별하는 고유 번호
        -- UUID = 랜덤하게 생성되는 전 세계 유일한 ID (예: 550e8400-e29b...)
        -- DEFAULT gen_random_uuid() = 값을 안 넣으면 자동으로 UUID 생성
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- student_id: 학번
        -- VARCHAR(20) = 최대 20자짜리 문자열
        -- UNIQUE = 같은 학번으로 중복 가입 불가
        -- NOT NULL = 반드시 값이 있어야 함 (빈 값 저장 불가)
        student_id    VARCHAR(20) UNIQUE NOT NULL,

        name          VARCHAR(50) NOT NULL,       -- 이름 (최대 50자, 필수)
        password_hash TEXT NOT NULL,              -- 암호화된 비밀번호 (원본은 저장 안 함!)
        email         VARCHAR(100) UNIQUE,        -- 이메일 (중복 불가, NULL 허용)
        is_verified   BOOLEAN DEFAULT FALSE,      -- 이메일 인증 여부 (기본값: 미인증)
        created_at    TIMESTAMP DEFAULT NOW()     -- 가입 일시 (NOW()=현재시각 자동 저장)
      );

      -- ▼ email_verifications 테이블: 이메일 인증 코드 임시 저장
      -- 인증 완료 후에는 used = TRUE로 표시해서 재사용 방지
      CREATE TABLE IF NOT EXISTS email_verifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email      VARCHAR(100) NOT NULL,   -- 인증 요청한 이메일
        code       VARCHAR(6) NOT NULL,     -- 발송된 6자리 인증 코드
        expires_at TIMESTAMP NOT NULL,      -- 코드 만료 시각 (발송 후 10분)
        used       BOOLEAN DEFAULT FALSE,   -- 사용 여부 (사용됨=TRUE, 재사용 불가)
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- ▼ sessions 테이블: 코드 리뷰 세션(방) 정보
      CREATE TABLE IF NOT EXISTS sessions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(200) NOT NULL,            -- 세션 제목
        language    VARCHAR(30) DEFAULT 'javascript', -- 코딩 언어 (기본: javascript)
        code        TEXT DEFAULT '',                  -- 현재 에디터 코드 전체 (TEXT = 길이 무제한)
        is_active   BOOLEAN DEFAULT TRUE,             -- 활성 여부
        -- REFERENCES users(id) = 외래키: users 테이블의 id를 참조
        -- 세션을 만든 사람이 탈퇴하면 author_id가 NULL이 됨
        author_id   UUID REFERENCES users(id),
        created_at  TIMESTAMP DEFAULT NOW()
      );

      -- ▼ session_permissions 테이블: 세션별 편집 권한
      -- 누가 이 세션의 코드를 수정할 수 있는지 기록
      CREATE TABLE IF NOT EXISTS session_permissions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- ON DELETE CASCADE = 세션이 삭제되면 이 권한 정보도 자동 삭제
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
        user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
        can_edit   BOOLEAN DEFAULT FALSE,  -- 편집 권한 (기본: 읽기 전용)
        -- UNIQUE(session_id, user_id) = 같은 세션+유저 조합은 중복 불가
        -- 한 유저가 한 세션에 권한 1개만 가질 수 있음
        UNIQUE(session_id, user_id)
      );

      -- ▼ comments 테이블: 코드 리뷰 댓글
      CREATE TABLE IF NOT EXISTS comments (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE, -- 세션 삭제 시 댓글도 삭제
        author_id   UUID REFERENCES users(id),
        line_number INT,        -- 댓글 단 줄 번호 (NULL 가능 = 전체 코드에 대한 댓글)
        content     TEXT NOT NULL,          -- 댓글 내용
        created_at  TIMESTAMP DEFAULT NOW()
      );

      -- ▼ snippets 테이블: 저장된 코드 조각
      CREATE TABLE IF NOT EXISTS snippets (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(200) NOT NULL,
        code        TEXT NOT NULL,
        language    VARCHAR(30),
        -- TEXT[] = 문자열 배열 타입 (PostgreSQL 전용)
        -- 예) {'알고리즘', '정렬', '재귀'}
        tags        TEXT[],
        author_id   UUID REFERENCES users(id),
        created_at  TIMESTAMP DEFAULT NOW()
      );

      -- ▼ notifications 테이블: 알림 (멘션, 권한 변경 등)
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- ON DELETE CASCADE = 유저 탈퇴 시 그 유저의 알림도 자동 삭제
        user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
        type       VARCHAR(50) NOT NULL,  -- 알림 종류 ('mention', 'permission' 등)
        message    TEXT NOT NULL,         -- 알림 내용 텍스트
        link       TEXT,                  -- 클릭 시 이동할 URL (없을 수도 있어서 NULL 허용)
        is_read    BOOLEAN DEFAULT FALSE, -- 읽음 여부 (기본: 안 읽음 = 빨간 뱃지 표시)
        created_at TIMESTAMP DEFAULT NOW()
      );
    `)
    // 테이블 생성 완료 시 서버 콘솔에 성공 메시지 출력
    console.log('✅ DB 테이블 준비 완료')

  } finally {
    // finally = try 성공이든 실패든 반드시 실행되는 블록
    // client.release() = 빌린 DB 연결을 풀에 반납
    // 반납 안 하면 연결이 고갈돼서 서버가 DB에 접근 못하게 됨!
    client.release()
  }
}

// pool과 initDB를 외부에서 쓸 수 있게 내보냄
// 다른 파일에서: const { pool } = require('../db')  → pool 사용
//               const { initDB } = require('../db') → initDB 사용
module.exports = { pool, initDB }
