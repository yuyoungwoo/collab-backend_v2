// ================================================================
// 파일명  : auth.js
// 위치    : src/middleware/auth.js
// 역할    : JWT 토큰을 검사하는 "중간 검사기 (미들웨어)"
//
// [쉬운 설명]
// 로그인이 필요한 API에 이 미들웨어를 붙이면,
// 토큰 없는 사람은 자동으로 막히고
// 토큰 있는 사람만 실제 기능을 쓸 수 있어요.
// 마치 클럽 입구의 경비원 같은 역할이에요.
// ================================================================

// jsonwebtoken 라이브러리를 가져옴
// JWT(JSON Web Token) = 로그인 증명서 역할을 하는 암호화된 문자열
// 예) "eyJhbGci..." 이런 긴 문자열이 JWT임
// 이 라이브러리로 토큰이 진짜인지, 만료됐는지 확인할 수 있음
const jwt = require('jsonwebtoken')

// authMiddleware = 인증 미들웨어 함수
// 미들웨어란? → 요청이 실제 처리되기 전에 중간에서 먼저 실행되는 함수
// req  = Request  = 클라이언트(브라우저)가 보낸 요청 정보 전체
// res  = Response = 서버가 클라이언트에게 보낼 응답 객체
// next = 다음 단계(실제 API 처리 함수)로 넘어가는 함수
//        next()를 호출해야만 다음으로 진행됨
function authMiddleware(req, res, next) {

  // req.headers.authorization = 요청 헤더의 "Authorization" 값
  // 프론트에서 API 요청할 때 헤더에 이렇게 담아서 보냄:
  // "Authorization: Bearer eyJhbGci..." (Bearer = "이 토큰을 가진 사람"이란 뜻)
  const header = req.headers.authorization

  // 헤더가 아예 없거나, "Bearer "로 시작하지 않으면 → 인증 실패
  // !header = 헤더가 없음 (undefined, null, 빈문자열)
  // !header.startsWith('Bearer ') = "Bearer "로 시작하지 않음
  if (!header || !header.startsWith('Bearer ')) {
    // res.status(401) = HTTP 상태코드 401 설정
    // 401 = Unauthorized = "인증 안 됨" = 로그인이 필요하다는 뜻
    // .json({ error: '...' }) = JSON 형태로 에러 메시지 응답
    // return을 붙여서 함수를 즉시 종료 (next() 호출 안 함)
    return res.status(401).json({ error: '토큰이 없습니다' })
  }

  // "Bearer eyJhbGci..."를 공백으로 쪼개면 ['Bearer', 'eyJhbGci...']
  // [1]은 두 번째 요소 = 실제 토큰값만 꺼냄
  // split(' ') = 공백을 기준으로 문자열을 배열로 나눔
  const token = header.split(' ')[1]

  try {
    // jwt.verify(토큰, 시크릿키)
    // → 토큰이 우리 서버에서 발급한 진짜 토큰인지 검증
    // → 검증 성공하면 토큰 안에 담긴 데이터(userId, name 등)를 반환
    // process.env.JWT_SECRET = .env 파일에 저장한 비밀 키
    // 이 비밀 키로 서명했기 때문에 위조된 토큰은 검증 실패함
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    // req.user에 저장된 값 예시:
    // { userId: 'abc-123', name: '홍길동', studentId: '20231234' }
    // 이후 라우트 핸들러에서 req.user.userId 이런 식으로 사용 가능

    // 검증 통과! → next()로 실제 API 처리 함수로 넘어감
    next()

  } catch (e) {
    // jwt.verify가 실패할 때 = 토큰이 만료됐거나 위조됐을 때
    // catch(e) = 에러를 잡아서 처리
    return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다' })
  }
}

// 이 함수를 다른 파일에서 불러다 쓸 수 있게 내보냄
// 다른 파일에서: const authMiddleware = require('../middleware/auth')
// 라우트에 붙일 때: router.get('/경로', authMiddleware, 핸들러함수)
module.exports = authMiddleware
