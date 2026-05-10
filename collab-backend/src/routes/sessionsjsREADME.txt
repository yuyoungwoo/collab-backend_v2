================================================================
 파일명  : sessions.js
 위치    : src/routes/sessions.js
 만든 이유: 코드 리뷰 세션 생성/조회, 댓글 등록 API 처리
================================================================

[ sessions.js ]

"세션"은 코드 리뷰를 위해 만드는 공간(Room)
세션을 만들고, 목록을 보고, 댓글을 달고,
@멘션 시 알림을 자동 생성하는 기능을 담당

index.js가 복잡해지지 않기 위해 세션 관련 로직을 해당 파일에 하나로 모음



[ 핵심 용어 설명 ]

▶ REST API
   - REpresentational State Transfer
   - URL과 HTTP 메서드로 자원을 표현하는 API 설계 방식
   - GET /api/sessions       → 세션 목록 조회
   - GET /api/sessions/:id   → 특정 세션 조회
   - POST /api/sessions      → 세션 생성
   - PATCH /api/sessions/:id/code → 코드 저장

▶ :id (URL 파라미터)
   - URL 경로의 일부를 변수처럼 쓰는 것
   - /api/sessions/:id 에서 :id는 실제 세션 ID가 들어옴
   - req.params.id로 꺼낼 수 있음

▶ LEFT JOIN
   - SQL 조인 방식: 왼쪽 테이블의 모든 행 + 오른쪽 테이블의 일치하는 행
   - 일치하는 게 없어도 왼쪽 데이터는 NULL로 표시되며 남아있음
   - 예) 세션 작성자가 탈퇴해도 세션은 표시됨 (author_name만 null)

▶ 서브쿼리 (Subquery)
   - SQL 안에 또 다른 SQL이 들어가는 것
   - (SELECT COUNT(*) FROM comments WHERE session_id = s.id)
   - 각 세션마다 댓글 수를 계산하기 위해 사용

▶ @멘션 감지
   - 댓글 내용에서 @이름 패턴을 정규식으로 찾음
   - 정규식(Regular Expression): 문자열에서 패턴을 찾는 도구
   - /@(\S+)/g = @로 시작하고 공백이 아닌 문자들을 찾는 패턴
   - 찾으면 해당 유저에게 자동으로 알림 생성

▶ ILIKE
   - PostgreSQL의 대소문자 무시 LIKE
   - LIKE: 패턴 매칭 (대소문자 구별)
   - ILIKE: 패턴 매칭 (대소문자 무시) → 검색에 유용

================================================================
