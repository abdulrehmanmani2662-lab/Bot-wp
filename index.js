const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const GROUP_JID = process.env.GROUP_JID || "YAHAN_GROUP_JID@g.us";
const REPORT_DAYS = 7;

// Render Persistent Disk
const BASE = "/var/data";
const AUTH_DIR = `${BASE}/auth`;
const DATA_DIR = `${BASE}/data`;

if (!fs.existsSync(BASE))
  fs.mkdirSync(BASE, { recursive: true });

if (!fs.existsSync(AUTH_DIR))
  fs.mkdirSync(AUTH_DIR, { recursive: true });

if (!fs.existsSync(DATA_DIR))
  fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = `${DATA_DIR}/messageLog.json`;
const STATE_FILE = `${DATA_DIR}/botState.json`;

let messageLog = {};
let botState = { cycleStart: Date.now() };

if (fs.existsSync(LOG_FILE)) {
  try {
    messageLog = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {}
}

if (fs.existsSync(STATE_FILE)) {
  try {
    botState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
}

function saveData() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(messageLog));
  fs.writeFileSync(STATE_FILE, JSON.stringify(botState));
}

function normalizeJid(jid) {
  return (jid || "").split(":")[0].toLowerCase();
}

function formatNumber(jid) {
  let n = (jid || "").split("@")[0].split(":")[0];

  if (n.startsWith("92"))
    n = "0" + n.slice(2);

  return n;
}

let sock = null;
let ownerJid = null;
let latestQR = null;

// ================= WEB SERVER =================

const app = express();

app.get("/", (req, res) => {
  res.send(`
    <html>
    <body style="background:#111;color:white;text-align:center;font-family:Arial;padding:40px">
      <h1>🤖 WhatsApp Report Bot</h1>
      <p>${ownerJid ? "🟢 Connected" : "🟡 Waiting for WhatsApp"}</p>
      <a href="/qr" style="background:#25D366;color:white;padding:15px 25px;border-radius:10px;text-decoration:none">
        📱 Open QR
      </a>
    </body>
    </html>
  `);
});

app.get("/qr", async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <html>
      <body style="background:#111;color:white;text-align:center;font-family:Arial;padding:40px">
        <h2>QR available nahi hai</h2>
        <p>Bot already connected ho sakta hai.</p>
        <meta http-equiv="refresh" content="5">
      </body>
      </html>
    `);
  }

  const image = await QRCode.toDataURL(latestQR);

  res.send(`
    <html>
    <body style="background:#111;color:white;text-align:center;font-family:Arial;padding:30px">
      <h2>📱 WhatsApp QR</h2>
      <p>WhatsApp → Linked Devices → Link a Device</p>
      <img src="${image}" style="width:300px;max-width:90%;background:white;padding:10px;border-radius:10px">
      <p>QR scan karein.</p>
      <script>
        setTimeout(() => location.reload(), 15000);
      </script>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    whatsapp: ownerJid ? "connected" : "waiting"
  });
});

app.listen(PORT, () => {
  console.log("🌐 Server running on port " + PORT);
});

// ================= WHATSAPP =================

async function startBot() {

  try {

    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    const { version } =
      await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,

      logger: pino({
        level: "silent"
      }),

      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "silent" })
        )
      },

      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", update => {

      const { connection, qr } = update;

      if (qr) {
        latestQR = qr;
        console.log("📱 QR generated → open /qr");
      }

      if (connection === "open") {

        latestQR = null;
        ownerJid = sock.user?.id || null;

        console.log("✅ WhatsApp Connected");
        console.log("👑 Owner:", ownerJid);
      }

      if (connection === "close") {

        ownerJid = null;

        console.log("❌ WhatsApp disconnected");
        console.log("🔄 Reconnecting...");

        setTimeout(startBot, 5000);
      }

    });

    // ================= MESSAGES =================

    sock.ev.on("messages.upsert", async ({ messages }) => {

      try {

        const msg = messages[0];

        if (!msg || !msg.message) return;
        if (msg.key.fromMe) return;

        const chat = msg.key.remoteJid;

        if (!chat) return;

        if (GROUP_JID.includes("YAHAN_GROUP")) {
          console.log("⚠️ GROUP_JID set karein.");
          return;
        }

        if (chat !== GROUP_JID) return;

        const sender =
          msg.key.participant ||
          msg.key.remoteJid;

        if (!sender) return;

        // Message count
        if (!messageLog[sender])
          messageLog[sender] = [];

        const time =
          Number(msg.messageTimestamp || 0) * 1000;

        if (time)
          messageLog[sender].push(time);

        saveData();

        // Text
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";

        if (text.trim().toLowerCase() !== "!stats")
          return;

        // Sirf jis number se bot linked hai
        if (
          ownerJid &&
          normalizeJid(sender) !== normalizeJid(ownerJid)
        ) {
          console.log("⛔ Unauthorized !stats:", sender);
          return;
        }

        await sendReport();

      } catch (e) {
        console.log("Message error:", e.message);
      }

    });

    // ================= 7 DAYS =================

    setInterval(async () => {

      const end =
        botState.cycleStart +
        REPORT_DAYS * 24 * 60 * 60 * 1000;

      if (Date.now() >= end) {

        if (sock && ownerJid) {

          await sendReport();

          botState.cycleStart = Date.now();
          messageLog = {};

          saveData();

          console.log("🔄 New 7-day cycle");
        }
      }

    }, 60000);

  } catch (e) {

    console.log("Start error:", e.message);

    setTimeout(startBot, 5000);
  }
}

// ================= REPORT =================

async function sendReport() {

  try {

    const meta =
      await sock.groupMetadata(GROUP_JID);

    const members =
      meta.participants.map(p => p.id);

    const start = botState.cycleStart;

    let text =
      `📊 *${REPORT_DAYS} DIN KI REPORT*\n`;

    text +=
      `🗓 ${new Date(start).toLocaleDateString("en-GB")} se aaj tak\n\n`;

    const active = [];
    const inactive = [];

    for (const member of members) {

      const count =
        (messageLog[member] || [])
        .filter(t => t >= start)
        .length;

      if (count > 0)
        active.push([member, count]);
      else
        inactive.push(member);
    }

    active.sort((a, b) => b[1] - a[1]);

    text += "✅ *ACTIVE MEMBERS:*\n";

    if (!active.length) {

      text += "Kisi ne message nahi kiya 😅\n";

    } else {

      for (const [member, count] of active) {
        text +=
          `📱 ${formatNumber(member)} — *${count}* messages\n`;
      }
    }

    text +=
      `\n❌ *${REPORT_DAYS} DIN ME 0 MESSAGES:*\n`;

    if (!inactive.length) {

      text += "Koi nahi — sab active ✅\n";

    } else {

      for (const member of inactive) {
        text +=
          `📱 ${formatNumber(member)} — *0* messages 🚫\n`;
      }
    }

    await sock.sendMessage(
      GROUP_JID,
      { text }
    );

    console.log("✅ Report sent");

  } catch (e) {

    console.log("Report error:", e.message);
  }
}

// ================= START =================

console.log("================================");
console.log("🤖 WhatsApp 7-Day Report Bot");
console.log("================================");

startBot();
