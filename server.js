import express from "express"
import http from "http"
import { Server } from "socket.io"
import TelegramBot from "node-telegram-bot-api"
import dotenv from "dotenv"
import multer from "multer"
import fs from "fs"

dotenv.config()

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })
const upload = multer({ dest: "/tmp" })
const HISTORY_FILE = "./history.json"

app.use(express.static("public"))
app.use(express.json())

/* ---------- HISTORY UTILS ---------- */
function saveMessage(from, text) {
  const history = JSON.parse(fs.readFileSync(HISTORY_FILE))
  history.push({
    from,
    text,
    time: new Date().toLocaleString()
  })
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
}

/* ---------- LOGIN ---------- */
app.post("/login", (req, res) => {
  res.json({ ok: req.body.password === process.env.WEB_PASSWORD })
})

/* ---------- FILE UPLOAD ---------- */
app.post("/upload", upload.single("file"), async (req, res) => {
  await bot.sendDocument(
    process.env.CHAT_ID,
    fs.createReadStream(req.file.path)
  )
  fs.unlinkSync(req.file.path)
  res.json({ ok: true })
})

/* ---------- SOCKET ---------- */
io.on("connection", socket => {

  socket.on("typing", async () => {
    await bot.sendChatAction(process.env.CHAT_ID, "typing")
  })

  socket.on("web-msg", msg => {
    saveMessage("web", msg)
    bot.sendMessage(process.env.CHAT_ID, `🌐 ${msg}`)
  })

})

/* ---------- TELEGRAM → WEB ---------- */
bot.on("message", msg => {
  if (msg.chat.id.toString() !== process.env.CHAT_ID) return

  if (msg.text && msg.text !== "/history") {
    saveMessage("telegram", msg.text)
    io.emit("tg-msg", msg.text)
  }

  if (msg.document) {
    bot.getFileLink(msg.document.file_id).then(link => {
      io.emit("tg-file", {
        name: msg.document.file_name,
        url: link
      })
    })
  }
})

/* ---------- /history COMMAND ---------- */
bot.onText(/\/history/, () => {
  const history = JSON.parse(fs.readFileSync(HISTORY_FILE))
    .slice(-20)
    .map(m => `[${m.time}] ${m.from}: ${m.text}`)
    .join("\n")

  bot.sendMessage(
    process.env.CHAT_ID,
    history || "No history yet"
  )
})

server.listen(process.env.PORT, () =>
  console.log("Server running on port", process.env.PORT)
)
