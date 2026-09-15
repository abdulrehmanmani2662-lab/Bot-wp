const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const REPORT_DAYS = 7;

const TARGET_GROUP_NAMES = [
  "مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن",
  "test"
];

const BASE = __dirname;
const AUTH_DIR = path.join(BASE, "auth");
const DATA_DIR = path.join(BASE, "data");

const LOG_FILE = path.join(DATA_DIR, "messageLog.json");
const STATE_FILE = path.join(DATA_DIR, "botState.json");
const GROUP_FILE = path.join(DATA_DIR, "groups.json");

for (const dir of [AUTH_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.log("JSON load error:", e.message);
  }
  return fallback;
}

let messageLog = loadJSON(LOG_FILE, {});
let botState = loadJSON(STATE_FILE, {
  cycleStart: Date.now()
});
let savedGroups = loadJSON(GROUP_FILE, []);

function saveData() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(messageLog, null, 2));
    fs.writeFileSync(STATE_FILE, JSON.stringify(botState, null, 2));
    fs.writeFileSync(GROUP_FILE, JSON.stringify(savedGroups, null, 2));
  } catch (e) {
    console.log("Save error:", e.message);
  }
}

function normalizeJid(jid) {
  return (jid || "").split(":")[0].toLowerCase();
}

function formatNumber(jid) {
  let n = (jid || "").split("@")[0].split(":")[0];

  if (n.startsWith("92")) {
    n = "0" + n.slice(2);
  }

  return n;
}

