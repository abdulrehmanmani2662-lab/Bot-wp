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

/*
========================================
TARGET GROUPS
========================================
*/

const TARGET_GROUP_NAMES = [
  "مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن",
  "test"
];

const BASE = __dirname;

const AUTH_DIR =
  path.join(BASE, "auth");

const DATA_DIR =
  path.join(BASE, "data");

const LOG_FILE =
  path.join(DATA_DIR, "messageLog.json");

const STATE_FILE =
  path.join(DATA_DIR, "botState.json");

const GROUP_FILE =
  path.join(DATA_DIR, "groups.json");

const ALL_GROUP_FILE =
  path.join(DATA_DIR, "allGroups.json");


/*
========================================
CREATE DIRECTORIES
========================================
*/

for (const dir of [
  AUTH_DIR,
  DATA_DIR
]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
}


/*
========================================
JSON HELPERS
========================================
*/

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );
    }
  } catch (error) {
    console.log(
      "JSON load error:",
      error.message
    );
  }

  return fallback;
}


function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      "JSON save error:",
      error.message
    );
  }
}


/*
========================================
DATA
========================================
*/

let messageLog =
  loadJSON(
    LOG_FILE,
    {}
  );

let botState =
  loadJSON(
    STATE_FILE,
    {
      cycleStart: Date.now()
    }
  );

let savedGroups =
  loadJSON(
    GROUP_FILE,
    []
  );

let allGroups =
  loadJSON(
    ALL_GROUP_FILE,
    []
  );


function saveData() {

  saveJSON(
    LOG_FILE,
    messageLog
  );

  saveJSON(
    STATE_FILE,
    botState
  );

  saveJSON(
    GROUP_FILE,
    savedGroups
  );

  saveJSON(
    ALL_GROUP_FILE,
    allGroups
  );
}


/*
========================================
HELPERS
========================================
*/

function normalizeJid(jid) {

  return String(jid || "")
    .split(":")[0]
    .toLowerCase();

}


function formatNumber(jid) {

  let number =
    String(jid || "")
      .split("@")[0]
      .split(":")[0];

  if (
    number.startsWith("92")
  ) {
    number =
      "0" +
      number.slice(2);
  }

  return number;

}


/*
========================================
IMPORTANT GROUP NORMALIZER
========================================
*/

