require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const { initDB } = require('./db')
const setupSocket = require('./socket')

const authRoutes        = require('./routes/auth')
const sessionRoutes     = require('./routes/sessions')
const snippetRoutes     = require('./routes/snippets')
const permissionRoutes  = require('./routes/permissions')
const notificationRoutes = require('./routes/notifications')
const executeRoutes = require('./routes/execute')


const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', methods: ['GET','POST'] }
})

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

app.use('/api/auth',          authRoutes)
app.use('/api/sessions',      sessionRoutes)
app.use('/api/snippets',      snippetRoutes)
app.use('/api/permissions',   permissionRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/execute', executeRoutes)

app.use((req, res) => res.status(404).json({ error: '없는 API 경로입니다' }))
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: '서버 내부 오류' }) })

setupSocket(io)

const PORT = process.env.PORT || 3000

async function start() {
  try {
    await initDB()
    server.listen(PORT, () => {
      console.log(`🚀 서버 실행 중: http://localhost:${PORT}`)
    })
  } catch (e) {
    console.error('❌ 서버 시작 실패:', e.message)
    process.exit(1)
  }
}

start()
