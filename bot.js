// ===== WHATSAPP GROUP 7-DAY REPORT BOT (MOBILE/TERMUX) =====
const {
  default: makeWASocket, useMultiFileAuthState,
  fetchLatestBaileysVersion, makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const readline = require("readline");

// ================== SETTINGS ==================
const GROUP_JID   = "YAHAN_APNA_GROUP_JID_DALEIN@g.us"; // baad me change karein
const REPORT_DAYS = 7;
// ==============================================

const LOG_FILE   = "messageLog.json";
const STATE_FILE = "botState.json";

const messageLog = fs.existsSync(LOG_FILE)
  ? JSON.parse(fs.readFileSync(LOG_FILE, "utf8")) : {};
const botState = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : { cycleStart: Date.now() };

function saveData() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(messageLog));
  fs.writeFileSync(STATE_FILE, JSON.stringify(botState));
}

function formatNumber(jid) {
  let num = jid.split("@")[0].split(":")[0];
  if (num.startsWith("92")) num = "0" + num.slice(2);
  return num;
}

let phoneNumber = null;

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
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n👉 QR CODE (backup ke liye):");
      qrcode.generate(qr, { small: true });

      // Pairing code — same phone pe asaan tareeqa
      if (phoneNumber) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log("\n🔑🔑 AAPKA PAIRING CODE:  " + code + "  🔑🔑");
            console.log("WhatsApp kholein → Settings → Linked Devices → Link a device");
            console.log("→ 'Link with phone number instead' → ye code dalein\n");
          } catch (e) { console.log("Pair code error:", e.message); }
        }, 3000);
      }
    }

    if (connection === "open") {
      console.log("✅ BOT CONNECTED! Ab group me 1 message bhejein — JID neeche aayega:\n");
    }

    if (connection === "close") {
      console.log("❌ Connection band, 5 sec baad dobara...");
      setTimeout(startBot, 5000);
    }
  });

  // ---------- MESSAGES COUNT ----------
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const chat = msg.key.remoteJid;
    console.log("MSG FROM:", chat); // 👈 YAHAN SE JID MILEGA

    if (GROUP_JID.includes("YAHAN_APNA")) {
      if (!chat.endsWith("@g.us")) return;
    } else if (chat !== GROUP_JID) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!sender) return;

    (messageLog[sender] ||= []).push(msg.messageTimestamp * 1000);
    saveData();

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (text.trim() === "!stats") await sendReport(sock, true);
  });

  // ---------- 7 DIN CHECK ----------
  setInterval(async () => {
    const cycleEnd = botState.cycleStart + REPORT_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() >= cycleEnd) {
      await sendReport(sock, false);
      botState.cycleStart = Date.now();
      for (const id in messageLog) messageLog[id] = [];
      saveData();
      console.log("🔄 Naya cycle shuru");
    }
  }, 60 * 1000);
}

// ---------- REPORT ----------
async function sendReport(sock, isManual) {
  if (GROUP_JID.includes("YAHAN_APNA")) {
    console.log("⚠️ Pehle GROUP_JID set karein!");
    return;
  }
  const meta = await sock.groupMetadata(GROUP_JID).catch(() => null);
  if (!meta) { console.log("⚠️ Group nahi mila"); return; }

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
  active.forEach(([m, c]) => { reply += `📱 ${formatNumber(m)} — *${c}* messages\n`; });

  reply += `\n❌ *${REPORT_DAYS} din me 0 messages:*\n`;
  if (inactive.length === 0) reply += "Koi nahi — sab active ✅\n";
  else inactive.forEach(m => { reply += `📱 ${formatNumber(m)} — *0* messages 🚫\n`; });

  if (isManual) reply += "\n_(Live report — !stats)_";

  await sock.sendMessage(GROUP_JID, { text: reply });
  console.log("✅ Report bhej di gayi");
}

// ---------- START ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

if (fs.existsSync("auth/creds.json")) {
  console.log("🔁 Purana session mil gaya, seedha connect ho raha hun...");
  startBot();
} else {
  rl.question("Apna WhatsApp number country code ke saath likhein (e.g. 923001234567): ", (num) => {
    phoneNumber = num.replace(/[^0-9]/g, "");
    rl.close();
    startBot();
  });
}
