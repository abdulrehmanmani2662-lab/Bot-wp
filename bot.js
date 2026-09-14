// ============ WHATSAPP GROUP 7-DAY REPORT BOT ============
// Render pe chalane ke liye: pehle LOCAL pc pe chala kar QR scan karein,
// phir bot.js + auth folder + *.json files GitHub se Render pe deploy karein.
in.
// =========================================================

const {
  default: makeWASocket, useMultiFileAuthState,
  fetchLatestBaileysVersion, makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");

// ================== SETTINGS ==================
const GROUP_JID   = "YAHAN_APNA_GROUP_JID_DALEIN@g.us"; // e.g. "92300...-162...@g.us"
const REPORT_DAYS = 7;
// ==============================================

const LOG_FILE   = "messageLog.json";
const STATE_FILE = "botState.json";

// --- Purana data load karo (restart pe save rahe) ---
const messageLog = fs.existsSync(LOG_FILE)
  ? JSON.parse(fs.readFileSync(LOG_FILE, "utf8")) : {};
const botState = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : { cycleStart: Date.now() };

function saveData() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(messageLog));
  fs.writeFileSync(STATE_FILE, JSON.stringify(botState));
}

// --- Number ko aasan format me (923001234567@... -> 03001234567) ---
function formatNumber(jid) {
  let num = jid.split("@")[0].split(":")[0];
  if (num.startsWith("92")) num = "0" + num.slice(2);
  return num;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    // Render pe connection stable rahe
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("👉 NAYA QR CODE — isko scan karein (local pc pe):");
      console.log(qr); // terminal QR, ya qr-terminal package use karein
    }
    if (connection === "open") {
      console.log("✅ Bot connected! Group JID check karein neeche:");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection band, dobara connect ho raha hai...", code);
      setTimeout(startBot, 5000); // auto reconnect
    }
  });

  // ---------- MESSAGES COUNT KARNA ----------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const chat = msg.key.remoteJid;
    console.log("MSG FROM:", chat); // 👈 Yahan se GROUP_JID mil jayega

    // ==== JAB TAK GROUP_JID SET NA HO, SAB GROUPS COUNT HO JAYEN (easiest) ====
    if (GROUP_JID.includes("YAHAN_APNA")) {
      if (!chat.endsWith("@g.us")) return;
    } else if (chat !== GROUP_JID) {
      return;
    }

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!sender) return;

    (messageLog[sender] ||= []).push(msg.messageTimestamp * 1000);
    saveData();

    // --- !stats command (live report ke liye) ---
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (text.trim() === "!stats") {
      await sendReport(sock, true);
    }
  });

  // ---------- HAR MINUTE CHECK: 7 DIN POORE? ----------
  setInterval(async () => {
    const cycleEnd = botState.cycleStart + REPORT_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() >= cycleEnd) {
      await sendReport(sock, false);
      botState.cycleStart = Date.now(); // naya cycle
      for (const id in messageLog) messageLog[id] = [];
      saveData();
      console.log("🔄 Naya 7-din ka cycle shuru ho gaya");
    }
  }, 60 * 1000);
}

// ---------- REPORT BANANA AUR BHEJNA ----------
async function sendReport(sock, isManual) {
  const meta = await sock.groupMetadata(GROUP_JID).catch(() => null);
  if (!meta) { console.log("⚠️ Group metadata nahi mila"); return; }

  const allMembers = meta.participants.map(p => p.id);
  const cycleStart = botState.cycleStart;

  let reply = `📊 *${REPORT_DAYS} DIN KI REPORT*\n`;
  reply += `🗓 ${new Date(cycleStart).toLocaleDateString("en-GB")} se aaj tak\n\n`;
  reply += `✅ *Jinho ne messages kiye:*\n`;

  const active = [], inactive = [];
  for (const m of allMembers) {
    const count = (messageLog[m] || []).filter(t => t >= cycleStart).length;
    count > 0 ? active.push([m, count]) : inactive.push(m);
  }
  active.sort((a, b) => b[1] - a[1]);

  if (active.length === 0) reply += "Kisi ne message nahi kiya 😅\n";
  active.forEach(([m, c]) => {
    reply += `📱 ${formatNumber(m)} — *${c}* messages\n`;
  });

  reply += `\n❌ *${REPORT_DAYS} din me 0 messages:*\n`;
  if (inactive.length === 0) reply += "Koi nahi — sab active ✅\n";
  else inactive.forEach(m => {
    reply += `📱 ${formatNumber(m)} — *0* messages 🚫\n`;
  });

  if (isManual) reply += "\n_(Live report — !stats command se)_";

  await sock.sendMessage(GROUP_JID, { text: reply });
  console.log("✅ Report bhej di gayi");
}

startBot();