function normalizeGroupName(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function escapeHTML(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let sock = null;
let ownerJid = null;

let latestQR = null;
let qrGeneratedAt = 0;

let connectionStatus = "starting";
let lastError = "";
let reconnecting = false;

const QR_EXPIRE = 50000;

const app = express();

app.use(express.json());

/* =========================================================
   PREMIUM DASHBOARD
========================================================= */

app.get("/", async (req, res) => {

  let qrImage = "";

  if (latestQR) {
    try {
      qrImage = await QRCode.toDataURL(latestQR);
    } catch (e) {
      qrImage = "";
    }
  }

  const connected = !!ownerJid;

  const cycleStart = botState.cycleStart || Date.now();

  const elapsed = Math.max(
    0,
    Date.now() - cycleStart
  );

  const totalTime =
    REPORT_DAYS * 24 * 60 * 60 * 1000;

  const progress = Math.min(
    100,
    Math.round((elapsed / totalTime) * 100)
  );

  const daysLeft = Math.max(
    0,
    REPORT_DAYS -
      Math.floor(elapsed / (24 * 60 * 60 * 1000))
  );

  const groupsHTML = savedGroups.length
    ? savedGroups.map((g, i) => `
      <div class="group-card">

        <div class="group-icon">
          ${i === 0 ? "🏢" : "🧪"}
        </div>

        <div class="group-info">

          <div class="group-name">
            ${escapeHTML(g.name)}
          </div>

          <div class="group-jid">
            ${escapeHTML(g.jid)}
          </div>

        </div>

        <div class="group-status">
          <span></span>
          ACTIVE
        </div>

      </div>
    `).join("")
    : `
      <div class="empty-box">
        <div class="empty-icon">👥</div>
        <b>No target groups detected</b>
        <small>
          Bot connected hone ke baad groups automatically detect honge.
        </small>
      </div>
    `;

  let statusText = "STARTING";
  let statusClass = "yellow";

  if (connected) {
    statusText = "CONNECTED";
    statusClass = "green";
  } else if (connectionStatus === "qr") {
    statusText = "SCAN QR";
    statusClass = "blue";
  } else if (connectionStatus === "disconnected") {
    statusText = "RECONNECTING";
    statusClass = "red";
  }

  res.send(`
<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
 name="viewport"
 content="width=device-width, initial-scale=1.0"
>

<meta
 http-equiv="refresh"
 content="5"
>

<title>WhatsApp Control Center</title>

<style>

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

*{
  box-sizing:border-box;
}

html{
  scroll-behavior:smooth;
}

body{
  margin:0;
  min-height:100vh;
  color:#f5f7fb;
  font-family:Inter,Arial,sans-serif;

  background:
    radial-gradient(
      circle at 10% 10%,
      rgba(37,211,102,.12),
      transparent 28%
    ),
    radial-gradient(
      circle at 90% 20%,
      rgba(99,102,241,.14),
      transparent 30%
    ),
    #070a12;
}

body:before{
  content:"";
  position:fixed;
  inset:0;
  pointer-events:none;

  background:
    linear-gradient(
      rgba(255,255,255,.015) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      rgba(255,255,255,.015) 1px,
      transparent 1px
    );

  background-size:40px 40px;
}

.container{
  position:relative;
  width:min(1180px,94%);
  margin:auto;
  padding:30px 0 60px;
}

/* HEADER */

.topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;

  padding:22px 25px;

  border:1px solid rgba(255,255,255,.08);
  border-radius:24px;

  background:rgba(17,22,35,.72);
  backdrop-filter:blur(20px);

  box-shadow:
    0 25px 70px rgba(0,0,0,.35);
}

.brand{
  display:flex;
  align-items:center;
  gap:15px;
}

.logo{
  width:52px;
  height:52px;

  display:flex;
  align-items:center;
  justify-content:center;

  border-radius:16px;

  font-size:27px;

  background:
    linear-gradient(
      135deg,
      #25d366,
      #0f9d58
    );

  box-shadow:
    0 0 30px rgba(37,211,102,.25);
}

.brand h1{
  margin:0;
  font-size:20px;
  font-weight:800;
}

.brand p{
  margin:4px 0 0;
  color:#7f8aa3;
  font-size:12px;
}

.status-pill{
  display:flex;
  align-items:center;
  gap:9px;

  padding:10px 15px;

  border-radius:999px;

  background:rgba(255,255,255,.05);

  font-size:11px;
  font-weight:800;
  letter-spacing:.5px;
}

.status-dot{
  width:9px;
  height:9px;
  border-radius:50%;
  background:#ffd166;
}

.status-dot.green{
  background:#25d366;
  box-shadow:0 0 15px #25d366;
}

.status-dot.blue{
  background:#60a5fa;
  box-shadow:0 0 15px #60a5fa;
}

.status-dot.red{
  background:#ff5c5c;
  box-shadow:0 0 15px #ff5c5c;
}

/* HERO */

.hero{
  margin-top:22px;

  padding:32px;

  border-radius:26px;

  border:1px solid rgba(255,255,255,.08);

  background:
    linear-gradient(
      135deg,
      rgba(37,211,102,.10),
      rgba(99,102,241,.08)
    );

  backdrop-filter:blur(20px);
}

.hero h2{
  margin:0;

  font-size:clamp(26px,5vw,42px);
  font-weight:800;
}

.hero h2 span{
  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa
    );

  -webkit-background-clip:text;
  color:transparent;
}

.hero p{
  margin:12px 0 0;
  color:#8994ad;
}

/* STAT CARDS */

.stats{
  display:grid;
  grid-template-columns:
    repeat(4,1fr);

  gap:15px;

  margin-top:20px;
}

.stat{
  padding:22px;

  border-radius:20px;

  border:1px solid rgba(255,255,255,.07);

  background:rgba(17,22,35,.75);

  box-shadow:
    0 15px 40px rgba(0,0,0,.20);

  transition:.25s;
}

.stat:hover{
  transform:translateY(-3px);
  border-color:rgba(37,211,102,.25);
}

.stat-icon{
  font-size:22px;
  margin-bottom:15px;
}

.stat-title{
  color:#707b94;
  font-size:10px;
  font-weight:700;
  letter-spacing:1px;
}

.stat-value{
  margin-top:7px;
  font-size:20px;
  font-weight:800;
}

.green-text{
  color:#25d366;
}

.blue-text{
  color:#60a5fa;
}

.yellow-text{
  color:#ffd166;
}

/* GRID */

.grid{
  display:grid;
  grid-template-columns:
    1.15fr .85fr;

  gap:20px;

  margin-top:20px;
}

.panel{
  border-radius:24px;

  padding:24px;

  border:1px solid rgba(255,255,255,.07);

  background:
    rgba(17,22,35,.75);

  backdrop-filter:blur(18px);

  box-shadow:
    0 20px 50px rgba(0,0,0,.20);
}

.panel-title{
  display:flex;
  align-items:center;
  justify-content:space-between;

  margin-bottom:20px;
}

.panel-title h3{
  margin:0;
  font-size:16px;
}

.panel-title span{
  color:#68738b;
  font-size:11px;
}

/* QR */

.qr-container{
  min-height:390px;

  display:flex;
  align-items:center;
  justify-content:center;

  text-align:center;

  border-radius:20px;

  background:
    radial-gradient(
      circle,
      rgba(37,211,102,.08),
      transparent 60%
    );
}

.qr-image{
  width:285px;
  max-width:85%;

  padding:12px;

  border-radius:20px;

  background:#fff;

  box-shadow:
    0 0 60px rgba(37,211,102,.18);
}

.qr-label{
  margin-top:18px;

  color:#8994ad;

  font-size:12px;
  line-height:1.7;
}

.qr-wait{
  color:#8994ad;
  padding:50px 20px;
}

.spinner{
  width:45px;
  height:45px;

  margin:0 auto 20px;

  border:3px solid rgba(255,255,255,.08);

  border-top-color:#25d366;

  border-radius:50%;

  animation:spin 1s linear infinite;
}

@keyframes spin{
  to{
    transform:rotate(360deg);
  }
}

/* GROUP */

.group-card{
  display:flex;
  align-items:center;

  gap:14px;

  padding:15px;

  margin-bottom:11px;

  border-radius:17px;

  background:rgba(255,255,255,.035);

  border:1px solid rgba(255,255,255,.05);
}

.group-icon{
  width:45px;
  height:45px;

  display:flex;
  align-items:center;
  justify-content:center;

  border-radius:14px;

  background:rgba(37,211,102,.10);

  font-size:20px;
}

.group-info{
  flex:1;
  min-width:0;
}

.group-name{
  font-size:13px;
  font-weight:700;

  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.group-jid{
  margin-top:5px;

  color:#58647c;

  font-size:9px;

  overflow:hidden;
  text-overflow:ellipsis;
}

.group-status{
  color:#25d366;

  font-size:9px;
  font-weight:800;

  display:flex;
  align-items:center;
  gap:5px;
}

.group-status span{
  width:6px;
  height:6px;

  background:#25d366;

  border-radius:50%;
}

/* PROGRESS */

.progress-area{
  margin-top:25px;
}

.progress-head{
  display:flex;
  justify-content:space-between;

  color:#8994ad;

  font-size:11px;

  margin-bottom:9px;
}

.progress{
  height:9px;

  overflow:hidden;

  border-radius:20px;

  background:#0b0f19;
}

.progress-bar{
  height:100%;

  width:${progress}%;

  border-radius:20px;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa
    );

  box-shadow:
    0 0 20px rgba(37,211,102,.25);
}

/* OWNER */

.owner{
  display:flex;
  align-items:center;
  gap:15px;

  padding:16px;

  border-radius:18px;

  background:rgba(255,255,255,.035);
}

.owner-avatar{
  width:48px;
  height:48px;

  display:flex;
  align-items:center;
  justify-content:center;

  border-radius:50%;

  background:
    linear-gradient(
      135deg,
      #6366f1,
      #25d366
    );

  font-size:20px;
}

.owner-title{
  color:#66728b;
  font-size:10px;
}

.owner-number{
  margin-top:4px;
  font-size:14px;
  font-weight:700;
}

/* COMMANDS */

.command{
  display:flex;
  align-items:center;
  justify-content:space-between;

  padding:14px 16px;

  margin-bottom:9px;

  border-radius:14px;

  background:#0b0f19;

  border:1px solid rgba(255,255,255,.04);
}

.command code{
  color:#25d366;

  font-family:monospace;

  font-size:13px;
}

.command span{
  color:#5f6b83;

  font-size:10px;
}

/* EMPTY */

.empty-box{
  text-align:center;

  padding:45px 20px;

  border-radius:18px;

  background:rgba(255,255,255,.025);

  color:#78849d;
}

.empty-icon{
  font-size:35px;
  margin-bottom:10px;
}

.empty-box small{
  display:block;
  margin-top:8px;
}

/* FOOTER */

.footer{
  text-align:center;

  color:#4e5a72;

  font-size:10px;

  padding:30px 0 0;
}

/* MOBILE */

@media(max-width:850px){

  .stats{
    grid-template-columns:
      repeat(2,1fr);
  }

  .grid{
    grid-template-columns:1fr;
  }

}

@media(max-width:550px){

  .container{
    width:92%;
    padding-top:15px;
  }

  .topbar{
    padding:17px;
  }

  .brand h1{
    font-size:16px;
  }

  .status-pill{
    padding:8px 10px;
    font-size:9px;
  }

  .hero{
    padding:24px;
  }

  .hero h2{
    font-size:27px;
  }

  .stats{
    gap:10px;
  }

  .stat{
    padding:16px;
  }

  .stat-value{
    font-size:16px;
  }

  .panel{
    padding:18px;
  }

  .qr-image{
    width:250px;
  }

}

</style>

</head>

<body>

<div class="container">

<!-- TOP BAR -->

<div class="topbar">

  <div class="brand">

    <div class="logo">
      💬
    </div>

    <div>
      <h1>WA CONTROL CENTER</h1>
      <p>WhatsApp Report Management System</p>
    </div>

  </div>

  <div class="status-pill">

    <div class="status-dot ${statusClass}"></div>

    ${statusText}

  </div>

</div>

<!-- HERO -->

<div class="hero">

  <h2>
    Welcome to your
    <span>Control Center.</span>
  </h2>

  <p>
    Monitor WhatsApp groups, message activity
    and automatic 7-day reports from one dashboard.
  </p>

</div>

<!-- STATS -->

<div class="stats">

  <div class="stat">

    <div class="stat-icon">
      📡
    </div>

    <div class="stat-title">
      CONNECTION
    </div>

    <div class="stat-value ${
      connected ? "green-text" : "yellow-text"
    }">

      ${
        connected
          ? "Online"
          : "Waiting"
      }

    </div>

  </div>

  <div class="stat">

    <div class="stat-icon">
      👥
    </div>

    <div class="stat-title">
      TARGET GROUPS
    </div>

    <div class="stat-value">
      ${savedGroups.length} / 2
    </div>

  </div>

  <div class="stat">

    <div class="stat-icon">
      📊
    </div>

    <div class="stat-title">
      REPORT CYCLE
    </div>

    <div class="stat-value blue-text">
      ${REPORT_DAYS} Days
    </div>

  </div>

  <div class="stat">

    <div class="stat-icon">
      ⏳
    </div>

    <div class="stat-title">
      DAYS LEFT
    </div>

    <div class="stat-value yellow-text">
      ${daysLeft}
    </div>

  </div>

</div>

<!-- MAIN -->

<div class="grid">

<!-- QR PANEL -->

<div class="panel">

  <div class="panel-title">

    <h3>📱 WhatsApp Connection</h3>

    <span>
      ${
        connected
          ? "Secure Session"
          : "Scan to Connect"
      }
    </span>

  </div>

  <div class="qr-container">

  ${
    connected
      ? `
        <div>

          <div style="font-size:65px">
            ✅
          </div>

          <h2>
            WhatsApp Connected
          </h2>

          <p class="qr-label">
            Your WhatsApp session is active.
            <br>
            Bot is ready to monitor groups.
          </p>

        </div>
      `
      : qrImage
      ? `
        <div>

          <img
            class="qr-image"
            src="${qrImage}"
            alt="WhatsApp QR"
          >

          <div class="qr-label">

            Open WhatsApp
            <br>

            <b>
              Linked Devices → Link a Device
            </b>

            <br><br>

            QR automatically refreshes.

          </div>

        </div>
      `
      : `
        <div class="qr-wait">

          <div class="spinner"></div>

          <b>
            Generating secure QR...
          </b>

          <br><br>

          Please wait.

        </div>
      `
  }

  </div>

</div>

<!-- SIDE PANEL -->

<div>

  <div class="panel">

    <div class="panel-title">

      <h3>👑 Bot Owner</h3>

      <span>AUTHORIZED</span>

    </div>

    ${
      ownerJid
        ? `
          <div class="owner">

            <div class="owner-avatar">
              👤
            </div>

            <div>

              <div class="owner-title">
                LINKED WHATSAPP
              </div>

              <div class="owner-number">
                ${escapeHTML(
                  formatNumber(ownerJid)
                )}
              </div>

            </div>

          </div>
        `
        : `
          <div class="empty-box">
            Owner not connected
          </div>
        `
    }

  </div>

  <div class="panel" style="margin-top:20px">

    <div class="panel-title">

      <h3>⚡ Commands</h3>

      <span>OWNER ONLY</span>

    </div>

    <div class="command">

      <code>!stats</code>

      <span>7-day report</span>

    </div>

    <div class="command">

      <code>!groups</code>

      <span>Group list</span>

    </div>

  </div>

</div>

</div>

<!-- GROUPS -->

<div class="panel" style="margin-top:20px">

  <div class="panel-title">

    <h3>👥 Monitored Groups</h3>

    <span>
      ${savedGroups.length} ACTIVE
    </span>

  </div>

  ${groupsHTML}

</div>

<!-- REPORT PROGRESS -->

<div class="panel" style="margin-top:20px">

  <div class="panel-title">

    <h3>📊 7-Day Report Cycle</h3>

    <span>
      ${progress}% COMPLETE
    </span>

  </div>

  <div class="progress-area">

    <div class="progress-head">

      <span>
        Cycle progress
      </span>

      <span>
        ${progress}%
      </span>

    </div>

    <div class="progress">

      <div class="progress-bar"></div>

    </div>

  </div>

  <div style="
    margin-top:18px;
    color:#68738b;
    font-size:11px;
  ">

    Started:
    <b style="color:#aeb8ca">
      ${new Date(
        cycleStart
      ).toLocaleString("en-GB")}
    </b>

  </div>

</div>

<!-- ERROR -->

${
  lastError
    ? `
      <div class="panel"
        style="
          margin-top:20px;
          border-color:rgba(255,92,92,.2);
        "
      >

        <div style="
          color:#ff7777;
          font-size:12px;
          font-weight:700;
        ">
          ⚠️ SYSTEM NOTICE
        </div>

        <div style="
          color:#8994ad;
          font-size:11px;
          margin-top:8px;
        ">
          ${escapeHTML(lastError)}
        </div>

      </div>
    `
    : ""
}

<div class="footer">

  WhatsApp Report Bot • Premium Control Center

  <br><br>

  Auto refresh every 5 seconds

</div>

</div>

</body>
</html>
  `);
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: "ok",

    whatsapp:
      ownerJid
        ? "connected"
        : connectionStatus,

    groups:
      savedGroups.length,

    qr:
      latestQR
        ? "available"
        : "waiting",

    owner:
      ownerJid || null

  });

});

