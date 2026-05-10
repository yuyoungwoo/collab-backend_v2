================================================================
 파일명  : index.js
 위치    : src/db/index.js
 만든 이유: 데이터베이스 연결 및 테이블 자동 생성
================================================================

[ index.js ]

우리 서비스의 모든 데이터(유저, 세션, 댓글, 스니펫 등)는
PostgreSQL 데이터베이스에 저장

이 파일은 두 가지를 담당해요:
1. PostgreSQL에 연결하는 "연결 풀" 생성
2. 서버 시작 시 필요한 테이블을 자동으로 만들어줌

DB 연결 코드를 여기 한 곳에 모아두면,
다른 파일에서 require('../db')만 하면 어디서든 DB를 쓸 수 있음.



[ 핵심 용어 설명 ]

▶ PostgreSQL (포스트그레SQL)
   - 오픈소스 관계형 데이터베이스 관리 시스템
   - 쉽게 말하면: 엑셀처럼 표 형태로 데이터를 저장하는 창고
   - 우리가 만든 collab_code 라는 이름의 DB에 데이터를 저장함

▶ Connection Pool (연결 풀)
   - 쉽게 말하면: DB 연결을 미리 여러 개 만들어두는 "연결 대기실"
   - 요청마다 새 연결을 맺으면 느리고 비효율적임
   - Pool을 쓰면 미리 만들어둔 연결을 재사용해서 빠름

▶ SQL (Structured Query Language)
   - 데이터베이스에 명령을 내리는 언어
   - CREATE TABLE = 테이블 만들기
   - INSERT INTO = 데이터 넣기
   - SELECT = 데이터 조회
   - UPDATE = 데이터 수정
   - DELETE = 데이터 삭제

▶ UUID (Universally Unique Identifier)
   - 쉽게 말하면: 전 세계에서 유일한 랜덤 ID
   - 예) "550e8400-e29b-41d4-a716-446655440000"
   - 1, 2, 3 같은 숫자 ID 대신 쓰는 이유:
     숫자는 예측 가능해서 보안에 취약함.
     UUID는 랜덤이라 누가 몇 번째 유저인지 알 수 없음.

▶ NOT NULL
   - SQL 제약 조건: 이 컬럼은 반드시 값이 있어야 함
   - 빈 값(NULL)으로 저장하면 에러 발생

▶ UNIQUE
   - SQL 제약 조건: 이 컬럼의 값은 테이블에서 중복될 수 없음
   - 예) student_id UNIQUE → 같은 학번으로 2번 가입 불가

▶ REFERENCES
   - 외래키(Foreign Key): 다른 테이블의 값을 참조
   - 예) author_id REFERENCES users(id)
     → author_id는 반드시 users 테이블의 id 중 하나여야 함

▶ ON DELETE CASCADE
   - 참조하는 데이터가 삭제되면 이 데이터도 자동으로 삭제
   - 예) 유저가 탈퇴하면 → 그 유저의 댓글도 자동 삭제
   - 이걸 안 쓰면 유저 삭제 시 댓글이 고아 데이터로 남음

▶ DEFAULT
   - 값을 넣지 않았을 때 자동으로 들어가는 기본값
   - DEFAULT FALSE → 기본값이 false
   - DEFAULT NOW() → 기본값이 현재 시각



[ 코드 흐름 ]

1. pg 라이브러리로 PostgreSQL 연결 풀 생성
2. initDB() 함수: 서버 시작 시 한 번 호출됨
3. 7개 테이블을 IF NOT EXISTS로 생성 (이미 있으면 무시)
4. 완료 후 pool과 initDB를 내보냄



[ 테이블 구조 요약 ]

users              → 유저 정보 (학번, 이름, 비밀번호 해시, 이메일)
email_verifications → 이메일 인증 코드 임시 저장
sessions           → 코드 리뷰 세션(방) 정보
session_permissions → 세션별 편집 권한
comments           → 코드 리뷰 댓글
snippets           → 저장된 코드 스니펫
notifications      → 알림 (멘션, 권한 변경 등)



[ 이 파일에서 사용하는 라이브러리 ]

▶ pg (node-postgres)
   - npm 패키지명: pg
   - 설치: npm install pg
   - 역할: Node.js에서 PostgreSQL에 연결하는 공식 드라이버
   - Pool 클래스: DB 연결을 여러 개 관리하는 연결 풀
   - pool.query('SQL문') → SQL 실행 후 결과 반환

================================================================
