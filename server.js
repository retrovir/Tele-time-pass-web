import express from "express"
import http from "http"
import { Server } from "socket.io"
import TelegramBot from "node-telegram-bot-api"
import dotenv from "dotenv"
import multer from "multer"
import fs from "fs"
import mime from "mime-types"

dotenv.config()

const app = express()
const server = http.createServer(app)
const io = new Server(server)

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })
const upload = multer({ dest: "/tmp" })
const HISTORY_FILE = "./history.json"

app.use(express.static("public"))
app.use(express.json())

/* ---------- HISTORY ---------- */
function saveMessage(from, text) {
  const h = JSON.parse(fs.readFileSync(HISTORY_FILE))
  h.push({ from, text, time: new Date().toLocaleString() })
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2))
}

/* ---------- LOGIN ---------- */
app.post("/login", (req, res) => {
  res.json({ ok: req.body.password === process.env.WEB_PASSWORD })
})

/* ---------- FILE UPLOAD ---------- */
app.post("/upload", upload.single("file"), async (req, res) => {
  const filePath = req.file.path
  const name = req.file.originalname
  const type = mime.lookup(name)

  try {
    if (type && type.startsWith("image/")) {
      await bot.sendPhoto(
        process.env.CHAT_ID,
        fs.createReadStream(filePath),
        { caption: name }
      )
    } else {
      await bot.sendDocument(
        process.env.CHAT_ID,
        fs.createReadStream(filePath),
        {},
        { filename: name }
      )
    }
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok: false })
  } finally {
    fs.unlinkSync(filePath)
  }
})

/* ---------- SOCKET ---------- */
io.on("connection", socket => {

  socket.on("typing", () => {
    bot.sendChatAction(process.env.CHAT_ID, "typing")
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

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]
    bot.getFileLink(photo.file_id).then(link => {
      io.emit("tg-image", link)
    })
  }
})

/* ---------- /history ---------- */
bot.onText(/\/history/, () => {
  const h = JSON.parse(fs.readFileSync(HISTORY_FILE))
    .slice(-20)
    .map(m => `[${m.time}] ${m.from}: ${m.text}`)
    .join("\n")

  bot.sendMessage(process.env.CHAT_ID, h || "No history")
})

server.listen(process.env.PORT, () =>
  console.log("Server running")
)