/* =========================================================
   FIND TARGET GROUPS
========================================================= */

async function findTargetGroups() {

  if (!sock) return;

  try {

    const groups =
      await sock.groupFetchAllParticipating();

    const found = [];

    for (
      const jid of Object.keys(groups)
    ) {

      const group =
        groups[jid];

      const groupName =
        group.subject || "";

      const normalized =
        normalizeGroupName(
          groupName
        );

      for (
        const targetName
        of TARGET_GROUP_NAMES
      ) {

        if (
          normalized ===
          normalizeGroupName(
            targetName
          )
        ) {

          if (
            !found.some(
              g => g.jid === jid
            )
          ) {

            found.push({
              jid,
              name: groupName
            });

          }

        }

      }

    }

    savedGroups =
      found.slice(0, 2);

    saveData();

    console.log("");
    console.log(
      "========== GROUPS =========="
    );

    if (
      !savedGroups.length
    ) {

      console.log(
        "❌ Target groups nahi mile."
      );

    } else {

      savedGroups.forEach(
        (g, i) => {

          console.log(
            `GROUP ${i + 1}: ${g.name}`
          );

          console.log(
            `JID: ${g.jid}`
          );

        }
      );

    }

    console.log(
      "============================"
    );
    console.log("");

  } catch (e) {

    console.log(
      "Group search error:",
      e.message
    );

    lastError =
      e.message;

  }

}

