// ================================================================
// 파일명  : auth.js
// 위치    : src/routes/auth.js
// 역할    : 회원가입(이메일 인증 포함), 로그인, 회원탈퇴 API
//
// [쉬운 설명]
// 사용자가 서비스에 가입하고, 로그인하고, 탈퇴하는 모든 과정을 처리하는 파일
// 경성대 이메일(@ks.ac.kr)만 가입 가능하도록 이메일 인증도 포함
// ================================================================

// express: 웹 서버 프레임워크
// Router: URL 경로를 관리하는 "URL 안내판" 객체
const express = require('express')

// bcryptjs: 비밀번호를 안전하게 암호화하는 도구
// 비밀번호를 그대로 저장하면 DB 해킹 시 노출되므로
// 알아볼 수 없는 암호문(해시)으로 변환해서 저장함
const bcrypt = require('bcryptjs')

// jsonwebtoken: JWT(로그인 증명서) 토큰을 만들고 검증하는 도구
// JWT = JSON Web Token = 로그인 성공 시 발급되는 디지털 출입증
// 이 토큰을 가지고 있으면 매번 재로그인 없이 API를 사용할 수 있음
const jwt = require('jsonwebtoken')

// Render 무료 플랜에서는 SMTP 포트가 막힐 수 있어
// SMTP 대신 Brevo Transactional Email API(HTTPS)로 인증 메일을 발송한다.
async function sendVerificationEmail(email, code) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: 'CodeCollab',
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [
        {
          email,
        },
      ],
      subject: '[CodeCollab] 이메일 인증 코드',
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <h2 style="color:#4F46E5">CodeCollab 이메일 인증</h2>
        <p>아래 인증 코드를 입력해주세요.</p>
        <div style="background:#F3F4F6;padding:20px;border-radius:8px;text-align:center;margin:20px 0">
          <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#4F46E5">${code}</span>
        </div>
        <p style="color:#6B7280;font-size:13px">이 코드는 10분간 유효합니다.</p>
      </div>`,
    }),
  })

  const resultText = await response.text()

  // Brevo API가 실패하면 프론트에 성공 메시지를 보내지 않도록 에러 처리한다.
  if (!response.ok) {
    console.error('Brevo email error:', response.status, resultText)
    throw new Error(`Brevo email send failed: ${response.status}`)
  }

  // 발송 성공 시 Render 로그에서 확인할 수 있도록 결과를 반환한다.
  return resultText ? JSON.parse(resultText) : null
}

// pool: DB 연결 풀 (db/index.js에서 가져옴)
// ../db 는 한 단계 위 폴더(src)의 db 폴더를 의미
const { pool } = require('../db')

// authMiddleware: JWT 토큰을 검사하는 미들웨어 (middleware/auth.js에서 가져옴)
// 로그인이 필요한 API에 붙여서 인증되지 않은 요청을 막음
const authMiddleware = require('../middleware/auth')

// Router 인스턴스 생성
// 이 router 객체에 각 URL 경로를 등록함
const router = express.Router()

// ──────────────────────────────
// ──────────────────────────────────
// 6자리 인증 코드 생성 함수
// Math.random() = 0이상 1미만의 랜덤 소수 생성
// * 900000 후 + 100000 → 100000 ~ 999999 범위의 정수
// .toString() = 숫자를 문자열로 변환 (앞자리 0 보존을 위해)
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ────────────────────────────────────────────────────────────────
// API 1: 이메일 인증 코드 발송
// URL: POST /api/auth/send-code
// 요청 body: { email: '학번@ks.ac.kr' }
// ────────────────────────────────────────────────────────────────
router.post('/send-code', async (req, res) => {

  // req.body에서 email 꺼냄
  // { email } = req.body 는 req.body.email을 바로 꺼내는 구조분해할당
  const { email } = req.body

  // @ks.ac.kr로 끝나는 이메일인지 확인
  // !email = 이메일이 없음
  // !email.endsWith('@ks.ac.kr') = @ks.ac.kr로 끝나지 않음
  if (!email || !email.endsWith('@ks.ac.kr')) {
    // 400 = Bad Request = 잘못된 요청 (클라이언트가 잘못 보냄)
    return res.status(400).json({ error: '경성대학교 이메일(@ks.ac.kr)만 사용 가능합니다' })
  }

  // 이미 가입된 이메일인지 DB에서 확인
  // $1 = 첫 번째 파라미터 자리 = email 값이 들어감
  // 파라미터화 쿼리 방식: SQL Injection(해킹 기법) 방지를 위해 값을 직접 넣지 않음
  const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email])

  // exists.rows = 조회 결과 배열
  // .length > 0 = 조회된 행이 1개 이상 = 이미 존재함
  if (exists.rows.length > 0) {
    return res.status(400).json({ error: '이미 사용 중인 이메일입니다' })
  }

  try {
    // 6자리 인증 코드 생성
    const code = generateCode()

    // 만료 시각 계산: 현재 시각 + 10분
    // Date.now() = 현재 시각 (밀리초 단위)
    // 10 * 60 * 1000 = 10분을 밀리초로 표현 (10분 × 60초 × 1000밀리초)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // 이 이메일로 이전에 발송한 코드가 있으면 삭제
    // 코드 재발송 시 이전 코드가 남아있지 않도록 정리
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [email])

    // 새 인증 코드를 DB에 저장
    // $1=email, $2=code, $3=expiresAt 순서로 대응
    await pool.query(
      'INSERT INTO email_verifications (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    )

    // Brevo API를 사용해 이메일 인증번호 발송
    const brevoResult = await sendVerificationEmail(email, code)

    // Brevo 발송 성공 시 결과를 Render 로그에 남긴다.
    console.log('Brevo email sent:', brevoResult)

    // 발송 성공 응답
    res.json({ message: '인증 코드를 발송했습니다' })

  } catch (e) {
    // 이메일 발송 실패 시 (잘못된 이메일 주소, 네트워크 오류 등)
    console.error(e)
    res.status(500).json({ error: '이메일 발송 실패. 이메일 주소를 확인해주세요.' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 2: 인증 코드 확인
// URL: POST /api/auth/verify-code
// 요청 body: { email: '학번@ks.ac.kr', code: '123456' }
// ────────────────────────────────────────────────────────────────
router.post('/verify-code', async (req, res) => {
  const { email, code } = req.body

  if (!email || !code) return res.status(400).json({ error: '이메일과 코드를 입력하세요' })

  try {
    // DB에서 이 이메일 + 코드 조합의 미사용 코드를 조회
    // AND used = FALSE: 이미 사용된 코드는 조회 안 됨 (재사용 방지)
    const result = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND code = $2 AND used = FALSE',
      [email, code]
    )

    // 조회 결과의 첫 번째 행
    const record = result.rows[0]

    // 코드가 없음 = 틀린 코드이거나 이미 사용된 코드
    if (!record) return res.status(400).json({ error: '코드가 올바르지 않습니다' })

    // 현재 시각이 만료 시각을 넘었는지 확인
    // new Date() = 현재 시각
    // new Date(record.expires_at) = DB에 저장된 만료 시각
    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ error: '코드가 만료되었습니다. 다시 발송해주세요.' })
    }

    // 코드 사용 처리: used = TRUE 로 업데이트
    // 이후 같은 코드로 재인증 시도 불가
    await pool.query('UPDATE email_verifications SET used = TRUE WHERE id = $1', [record.id])

    // 인증 성공 응답
    res.json({ verified: true })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 3: 회원가입
// URL: POST /api/auth/register
// 요청 body: { studentId, name, password, email }
// ────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  // 요청 body에서 4가지 값을 꺼냄
  const { studentId, name, password, email } = req.body

  // 하나라도 빠진 항목이 있으면 에러
  if (!studentId || !name || !password || !email) {
    return res.status(400).json({ error: '모든 항목을 입력하세요' })
  }

  // 이메일이 @ks.ac.kr로 끝나는지 재확인 (API 직접 호출 방어)
  if (!email.endsWith('@ks.ac.kr')) {
    return res.status(400).json({ error: '경성대학교 이메일(@ks.ac.kr)만 사용 가능합니다' })
  }

  try {
    // 이메일 인증을 완료한 기록이 있는지 확인
    // used = TRUE: 인증 코드를 성공적으로 검증한 기록
    const verified = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND used = TRUE',
      [email]
    )

    // 인증 완료 기록이 없으면 가입 거부
    // 이메일 인증 없이 /register를 직접 호출하는 것을 방어
    if (verified.rows.length === 0) {
      return res.status(400).json({ error: '이메일 인증을 먼저 완료해주세요' })
    }

    // 학번 중복 확인
    const dupStudent = await pool.query('SELECT id FROM users WHERE student_id = $1', [studentId])
    if (dupStudent.rows.length > 0) return res.status(400).json({ error: '이미 사용 중인 학번입니다' })

    // 이메일 중복 확인
    const dupEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (dupEmail.rows.length > 0) return res.status(400).json({ error: '이미 사용 중인 이메일입니다' })

    // 비밀번호를 bcrypt로 해시화 (암호화)
    // bcrypt.hash(원본비밀번호, 솔트라운드)
    // 솔트라운드 = 10: 암호화 복잡도. 높을수록 안전하지만 느림. 10이 적당한 권장값.
    // await = 해시 계산이 완료될 때까지 기다림 (시간이 걸리는 작업)
    const passwordHash = await bcrypt.hash(password, 10)

    // 유저를 DB에 저장
    // RETURNING = 삽입된 행의 지정 컬럼값을 바로 돌려줌
    const result = await pool.query(
      'INSERT INTO users (student_id, name, password_hash, email, is_verified) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, student_id, name, email',
      [studentId, name, passwordHash, email]
    )

    // 저장된 유저 데이터를 꺼냄
    const user = result.rows[0]

    // JWT 토큰 발급
    // jwt.sign(페이로드, 시크릿키, 옵션)
    // 페이로드 = 토큰 안에 담을 데이터 (userId, name, studentId)
    // 시크릿키 = 토큰 서명에 사용하는 비밀 키 (.env에 저장)
    // expiresIn: '7d' = 7일 후 만료
    const token = jwt.sign(
      { userId: user.id, name: user.name, studentId: user.student_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    // 201 Created: 새 자원(유저)이 성공적으로 생성됨을 알리는 상태코드
    // 토큰과 유저 기본 정보를 응답으로 전송
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, studentId: user.student_id, email: user.email }
    })

  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 4: 로그인
// URL: POST /api/auth/login
// 요청 body: { studentId, password }
// ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { studentId, password } = req.body

  if (!studentId || !password) return res.status(400).json({ error: '학번과 비밀번호를 입력하세요' })

  try {
    // 학번으로 유저 조회
    const result = await pool.query('SELECT * FROM users WHERE student_id = $1', [studentId])
    const user = result.rows[0]  // 첫 번째(유일한) 결과

    // 유저가 없거나, 비밀번호가 틀렸을 때
    // bcrypt.compare(입력한비밀번호, 저장된해시) → 일치하면 true
    // ! 앞에 붙여서 불일치할 때 조건 성립
    // 보안상 "학번 없음"인지 "비밀번호 틀림"인지 구분하지 않음
    // (구분하면 해커가 어떤 학번이 있는지 알 수 있음)
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: '학번 또는 비밀번호가 틀렸습니다' })
    }

    // JWT 토큰 발급
    const token = jwt.sign(
      { userId: user.id, name: user.name, studentId: user.student_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    // 로그인 성공: 토큰과 유저 정보 응답
    res.json({ token, user: { id: user.id, name: user.name, studentId: user.student_id, email: user.email } })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 5: 회원 탈퇴
// URL: DELETE /api/auth/me
// 인증 필요: authMiddleware (로그인한 본인만 탈퇴 가능)
// ────────────────────────────────────────────────────────────────
// authMiddleware가 먼저 실행되어 토큰 검증 후 req.user에 유저 정보 저장
// 그 다음 실제 탈퇴 처리 함수가 실행됨
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    // req.user.userId = authMiddleware가 저장한 현재 유저의 ID
    // 이 ID로 유저를 삭제하면 ON DELETE CASCADE 설정 덕분에
    // 그 유저의 댓글, 알림 등도 자동으로 삭제됨
    await pool.query('DELETE FROM users WHERE id = $1', [req.user.userId])

    res.json({ message: '회원 탈퇴가 완료되었습니다' })

  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ────────────────────────────────────────────────────────────────
// API 6: 내 정보 조회
// URL: GET /api/auth/me
// ────────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // password_hash는 응답에 포함하지 않음 (보안상 절대 클라이언트에 전송 금지)
    const result = await pool.query(
      'SELECT id, student_id, name, email, is_verified, created_at FROM users WHERE id = $1',
      [req.user.userId]
    )
    res.json(result.rows[0])
  } catch (e) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// 이 라우터를 외부에서 사용할 수 있게 내보냄
// index.js에서: app.use('/api/auth', authRoutes) 로 연결됨
// 즉, 이 파일의 '/login' 경로 → 실제로는 '/api/auth/login' 이 됨
module.exports = router
