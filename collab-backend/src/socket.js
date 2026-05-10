// ================================================================
// 파일명  : socket.js
// 위치    : src/socket.js
// 역할    : 실시간 코드 동기화, 권한 체크, 알림 전송
//
// [쉬운 설명]
// 일반 API는 "요청하면 응답" 방식이지만,
// 이 파일은 WebSocket을 이용해서 서버가 먼저 데이터를 보낼 수 있어요.
// 코드 입력 → 서버 → 다른 참여자 화면에 즉시 반영이 여기서 이루어져요.
// ================================================================

// JWT 토큰 검증 도구
const jwt = require('jsonwebtoken')

// DB 연결 풀 (db/index.js에서 가져옴)
const { pool } = require('./db')

// rooms = 룸별 참여자 목록 저장 Map
// Map은 key-value 구조: { '룸ID' → Set([{socketId, userId, name}, ...]) }
// 예) rooms.get('session-abc') → Set([{유저A}, {유저B}])
const rooms = new Map()

// userSockets = 유저ID → socketID 매핑
// 특정 유저에게 직접 알림을 보낼 때 그 소켓ID를 찾기 위해 필요
// 예) userSockets.get('userId-123') → 'socketId-xyz'
const userSockets = new Map()

// setupSocket = Socket.io 이벤트를 등록하는 함수
// io = index.js에서 생성된 Socket.io 서버 객체
function setupSocket(io) {

  // ──────────────────────────────────────────────────────────────
  // 소켓 연결 미들웨어: 모든 소켓 연결 시 먼저 실행되는 게이트키퍼
  // io.use = Socket.io 미들웨어 (Express의 app.use와 같은 개념)
  // ──────────────────────────────────────────────────────────────
  io.use((socket, next) => {

    // socket.handshake.auth = 클라이언트가 연결 시 보낸 인증 정보
    // 프론트에서: io('주소', { auth: { token: 'JWT토큰값' } }) 형태로 전달
    // ?. = optional chaining: auth가 없어도 에러 없이 undefined 반환
    const token = socket.handshake.auth?.token

    // 토큰 없으면 연결 자체를 거부
    if (!token) return next(new Error('토큰 없음'))

    try {
      // JWT 토큰 검증 후 유저 정보를 socket.user에 저장
      // 이후 모든 이벤트 핸들러에서 socket.user.userId 등으로 사용 가능
      socket.user = jwt.verify(token, process.env.JWT_SECRET)
      next() // 검증 통과 → 연결 허용
    } catch (e) {
      next(new Error('인증 실패')) // 토큰 위조/만료 → 연결 거부
    }
  })

  // ──────────────────────────────────────────────────────────────
  // 소켓 연결 성공 이벤트
  // io.on('connection', ...) = 누군가 소켓에 연결됐을 때 실행
  // socket = 이 연결 전용 객체 (각 유저마다 별도의 socket 객체)
  // ──────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`연결: ${socket.user.name} (${socket.id})`)

    // 유저ID와 socketID를 매핑해서 저장
    // 나중에 "특정 유저에게 알림 보내기"할 때 소켓ID가 필요
    userSockets.set(socket.user.userId, socket.id)

    // ────────────────────────────────────────────────────────────
    // 이벤트: 룸 입장
    // 프론트에서: socket.emit('join-room', '세션ID')
    // ────────────────────────────────────────────────────────────
    socket.on('join-room', (roomId) => {

      // Socket.io의 룸에 입장
      // 이후 io.to(roomId).emit(...)으로 이 룸 전체에 메시지 보낼 수 있음
      socket.join(roomId)

      // 이 룸에 처음 입장하는 경우 새 Set 생성
      // Set = 중복 없는 값들의 집합
      if (!rooms.has(roomId)) rooms.set(roomId, new Set())

      // 이 룸의 참여자 목록에 현재 유저 추가
      rooms.get(roomId).add({
        socketId: socket.id,           // 이 소켓 연결의 고유 ID
        userId: socket.user.userId,    // 유저 DB ID
        name: socket.user.name         // 유저 이름 (아바타 표시용)
      })

      // 룸에 있는 모든 사람에게 최신 참여자 목록 전송
      // [...rooms.get(roomId)] = Set을 배열로 변환 (JSON 전송을 위해)
      io.to(roomId).emit('participants-update', [...rooms.get(roomId)])
    })

    // 룸 퇴장 이벤트
    socket.on('leave-room', (roomId) => leaveRoom(socket, roomId, io))

    // ────────────────────────────────────────────────────────────
    // 이벤트: 코드 변경 (에디터에서 타이핑할 때마다 발생)
    // 프론트에서: socket.emit('code-change', { roomId, code })
    // ────────────────────────────────────────────────────────────
    socket.on('code-change', async ({ roomId, code }) => {
      try {
        // ① 이 세션을 만든 사람(오너)이 누구인지 DB 확인
        const session = await pool.query('SELECT author_id FROM sessions WHERE id = $1', [roomId])

        // 현재 요청한 유저가 오너인지 비교
        const isOwner = session.rows[0]?.author_id === socket.user.userId

        if (!isOwner) {
          // 오너가 아니면 권한 테이블에서 편집 권한 확인
          const perm = await pool.query(
            'SELECT can_edit FROM session_permissions WHERE session_id = $1 AND user_id = $2',
            [roomId, socket.user.userId]
          )

          // can_edit이 false이거나 권한 레코드가 없으면 거부
          // ?.can_edit = optional chaining: 레코드 없으면 undefined → || false로 false
          if (!perm.rows[0]?.can_edit) {
            // 요청한 본인에게만 권한 거부 이벤트 전송
            // socket.emit = 나에게만, io.to = 룸 전체에
            socket.emit('permission-denied', { message: '코드 편집 권한이 없습니다' })
            return  // 코드 동기화 없이 종료
          }
        }

        // ② 권한 통과: 나를 제외한 룸 멤버들에게 코드 변경 전송
        // socket.to(roomId) = "나를 제외한" 룸 멤버들에게
        // io.to(roomId) = 나를 포함한 룸 멤버들에게
        socket.to(roomId).emit('code-update', { code, userId: socket.user.userId })

        // ③ DB에 최신 코드 저장
        // 나중에 입장한 사람이 최신 코드를 볼 수 있도록
        await pool.query('UPDATE sessions SET code = $1 WHERE id = $2', [code, roomId])

      } catch (e) {
        console.error('코드 저장 실패:', e.message)
      }
    })

    // ────────────────────────────────────────────────────────────
    // 이벤트: 커서 위치 공유
    // 다른 사람의 커서가 몇 번째 줄, 몇 번째 칸에 있는지 표시
    // ────────────────────────────────────────────────────────────
    socket.on('cursor-move', ({ roomId, line, col }) => {
      socket.to(roomId).emit('cursor-update', {
        userId: socket.user.userId,
        name: socket.user.name,
        line,  // 줄 번호
        col,   // 열(칸) 번호
      })
    })

    // 댓글 등록 실시간 알림
    // 댓글 저장은 REST API(/api/sessions/:id/comments)에서 처리하고
    // 실시간 알림만 여기서 처리
    socket.on('comment', ({ roomId, comment }) => {
      socket.to(roomId).emit('new-comment', comment)
    })

    // ────────────────────────────────────────────────────────────
    // 이벤트: 특정 유저에게 직접 알림 전송
    // 권한 변경, 멘션 등의 알림을 실시간으로 보낼 때 사용
    // ────────────────────────────────────────────────────────────
    socket.on('notify-user', ({ targetUserId, notification }) => {
      // 알림 받을 유저의 소켓ID를 Map에서 찾음
      const targetSocketId = userSockets.get(targetUserId)

      // 그 유저가 현재 온라인(접속 중)인 경우에만 실시간 전송
      // 오프라인이면 DB에만 저장되고 다음 접속 시 볼 수 있음
      if (targetSocketId) {
        io.to(targetSocketId).emit('new-notification', notification)
      }
    })

    // ────────────────────────────────────────────────────────────
    // 이벤트: 연결 끊김 (브라우저 닫기, 네트워크 끊김 등)
    // ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // 유저-소켓 매핑에서 제거
      userSockets.delete(socket.user.userId)

      // 모든 룸을 순회해서 이 소켓의 참여자 정보 제거
      rooms.forEach((members, roomId) => {
        const before = members.size  // 제거 전 참여자 수

        // Set에서 이 소켓ID와 일치하는 참여자 제거
        members.forEach(m => {
          if (m.socketId === socket.id) members.delete(m)
        })

        // 참여자가 실제로 줄었을 때만 업데이트 전송 (불필요한 전송 방지)
        if (members.size !== before) {
          io.to(roomId).emit('participants-update', [...members])
        }
      })
    })
  })
}

// 룸 퇴장 처리 함수 (코드 중복을 줄이기 위해 별도 함수로 분리)
function leaveRoom(socket, roomId, io) {
  socket.leave(roomId)  // Socket.io 룸에서 퇴장
  const members = rooms.get(roomId)
  if (members) {
    members.forEach(m => { if (m.socketId === socket.id) members.delete(m) })
    io.to(roomId).emit('participants-update', [...members])
  }
}

// 외부(index.js)에서 setupSocket(io)로 호출할 수 있게 내보냄
module.exports = setupSocket