function isTargetGroup(jid) {

  return savedGroups.some(
    g => g.jid === jid
  );

}

/* =========================================================
   GROUP LIST
========================================================= */

async function sendGroupsList(chat) {

  let text =
    "📋 *BOT KE GROUPS*\n\n";

  if (
    !savedGroups.length
  ) {

    text +=
      "❌ Groups detect nahi hue.";

  } else {

    savedGroups.forEach(
      (g, i) => {

        text +=
          `${i + 1}. ${g.name}\n`;

      }
    );

  }

  await sock.sendMessage(
    chat,
    { text }
  );

}

/* =========================================================
   REPORT
========================================================= */

async function sendReport(groupJid) {

  try {

    const meta =
      await sock.groupMetadata(
        groupJid
      );

    const members =
      meta.participants.map(
        p => p.id
      );

    const groupData =
      messageLog[groupJid] || {};

    const start =
      botState.cycleStart;

    let text =
      `📊 *${REPORT_DAYS} DIN KI REPORT*\n\n`;

    text +=
      `👥 *GROUP:* ${meta.subject}\n`;

    text +=
      `🗓 *Start:* ${
        new Date(start)
          .toLocaleDateString("en-GB")
      }\n\n`;

    const active = [];
    const inactive = [];

    for (
      const member of members
    ) {

      const count =
        (groupData[member] || [])
          .filter(
            t => t >= start
          )
          .length;

      if (count > 0) {

        active.push([
          member,
          count
        ]);

      } else {

        inactive.push(member);

      }

    }

    active.sort(
      (a, b) => b[1] - a[1]
    );

    text +=
      "✅ *ACTIVE MEMBERS:*\n\n";

    if (!active.length) {

      text +=
        "Kisi ne message nahi kiya 😅\n";

    } else {

      for (
        const [member, count]
        of active
      ) {

        text +=
          `📱 ${formatNumber(member)} — *${count}* messages\n`;

      }

    }

    text +=
      `\n❌ *${REPORT_DAYS} DIN ME 0 MESSAGES:*\n\n`;

    if (!inactive.length) {

      text +=
        "Koi nahi — sab active ✅\n";

    } else {

      for (
        const member of inactive
      ) {

        text +=
          `📱 ${formatNumber(member)} — *0* messages 🚫\n`;

      }

    }

    await sock.sendMessage(
      groupJid,
      { text }
    );

    console.log(
      "✅ Report sent:",
      meta.subject
    );

  } catch (e) {

    console.log(
      "Report error:",
      e.message
    );

    lastError =
      e.message;

  }

}