function normalizeGroupName(name) {

  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/*
========================================
GROUP MATCHING
========================================
*/

function groupMatches(
  actualName,
  targetName
) {

  const actual =
    normalizeGroupName(
      actualName
    );

  const target =
    normalizeGroupName(
      targetName
    );

  if (!actual || !target) {
    return false;
  }


  /*
  Exact match
  */

  if (
    actual === target
  ) {
    return true;
  }


  /*
  Partial match
  */

  if (
    actual.includes(target)
  ) {
    return true;
  }

  if (
    target.includes(actual)
  ) {
    return true;
  }


  /*
  Remove spaces and compare
  */

  const actualCompact =
    actual.replace(
      /\s+/g,
      ""
    );

  const targetCompact =
    target.replace(
      /\s+/g,
      ""
    );

  if (
    actualCompact ===
    targetCompact
  ) {
    return true;
  }


  if (
    actualCompact.includes(
      targetCompact
    )
  ) {
    return true;
  }

  if (
    targetCompact.includes(
      actualCompact
    )
  ) {
    return true;
  }


  return false;

}


/*
========================================
HTML ESCAPE
========================================
*/

function escapeHTML(text) {

  return String(text || "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/*
========================================
BOT STATE
========================================
*/

let sock = null;

let ownerJid = null;

let latestQR = null;

let qrGeneratedAt = 0;

let connectionStatus =
  "starting";

let lastError = "";

let reconnecting = false;

let connectedAt = null;

let deviceInfo = {

  platform:
    "Unknown",

  device:
    "Unknown",

  browser:
    "Unknown",

  os:
    "Unknown"

};

const QR_EXPIRE =
  50000;


/*
========================================
EXPRESS
========================================
*/

const app =
  express();

app.use(
  express.json()
);


/*
========================================
DASHBOARD
========================================
*/

app.get(
  "/",
  async (req, res) => {

    let qrImage = "";

    if (latestQR) {

      try {

        qrImage =
          await QRCode.toDataURL(
            latestQR
          );

      } catch {
        qrImage = "";
      }

    }


    const connected =
      !!ownerJid;


    const cycleStart =
      botState.cycleStart ||
      Date.now();


    const elapsed =
      Math.max(
        0,
        Date.now() -
        cycleStart
      );


    const totalTime =
      REPORT_DAYS *
      24 *
      60 *
      60 *
      1000;


    const progress =
      Math.min(
        100,
        Math.round(
          (
            elapsed /
            totalTime
          ) *
          100
        )
      );


    const daysPassed =
      Math.floor(
        elapsed /
        (
          24 *
          60 *
          60 *
          1000
        )
      );


    const daysLeft =
      Math.max(
        0,
        REPORT_DAYS -
        daysPassed
      );


    let totalMessages = 0;


    for (
      const groupJid
      of Object.keys(
        messageLog
      )
    ) {

      const users =
        messageLog[groupJid] ||
        {};


      for (
        const sender
        of Object.keys(users)
      ) {

        totalMessages +=
          users[sender].length;

      }

    }


    let statusText =
      "STARTING";

    let statusClass =
      "yellow";


    if (connected) {

      statusText =
        "CONNECTED";

      statusClass =
        "green";

    } else if (
      connectionStatus === "qr"
    ) {

      statusText =
        "SCAN QR";

      statusClass =
        "blue";

    } else if (
      connectionStatus ===
      "disconnected"
    ) {

      statusText =
        "RECONNECTING";

      statusClass =
        "red";

    }


    /*
    ========================================
    TARGET GROUP CARDS
    ========================================
    */

    const groupsHTML =
      savedGroups.length
        ? savedGroups
            .map(
              (group, index) => {

                const count =
                  getGroupMessageCount(
                    group.jid
                  );

                return `
                <div class="group-card">

                  <div class="group-icon">
                    ${
                      index === 0
                        ? "🏢"
                        : "🧪"
                    }
                  </div>

                  <div class="group-info">

                    <div class="group-name">
                      ${escapeHTML(
                        group.name
                      )}
                    </div>

                    <div class="group-jid">
                      ${escapeHTML(
                        group.jid
                      )}
                    </div>

                    <div class="group-count">
                      💬 ${count} messages
                    </div>

                  </div>

                  <div class="active-badge">
                    <span></span>
                    DETECTED
                  </div>

                </div>
                `;

              }
            )
            .join("")
        : `
          <div class="empty-box">

            <div class="empty-icon">
              👥
            </div>

            <b>
              No target groups detected
            </b>

            <small>
              Bot har 30 seconds mein groups
              dobara check karega.
            </small>

          </div>
        `;


    /*
    ========================================
    ALL GROUPS
    ========================================
    */

    const allGroupsHTML =
      allGroups.length
        ? allGroups
            .map(
              group => {

                const isTarget =
                  savedGroups.some(
                    g =>
                      g.jid ===
                      group.jid
                  );

                return `
                <div class="all-group">

                  <div>
                    <div class="all-group-name">
                      ${escapeHTML(
                        group.name
                      )}
                    </div>

                    <div class="all-group-jid">
                      ${escapeHTML(
                        group.jid
                      )}
                    </div>
                  </div>

                  ${
                    isTarget
                      ? `
                        <span class="target-tag">
                          TARGET
                        </span>
                      `
                      : `
                        <span class="normal-tag">
                          GROUP
                        </span>
                      `
                  }

                </div>
                `;

              }
            )
            .join("")
        : `
          <div class="empty-box">
            No groups loaded yet.
          </div>
        `;


    /*
    ========================================
    QR
    ========================================
    */

    const qrHTML =
      qrImage
        ? `
          <div class="qr-container">

            <div class="qr-title">
              Scan QR with WhatsApp
            </div>

            <img
              src="${qrImage}"
              class="qr"
              alt="WhatsApp QR"
            />

            <div class="qr-refresh">
              QR automatically refreshes.
            </div>

          </div>
        `
        : `
          <div class="qr-wait">

            <div class="spinner"></div>

            <h3>
              ${
                connected
                  ? "WhatsApp Connected"
                  : "Waiting for QR..."
              }
            </h3>

            <p>
              ${
                connected
                  ? "Bot successfully connected."
                  : "QR generate hote hi yahan show hoga."
              }
            </p>

          </div>
        `;


    const uptime =
      connectedAt
        ? formatDuration(
            Date.now() -
            connectedAt
          )
        : "Offline";


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
  content="15"
>

<title>
WhatsApp Report Bot
</title>


<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  font-family:
    Inter,
    Arial,
    sans-serif;

  color: white;

  min-height: 100vh;

  background:
    radial-gradient(
      circle at top left,
      #192542,
      #080b14 48%,
      #04060b
    );

}

.container {

  width: 94%;

  max-width: 1250px;

  margin: auto;

  padding:
    25px 0 50px;

}


.header {

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 20px;

  padding: 22px;

  margin-bottom: 20px;

  border-radius: 24px;

  background:
    rgba(255,255,255,.045);

  border:
    1px solid
    rgba(255,255,255,.08);

  backdrop-filter:
    blur(20px);

}


.brand {

  display: flex;

  align-items: center;

  gap: 15px;

}


.logo {

  width: 55px;

  height: 55px;

  display: flex;

  align-items: center;

  justify-content: center;

  border-radius: 17px;

  font-size: 27px;

  background:
    linear-gradient(
      135deg,
      #25d366,
      #128c7e
    );

}


.brand h1 {

  margin: 0;

  font-size: 22px;

}


.brand p {

  margin: 5px 0 0;

  color: #8993a8;

  font-size: 13px;

}


.status {

  display: flex;

  align-items: center;

  gap: 8px;

  padding:
    10px 15px;

  border-radius: 50px;

  background:
    rgba(255,255,255,.05);

  font-size: 12px;

  font-weight: bold;

}


.dot {

  width: 9px;

  height: 9px;

  border-radius: 50%;

}


.green .dot {

  background: #25d366;

  box-shadow:
    0 0 15px
    #25d366;

}


.yellow .dot {

  background: #ffc107;

}


.blue .dot {

  background: #2196f3;

}


.red .dot {

  background: #ff5252;

}


.stats {

  display: grid;

  grid-template-columns:
    repeat(4,1fr);

  gap: 15px;

  margin-bottom: 20px;

}


.stat {

  padding: 20px;

  border-radius: 20px;

  background:
    rgba(255,255,255,.045);

  border:
    1px solid
    rgba(255,255,255,.07);

}


.stat-icon {

  font-size: 22px;

}


.stat-title {

  margin-top: 12px;

  color: #8e99ae;

  font-size: 12px;

}


.stat-value {

  margin-top: 5px;

  font-size: 23px;

  font-weight: 800;

}


.grid {

  display: grid;

  grid-template-columns:
    1.2fr .8fr;

  gap: 20px;

}


.card {

  padding: 22px;

  border-radius: 24px;

  background:
    rgba(255,255,255,.045);

  border:
    1px solid
    rgba(255,255,255,.07);

  margin-bottom: 20px;

}


.card-title {

  display: flex;

  justify-content:
    space-between;

  align-items: center;

  margin-bottom: 18px;

}


.card-title h2 {

  margin: 0;

  font-size: 17px;

}


.card-title span {

  color: #8993a8;

  font-size: 11px;

}


.device {

  padding: 18px;

  border-radius: 18px;

  background:
    rgba(0,0,0,.20);

}


.device-row {

  display: flex;

  justify-content:
    space-between;

  gap: 15px;

  padding: 9px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.06);

}


.device-row:last-child {

  border-bottom: 0;

}


.device-label {

  color: #8993a8;

  font-size: 12px;

}


.device-value {

  font-size: 13px;

  font-weight: 600;

  text-align: right;

}


.online {

  color: #25d366;

}


.notice {

  margin-top: 15px;

  padding: 13px;

  border-radius: 15px;

  background:
    rgba(33,150,243,.08);

  border:
    1px solid
    rgba(33,150,243,.15);

  color: #9ecaff;

  font-size: 11px;

  line-height: 1.6;

}


.qr-container {

  text-align: center;

}


.qr-title {

  color: #b9c2d4;

  margin-bottom: 15px;

}


.qr {

  width: 250px;

  max-width: 100%;

  padding: 10px;

  background: white;

  border-radius: 18px;

}


.qr-refresh {

  color: #7f8a9e;

  font-size: 11px;

  margin-top: 12px;

}


.qr-wait {

  text-align: center;

  padding: 35px 10px;

}


.spinner {

  width: 40px;

  height: 40px;

  margin: auto;

  border: 4px solid
    rgba(255,255,255,.1);

  border-top-color:
    #25d366;

  border-radius: 50%;

  animation:
    spin 1s linear infinite;

}


@keyframes spin {

  to {
    transform:
      rotate(360deg);
  }

}


.qr-wait p {

  color: #7f8a9e;

  font-size: 12px;

}


.group-card {

  display: flex;

  align-items: center;

  gap: 13px;

  padding: 14px;

  margin-bottom: 10px;

  border-radius: 17px;

  background:
    rgba(0,0,0,.18);

}


.group-icon {

  width: 43px;

  height: 43px;

  border-radius: 13px;

  display: flex;

  align-items: center;

  justify-content: center;

  background:
    rgba(255,255,255,.07);

  font-size: 20px;

}


.group-info {

  min-width: 0;

  flex: 1;

}


.group-name {

  font-size: 13px;

  font-weight: 700;

}


.group-jid {

  color: #69758b;

  font-size: 9px;

  margin-top: 4px;

}


.group-count {

  color: #7f8a9e;

  font-size: 10px;

  margin-top: 5px;

}


.active-badge {

  display: flex;

  align-items: center;

  gap: 5px;

  color: #25d366;

  font-size: 9px;

  font-weight: 800;

}


.active-badge span {

  width: 6px;

  height: 6px;

  border-radius: 50%;

  background: #25d366;

}


.all-group {

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 10px;

  padding: 12px;

  margin-bottom: 8px;

  border-radius: 14px;

  background:
    rgba(0,0,0,.16);

}


.all-group-name {

  font-size: 12px;

  font-weight: 600;

}


.all-group-jid {

  color: #667187;

  font-size: 9px;

  margin-top: 4px;

}


.target-tag,
.normal-tag {

  padding:
    5px 8px;

  border-radius: 8px;

  font-size: 8px;

  font-weight: bold;

}


.target-tag {

  color: #25d366;

  background:
    rgba(37,211,102,.10);

}


.normal-tag {

  color: #7f8a9e;

  background:
    rgba(255,255,255,.05);

}


.progress-wrap {

  margin-top: 10px;

}


.progress-info {

  display: flex;

  justify-content:
    space-between;

  color: #8b96aa;

  font-size: 11px;

  margin-bottom: 8px;

}


.progress {

  height: 8px;

  background:
    rgba(255,255,255,.08);

  border-radius: 20px;

  overflow: hidden;

}


.progress-bar {

  height: 100%;

  width:
    ${progress}%;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #6ee7b7
    );

}


.empty-box {

  text-align: center;

  padding: 30px;

  color: #8893a8;

}


.empty-icon {

  font-size: 35px;

  margin-bottom: 10px;

}


.empty-box b {

  display: block;

  color: white;

}


.empty-box small {

  display: block;

  margin-top: 7px;

}


.footer {

  text-align: center;

  color: #5d687b;

  font-size: 11px;

  margin-top: 5px;

}


@media(max-width:850px) {

  .stats {

    grid-template-columns:
      repeat(2,1fr);

  }

  .grid {

    grid-template-columns:
      1fr;

  }

}


@media(max-width:500px) {

  .header {

    flex-direction:
      column;

    align-items:
      flex-start;

  }

  .stats {

    grid-template-columns:
      1fr 1fr;

  }

  .stat {

    padding: 15px;

  }

}

</style>

</head>


<body>

<div class="container">


<div class="header">

  <div class="brand">

    <div class="logo">
      💬
    </div>

    <div>

      <h1>
        WhatsApp Report Bot
      </h1>

      <p>
        7-Day Group Monitoring System
      </p>

    </div>

  </div>


  <div class="status ${statusClass}">

    <span class="dot"></span>

    ${statusText}

  </div>

</div>


<div class="stats">

  <div class="stat">

    <div class="stat-icon">
      📱
    </div>

    <div class="stat-title">
      WHATSAPP
    </div>

    <div class="stat-value">
      ${connected
        ? "Online"
        : "Offline"}
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
      ${savedGroups.length}/2
    </div>

  </div>


  <div class="stat">

    <div class="stat-icon">
      💬
    </div>

    <div class="stat-title">
      MESSAGES
    </div>

    <div class="stat-value">
      ${totalMessages}
    </div>

  </div>


  <div class="stat">

    <div class="stat-icon">
      ⏱️
    </div>

    <div class="stat-title">
      UPTIME
    </div>

    <div class="stat-value">
      ${uptime}
    </div>

  </div>

</div>


<div class="grid">


<div>


<div class="card">

  <div class="card-title">

    <h2>
      📱 Linked WhatsApp Device
    </h2>

    <span>
      LIVE
    </span>

  </div>


  <div class="device">

    <div class="device-row">

      <span class="device-label">
        Status
      </span>

      <span class="device-value online">
        ${connected
          ? "● Connected"
          : "● " + statusText}
      </span>

    </div>


    <div class="device-row">

      <span class="device-label">
        WhatsApp Number
      </span>

      <span class="device-value">
        ${
          ownerJid
            ? escapeHTML(
                formatNumber(
                  ownerJid
                )
              )
            : "Not linked"
        }
      </span>

    </div>


    <div class="device-row">

      <span class="device-label">
        Platform
      </span>

      <span class="device-value">
        ${escapeHTML(
          deviceInfo.platform
        )}
      </span>

    </div>


    <div class="device-row">

      <span class="device-label">
        Device
      </span>

      <span class="device-value">
        ${escapeHTML(
          deviceInfo.device
        )}
      </span>

    </div>


    <div class="device-row">

      <span class="device-label">
        Browser
      </span>

      <span class="device-value">
        ${escapeHTML(
          deviceInfo.browser
        )}
      </span>

    </div>

  </div>


  <div class="notice">

    🔒 WhatsApp linked device ka
    public IP/country Baileys session
    se reliably available nahi hota.

  </div>

</div>


<div class="card">

  <div class="card-title">

    <h2>
      👥 Target Groups
    </h2>

    <span>
      ${savedGroups.length}/2 DETECTED
    </span>

  </div>

  ${groupsHTML}

</div>


</div>


<div>


<div class="card">

  <div class="card-title">

    <h2>
      🔐 WhatsApp QR
    </h2>

    <span>
      AUTO REFRESH
    </span>

  </div>

  ${qrHTML}

</div>


<div class="card">

  <div class="card-title">

    <h2>
      📋 All WhatsApp Groups
    </h2>

    <span>
      ${allGroups.length} FOUND
    </span>

  </div>

  ${allGroupsHTML}

</div>


<div class="card">

  <div class="card-title">

    <h2>
      📊 7-Day Cycle
    </h2>

    <span>
      ${daysLeft} DAYS LEFT
    </span>

  </div>


  <div class="progress-wrap">

    <div class="progress-info">

      <span>
        ${progress}% completed
      </span>

      <span>
        ${REPORT_DAYS} days
      </span>

    </div>


    <div class="progress">

      <div class="progress-bar"></div>

    </div>

  </div>

</div>


</div>

</div>


<div class="footer">

  WhatsApp Report Bot
  • Auto Group Detection
  • Auto 7-Day Reports

</div>


</div>

</body>

</html>
`);

  }
);


/*
========================================
HEALTH
========================================
*/

app.get(
  "/health",
  (req, res) => {

    res.json({

      status:
        "ok",

      whatsapp:
        ownerJid
          ? "connected"
          : connectionStatus,

      owner:
        ownerJid || null,

      number:
        ownerJid
          ? formatNumber(
              ownerJid
            )
          : null,

      targetGroups:
        savedGroups,

      allGroups:
        allGroups.length,

      qr:
        latestQR
          ? "available"
          : "waiting",

      device:
        deviceInfo,

      lastError:
        lastError || null

    });

  }
);


/*
========================================
GROUP MESSAGE COUNT
========================================
*/

function getGroupMessageCount(
  groupJid
) {

  const data =
    messageLog[groupJid] ||
    {};

  let total = 0;

  for (
    const sender
    of Object.keys(data)
  ) {

    total +=
      data[sender].length;

  }

  return total;

}


/*
========================================
DURATION
========================================
*/

function formatDuration(ms) {

  const seconds =
    Math.floor(
      ms / 1000
    );

  const days =
    Math.floor(
      seconds / 86400
    );

  const hours =
    Math.floor(
      (seconds % 86400) /
      3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) /
      60
    );


  if (days > 0) {

    return (
      `${days}d ${hours}h`
    );

  }


  if (hours > 0) {

    return (
      `${hours}h ${minutes}m`
    );

  }


  return (
    `${minutes}m`
  );

}


/*
========================================
FIND ALL GROUPS
========================================
*/

async function findTargetGroups() {

  if (!sock) {

    console.log(
      "⚠️ Socket not ready"
    );

    return;

  }


  try {

    console.log(
      "🔍 Scanning WhatsApp groups..."
    );


    const groups =
      await sock.groupFetchAllParticipating();


    const foundAll = [];


    for (
      const jid
      of Object.keys(groups)
    ) {

      const group =
        groups[jid];


      if (!group) continue;


      const name =
        String(
          group.subject ||
          ""
        ).trim();


      if (!name) continue;


      foundAll.push({

        jid,

        name

      });

    }


    /*
    SAVE ALL GROUPS
    */

    allGroups =
      foundAll.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );


    /*
    FIND TARGETS
    */

    const detected = [];


    for (
      const targetName
      of TARGET_GROUP_NAMES
    ) {

      let match =
        foundAll.find(
          group =>
            groupMatches(
              group.name,
              targetName
            )
        );


      /*
      If multiple possible
      matches, take first.
      */

      if (
        match &&
        !detected.some(
          g =>
            g.jid ===
            match.jid
        )
      ) {

        detected.push({

          jid:
            match.jid,

          name:
            match.name,

          target:
            targetName

        });

      }

    }


    savedGroups =
      detected.slice(0, 2);


    saveData();


    console.log(
      "================================"
    );

    console.log(
      "📋 TOTAL GROUPS FOUND:",
      allGroups.length
    );

    console.log(
      "🎯 TARGET GROUPS FOUND:",
      savedGroups.length
    );


    if (
      savedGroups.length
    ) {

      savedGroups.forEach(
        group => {

          console.log(
            "✅",
            group.name
          );

          console.log(
            "   JID:",
            group.jid
          );

        }
      );

    } else {

      console.log(
        "❌ TARGET GROUPS NOT FOUND"
      );

      console.log(
        "Expected groups:"
      );

      TARGET_GROUP_NAMES.forEach(
        name => {

          console.log(
            " -",
            name
          );

        }
      );

    }


    console.log(
      "================================"
    );


  } catch (error) {

    console.log(
      "❌ Group detection error:",
      error.message
    );

    lastError =
      error.message;

  }

}


/*
========================================
GROUP LIST COMMAND
========================================
*/

async function sendGroupsList(
  chat
) {

  let text =
    "📋 *WHATSAPP GROUPS*\n\n";


  if (!allGroups.length) {

    text +=
      "❌ Abhi groups detect nahi hue.";

  } else {

    allGroups.forEach(
      (group, index) => {

        const target =
          savedGroups.some(
            g =>
              g.jid ===
              group.jid
          );

        text +=
          `${index + 1}. ${group.name}`;

        if (target) {

          text +=
            " ✅ TARGET";

        }

        text +=
          "\n";

      }
    );

  }


  await sock.sendMessage(
    chat,
    {
      text
    }
  );

}


/*
========================================
SEND REPORT
========================================
*/

async function sendReport(
  groupJid
) {

  try {

    const meta =
      await sock.groupMetadata(
        groupJid
      );


    const members =
      meta.participants.map(
        p =>
          p.id
      );


    const groupData =
      messageLog[groupJid] ||
      {};


    const start =
      botState.cycleStart;


    let text =
      `📊 *${REPORT_DAYS} DIN KI REPORT*\n\n`;


    text +=
      `👥 *GROUP:* ${meta.subject}\n`;


    text +=
      `🗓 *Start:* ${
        new Date(start)
          .toLocaleDateString(
            "en-GB"
          )
      }\n\n`;


    const active = [];

    const inactive = [];


    for (
      const member
      of members
    ) {

      const count =
        (
          groupData[member] ||
          []
        ).filter(
          time =>
            time >= start
        ).length;


      if (count > 0) {

        active.push([
          member,
          count
        ]);

      } else {

        inactive.push(
          member
        );

      }

    }


    active.sort(
      (a, b) =>
        b[1] - a[1]
    );


    text +=
      "✅ *ACTIVE MEMBERS:*\n\n";


    if (!active.length) {

      text +=
        "Kisi ne message nahi kiya 😅\n";

    } else {

      for (
        const [
          member,
          count
        ]
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
        const member
        of inactive
      ) {

        text +=
          `📱 ${formatNumber(member)} — *0* messages 🚫\n`;

      }

    }


    await sock.sendMessage(
      groupJid,
      {
        text
      }
    );


    console.log(
      "✅ Report sent:",
      meta.subject
    );


  } catch (error) {

    console.log(
      "Report error:",
      error.message
    );

  }

}


/*
========================================
START BOT
========================================
*/

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
            level:
              "silent"
          }),

        auth: {

          creds:
            state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              pino({
                level:
                  "silent"
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


    /*
    ========================================
    CONNECTION UPDATE
    ========================================
    */

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          qr,
          lastDisconnect
        } = update;


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

        }


        if (
          connection ===
          "open"
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

          connectedAt =
            Date.now();

          lastError =
            "";

          reconnecting =
            false;


          try {

            const user =
              sock.user ||
              {};


            deviceInfo = {

              platform:
                user.platform ||
                "WhatsApp",

              device:
                user.name ||
                "Linked Device",

              browser:
                user.platform ||
                "WhatsApp Web",

              os:
                "Unknown"

            };

          } catch {}


          console.log(
            "================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED"
          );

          console.log(
            "👑 OWNER:",
            ownerJid
          );

          console.log(
            "================================"
          );


          /*
          FIRST GROUP SCAN
          */

          await findTargetGroups();

        }


        if (
          connection ===
          "close"
        ) {

          ownerJid =
            null;

          connectedAt =
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


    /*
    ========================================
    MESSAGE LISTENER
    ========================================
    */

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
            !chat.endsWith(
              "@g.us"
            )
          ) return;


          const sender =
            msg.key.participant ||
            msg.key.remoteJid;


          if (!sender) return;


          const text =
            msg.message
              .conversation ||
            msg.message
              .extendedTextMessage
              ?.text ||
            "";


          const command =
            text
              .trim()
              .toLowerCase();


          /*
          OWNER COMMAND
          */

          if (
            ownerJid &&
            normalizeJid(
              sender
            ) ===
            normalizeJid(
              ownerJid
            )
          ) {

            if (
              command ===
              "!groups"
            ) {

              await sendGroupsList(
                chat
              );

              return;

            }

          }


          /*
          ONLY TARGET GROUPS
          */

          if (
            !isTargetGroup(
              chat
            )
          ) {

            return;

          }


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


          /*
          STATS
          */

          if (
            command !==
            "!stats"
          ) {

            return;

          }


          if (
            !ownerJid ||
            normalizeJid(
              sender
            ) !==
            normalizeJid(
              ownerJid
            )
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


        } catch (error) {

          console.log(
            "Message error:",
            error.message
          );

        }

      }
    );


  } catch (error) {

    console.log(
      "Start error:",
      error.message
    );


    lastError =
      error.message;


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


/*
========================================
TARGET CHECK
========================================
*/

function isTargetGroup(
  jid
) {

  return savedGroups.some(
    group =>
      group.jid === jid
  );

}


/*
========================================
QR WATCHDOG
========================================
*/

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

      } catch (error) {

        console.log(
          "QR refresh error:",
          error.message
        );

      }

    }

  },
  10000
);


/*
========================================
AUTO GROUP RESCAN
========================================

This is the important fix.
Every 30 seconds the bot scans
WhatsApp groups again.
*/

setInterval(
  async () => {

    if (
      sock &&
      ownerJid &&
      connectionStatus ===
      "connected"
    ) {

      await findTargetGroups();

    }

  },
  30000
);


/*
========================================
AUTO 7-DAY REPORT
========================================
*/

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

    } catch (error) {

      console.log(
        "Auto report error:",
        error.message
      );

    }

  },
  60000
);


/*
========================================
SERVER
========================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🤖 WHATSAPP REPORT BOT"
    );

    console.log(
      "🌐 PORT:",
      PORT
    );

    console.log(
      "👥 AUTO GROUP DETECTION: ON"
    );

    console.log(
      "🔄 GROUP RESCAN: 30 SEC"
    );

    console.log(
      "📊 7-DAY REPORT: ON"
    );

    console.log(
      "================================"
    );

  }
);


/*
========================================
START
========================================
*/

console.log(
  "🚀 Starting WhatsApp..."
);

startBot();