/* =========================================================
   START BOT
========================================================= */

async function startBot() {

  if (reconnecting) {
    return;
  }

  reconnecting = true;

  try {

    connectionStatus =
      "connecting";

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    const {
      version
    } =
      await fetchLatestBaileysVersion();

    sock =
      makeWASocket({

        version,

        logger:
          pino({
            level: "silent"
          }),

        auth: {

          creds:
            state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              pino({
                level: "silent"
              })
            )

        },

        printQRInTerminal:
          false,

        connectTimeoutMs:
          60000,

        defaultQueryTimeoutMs:
          0,

        keepAliveIntervalMs:
          10000,

        generateHighQualityLinkPreview:
          false

      });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          qr,
          lastDisconnect
        } = update;

        /* QR GENERATED */

        if (qr) {

          latestQR =
            qr;

          qrGeneratedAt =
            Date.now();

          connectionStatus =
            "qr";

          console.log(
            "📱 NEW QR GENERATED"
          );

          console.log(
            "🌐 Open Render URL"
          );

        }

        /* OPEN */

        if (
          connection === "open"
        ) {

          latestQR =
            null;

          qrGeneratedAt =
            0;

          ownerJid =
            sock.user?.id ||
            null;

          connectionStatus =
            "connected";

          lastError =
            "";

          reconnecting =
            false;

          console.log(
            "================================"
          );

          console.log(
            "✅ WhatsApp Connected"
          );

          console.log(
            "👑 Owner:",
            ownerJid
          );

          console.log(
            "================================"
          );

          await findTargetGroups();

        }

        /* CLOSED */

        if (
          connection === "close"
        ) {

          ownerJid =
            null;

          latestQR =
            null;

          connectionStatus =
            "disconnected";

          let statusCode =
            null;

          try {

            statusCode =
              lastDisconnect
                ?.error
                ?.output
                ?.statusCode;

          } catch {}

          console.log(
            "❌ WhatsApp disconnected:",
            statusCode
          );

          reconnecting =
            false;

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "⚠️ WhatsApp logged out."
            );

            return;

          }

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(
            startBot,
            5000
          );

        }

      }
    );

    /* =====================================================
       MESSAGE HANDLER
    ===================================================== */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        try {

          const msg =
            messages[0];

          if (
            !msg ||
            !msg.message
          ) return;

          if (
            msg.key.fromMe
          ) return;

          const chat =
            msg.key.remoteJid;

          if (!chat) return;

          if (
            !chat.endsWith("@g.us")
          ) return;

          const sender =
            msg.key.participant ||
            msg.key.remoteJid;

          if (!sender) return;

          const text =
            msg.message.conversation ||
            msg.message
              .extendedTextMessage
              ?.text ||
            "";

          const command =
            text
              .trim()
              .toLowerCase();

          /* OWNER COMMAND */

          if (
            ownerJid &&
            normalizeJid(sender) ===
              normalizeJid(ownerJid)
          ) {

            if (
              command === "!groups"
            ) {

              await sendGroupsList(
                chat
              );

              return;

            }

          }

          /* TARGET GROUP ONLY */

          if (
            !isTargetGroup(chat)
          ) return;

          /* SAVE MESSAGE */

          if (
            !messageLog[chat]
          ) {

            messageLog[chat] =
              {};

          }

          if (
            !messageLog[chat][sender]
          ) {

            messageLog[chat][sender] =
              [];

          }

          const timestamp =
            Number(
              msg.messageTimestamp ||
              0
            ) * 1000;

          messageLog[chat][sender]
            .push(
              timestamp ||
              Date.now()
            );

          saveData();

          /* STATS */

          if (
            command !== "!stats"
          ) return;

          if (
            !ownerJid ||
            normalizeJid(sender) !==
              normalizeJid(ownerJid)
          ) {

            console.log(
              "⛔ Unauthorized !stats:",
              sender
            );

            return;

          }

          await sendReport(
            chat
          );

        } catch (e) {

          console.log(
            "Message error:",
            e.message
          );

        }

      }
    );

  } catch (e) {

    console.log(
      "Start error:",
      e.message
    );

    lastError =
      e.message;

    connectionStatus =
      "error";

    reconnecting =
      false;

    setTimeout(
      startBot,
      5000
    );

  }

}

/* =========================================================
   QR AUTO REFRESH
========================================================= */

setInterval(
  () => {

    if (
      latestQR &&
      Date.now() -
        qrGeneratedAt >
        QR_EXPIRE
    ) {

      console.log(
        "♻️ QR expired."
      );

      latestQR =
        null;

      qrGeneratedAt =
        0;

      try {

        if (
          sock &&
          sock.ws
        ) {

          sock.ws.close();

        }

      } catch (e) {

        console.log(
          "QR refresh error:",
          e.message
        );

      }

    }

  },
  10000
);

/* =========================================================
   AUTO 7-DAY REPORT
========================================================= */

setInterval(
  async () => {

    try {

      const end =
        botState.cycleStart +
        REPORT_DAYS *
          24 *
          60 *
          60 *
          1000;

      if (
        Date.now() >= end
      ) {

        if (
          sock &&
          ownerJid
        ) {

          console.log(
            "⏰ 7 DAYS COMPLETE"
          );

          for (
            const group
            of savedGroups
          ) {

            await sendReport(
              group.jid
            );

          }

          botState.cycleStart =
            Date.now();

          messageLog =
            {};

          saveData();

          console.log(
            "🔄 NEW 7-DAY CYCLE STARTED"
          );

        }

      }

    } catch (e) {

      console.log(
        "Auto report error:",
        e.message
      );

    }

  },
  60000
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🤖 PREMIUM WHATSAPP BOT"
    );

    console.log(
      "🌐 PORT:",
      PORT
    );

    console.log(
      "📱 PREMIUM PANEL: ENABLED"
    );

    console.log(
      "👥 GROUPS: 2"
    );

    console.log(
      "📊 7-DAY REPORT: ENABLED"
    );

    console.log(
      "================================"
    );

  }
);

console.log(
  "🚀 Starting WhatsApp..."
);

startBot();
