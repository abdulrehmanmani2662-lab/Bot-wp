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

/*
========================================
FILES
========================================
*/

const BASE = __dirname;

const AUTH_DIR = path.join(BASE, "auth");
const DATA_DIR = path.join(BASE, "data");

const LOG_FILE = path.join(DATA_DIR, "messageLog.json");
const STATE_FILE = path.join(DATA_DIR, "botState.json");
const GROUP_FILE = path.join(DATA_DIR, "groups.json");
const ALL_GROUP_FILE = path.join(DATA_DIR, "allGroups.json");
const LID_MAP_FILE = path.join(DATA_DIR, "lidMap.json");

for (const dir of [AUTH_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/*
========================================
JSON
========================================
*/

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(
        fs.readFileSync(file, "utf8")
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
      JSON.stringify(data, null, 2)
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

let messageLog = loadJSON(
  LOG_FILE,
  {}
);

let botState = loadJSON(
  STATE_FILE,
  {
    cycleStart: Date.now()
  }
);

let savedGroups = loadJSON(
  GROUP_FILE,
  []
);

let allGroups = loadJSON(
  ALL_GROUP_FILE,
  []
);

let lidMap = loadJSON(
  LID_MAP_FILE,
  {}
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

  saveJSON(
    LID_MAP_FILE,
    lidMap
  );
}

/*
========================================
JID HELPERS
========================================
*/

function normalizeJid(jid) {

  return String(jid || "")
    .trim()
    .split(":")[0]
    .toLowerCase();

}

function isLid(jid) {

  return normalizeJid(jid)
    .endsWith("@lid");

}

function isPhoneJid(jid) {

  return normalizeJid(jid)
    .endsWith("@s.whatsapp.net");

}

function phoneNumberFromJid(jid) {

  const n =
    normalizeJid(jid);

  if (
    n.endsWith("@s.whatsapp.net")
  ) {

    return n.replace(
      "@s.whatsapp.net",
      ""
    );

  }

  return null;
}

function formatNumber(jid) {

  const n =
    normalizeJid(jid);

  let number = "";

  if (
    n.endsWith("@s.whatsapp.net")
  ) {

    number =
      n.replace(
        "@s.whatsapp.net",
        ""
      );

  } else if (
    n.endsWith("@c.us")
  ) {

    number =
      n.replace(
        "@c.us",
        ""
      );

  } else if (
    n.endsWith("@lid")
  ) {

    number =
      n.replace(
        "@lid",
        ""
      );

  } else {

    number =
      n.split("@")[0];

  }

  return number;
}

/*
========================================
LID ↔ PHONE MAPPING
========================================
*/

function rememberIdentity(
  lid,
  phone
) {

  const l =
    normalizeJid(lid);

  const p =
    normalizeJid(phone);

  if (!l || !p) {
    return false;
  }

  if (!isLid(l)) {
    return false;
  }

  if (!isPhoneJid(p)) {
    return false;
  }

  if (lidMap[l] !== p) {

    lidMap[l] = p;

    return true;
  }

  return false;
}

function getPhoneFromAnyId(id) {

  const n =
    normalizeJid(id);

  if (!n) {
    return null;
  }

  if (isPhoneJid(n)) {

    return phoneNumberFromJid(n);

  }

  if (
    isLid(n) &&
    lidMap[n]
  ) {

    return phoneNumberFromJid(
      lidMap[n]
    );

  }

  return null;
}

function getMemberNumber(
  participant
) {

  const candidates = [
    participant?.phoneNumber,
    participant?.id,
    participant?.lid
  ];

  /*
  Direct phone
  */

  for (
    const id
    of candidates
  ) {

    if (isPhoneJid(id)) {

      return `+${formatNumber(id)}`;

    }

  }

  /*
  LID mapping
  */

  for (
    const id
    of candidates
  ) {

    const phone =
      getPhoneFromAnyId(id);

    if (phone) {

      return `+${phone}`;

    }

  }

  /*
  Last fallback
  */

  return formatNumber(
    participant?.id ||
    participant?.lid ||
    ""
  );
}

/*
========================================
GROUP NAME MATCHING
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

  if (actual === target) {
    return true;
  }

  if (actual.includes(target)) {
    return true;
  }

  if (target.includes(actual)) {
    return true;
  }

  const actualCompact =
    actual.replace(/\s+/g, "");

  const targetCompact =
    target.replace(/\s+/g, "");

  if (
    actualCompact === targetCompact
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
    .replace(/&/g, "&amp;")
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
BOT VARIABLES
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

const QR_EXPIRE = 50000;

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

    if (
      Array.isArray(
        data[sender]
      )
    ) {

      total +=
        data[sender].length;

    }

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
    Math.floor(ms / 1000);

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

    return `${days}d ${hours}h`;

  }

  if (hours > 0) {

    return `${hours}h ${minutes}m`;

  }

  return `${minutes}m`;
}

/*
========================================
TARGET CHECK
========================================
*/

function isTargetGroup(jid) {

  return savedGroups.some(
    group =>
      group.jid === jid
  );

}

/*
========================================
GET MESSAGE COUNT FOR MEMBER
========================================
*/

function getMessagesForMember(
  groupData,
  participant
) {

  const candidates =
    new Set();

  const ids = [

    participant?.id,

    participant?.lid,

    participant?.phoneNumber

  ];

  for (
    const id
    of ids
  ) {

    const n =
      normalizeJid(id);

    if (!n) {
      continue;
    }

    candidates.add(n);

    /*
    LID → phone
    */

    if (
      isLid(n) &&
      lidMap[n]
    ) {

      candidates.add(
        normalizeJid(
          lidMap[n]
        )
      );

    }

  }

  /*
  Phone → LID reverse mapping
  */

  for (
    const [lid, phone]
    of Object.entries(lidMap)
  ) {

    for (
      const id
      of ids
    ) {

      const n =
        normalizeJid(id);

      if (
        isPhoneJid(n) &&
        normalizeJid(phone) === n
      ) {

        candidates.add(
          normalizeJid(lid)
        );

      }

    }

  }

  let result = [];

  /*
  Search all possible sender IDs
  */

  for (
    const key
    of candidates
  ) {

    if (
      Array.isArray(
        groupData[key]
      )
    ) {

      result =
        result.concat(
          groupData[key]
        );

    }

  }

  /*
  Old data can sometimes
  contain duplicate aliases.
  */

  result =
    [...new Set(result)];

  const start =
    Number(
      botState.cycleStart ||
      Date.now()
    );

  return result.filter(
    time =>
      Number(time) >= start
  );
}

/*
========================================
REPORT
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

    const groupData =
      messageLog[groupJid] ||
      {};

    let mappingChanged =
      false;

    /*
    Build mappings from metadata
    */

    for (
      const participant
      of meta.participants || []
    ) {

      if (
        participant.id &&
        participant.phoneNumber
      ) {

        if (
          rememberIdentity(
            participant.id,
            participant.phoneNumber
          )
        ) {

          mappingChanged =
            true;

        }

      }

      if (
        participant.lid &&
        participant.phoneNumber
      ) {

        if (
          rememberIdentity(
            participant.lid,
            participant.phoneNumber
          )
        ) {

          mappingChanged =
            true;

        }

      }

    }

    if (mappingChanged) {

      saveJSON(
        LID_MAP_FILE,
        lidMap
      );

    }

    const active = [];

    const inactive = [];

    let totalMessages = 0;

    /*
    Every group member
    */

    for (
      const participant
      of meta.participants || []
    ) {

      const times =
        getMessagesForMember(
          groupData,
          participant
        );

      const count =
        times.length;

      const number =
        getMemberNumber(
          participant
        );

      if (count > 0) {

        active.push({

          number,

          count

        });

        totalMessages +=
          count;

      } else {

        inactive.push({

          number,

          count: 0

        });

      }

    }

    /*
    Highest message first
    */

    active.sort(
      (a, b) =>
        b.count - a.count
    );

    let text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n";

    text +=
      "   📊 *7 DIN KI REPORT*\n";

    text +=
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

    text +=
      `👥 *GROUP:* ${meta.subject}\n`;

    text +=
      `🗓 *START:* ${
        new Date(
          botState.cycleStart
        ).toLocaleDateString(
          "en-GB"
        )
      }\n`;

    text +=
      `💬 *TOTAL MESSAGES:* ${totalMessages}\n\n`;

    /*
    ACTIVE
    */

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🟢 *ACTIVE MEMBERS*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (!active.length) {

      text +=
        "😅 Kisi ne message nahi kiya.\n\n";

    } else {

      let number =
        1;

      for (
        const user
        of active
      ) {

        text +=
          `${number}. 📱 *${user.number}*\n`;

        text +=
          `   💬 *${user.count} messages*\n\n`;

        number++;

      }

    }

    /*
    INACTIVE
    */

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🔴 *0 MESSAGES*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (!inactive.length) {

      text +=
        "🎉 Sab members active hain!\n";

    } else {

      let number =
        1;

      for (
        const user
        of inactive
      ) {

        text +=
          `${number}. 📱 ${user.number} — *0 messages* 🚫\n`;

        number++;

      }

    }

    /*
    FOOTER
    */

    text +=
      "\n━━━━━━━━━━━━━━━━━━━━\n";

    text +=
      `📈 *ACTIVE:* ${active.length}\n`;

    text +=
      `📉 *INACTIVE:* ${inactive.length}\n`;

    text +=
      `💬 *TOTAL:* ${totalMessages}\n`;

    text +=
      "━━━━━━━━━━━━━━━━━━━━";

    await sock.sendMessage(
      groupJid,
      {
        text
      }
    );

    console.log(
      "✅ REPORT SENT:",
      meta.subject,
      "|",
      totalMessages,
      "messages"
    );

  } catch (error) {

    console.log(
      "❌ REPORT ERROR:",
      error.message
    );

  }

}

/*
========================================
GROUP SCAN
========================================
*/

async function findTargetGroups() {

  if (!sock) {

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

      if (!group) {
        continue;
      }

      const name =
        String(
          group.subject || ""
        ).trim();

      if (!name) {
        continue;
      }

      foundAll.push({

        jid,

        name

      });

    }

    allGroups =
      foundAll.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

    const detected = [];

    for (
      const targetName
      of TARGET_GROUP_NAMES
    ) {

      const match =
        foundAll.find(
          group =>
            groupMatches(
              group.name,
              targetName
            )
        );

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

    console.log(
      "================================"
    );

  } catch (error) {

    console.log(
      "❌ GROUP SCAN ERROR:",
      error.message
    );

    lastError =
      error.message;

  }

}

/*
========================================
GROUP LIST
========================================
*/

async function sendGroupsList(
  chat
) {

  let text =
    "╭━━━━━━━━━━━━━━━━━━━━╮\n";

  text +=
    "   📋 *WHATSAPP GROUPS*\n";

  text +=
    "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

  if (!allGroups.length) {

    text +=
      "❌ Groups abhi detect nahi hue.";

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
          `${index + 1}. ${
            target
              ? "🎯"
              : "📁"
          } *${group.name}*\n`;

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
EXPRESS DASHBOARD
========================================
*/

app.get(
  "/",
  async (req, res) => {

    let qrImage =
      "";

    if (latestQR) {

      try {

        qrImage =
          await QRCode.toDataURL(
            latestQR
          );

      } catch {

        qrImage =
          "";

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
          ) * 100
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

    let totalMessages =
      0;

    for (
      const groupJid
      of Object.keys(
        messageLog
      )
    ) {

      const users =
        messageLog[
          groupJid
        ] || {};

      for (
        const sender
        of Object.keys(users)
      ) {

        if (
          Array.isArray(
            users[sender]
          )
        ) {

          totalMessages +=
            users[sender].length;

        }

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
      connectionStatus ===
      "qr"
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
    TARGET GROUPS
    */

    const groupsHTML =
      savedGroups.length
        ? savedGroups.map(
            (group, index) => {

              const count =
                getGroupMessageCount(
                  group.jid
                );

              return `
<div class="group-card">

  <div class="group-icon">
    ${index === 0 ? "🏢" : "🧪"}
  </div>

  <div class="group-info">

    <div class="group-name">
      ${escapeHTML(group.name)}
    </div>

    <div class="group-jid">
      ${escapeHTML(group.jid)}
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
          ).join("")
        : `
<div class="empty-box">

  <div class="empty-icon">
    👥
  </div>

  <b>
    No target groups detected
  </b>

  <small>
    Bot har 30 seconds mein groups dobara check karega.
  </small>

</div>
`;

    /*
    ALL GROUPS
    */

    const allGroupsHTML =
      allGroups.length
        ? allGroups.map(
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
      ${escapeHTML(group.name)}
    </div>

    <div class="all-group-jid">
      ${escapeHTML(group.jid)}
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
          ).join("")
        : `
<div class="empty-box">
  No groups loaded yet.
</div>
`;

    /*
    QR
    */

    const qrHTML =
      qrImage
        ? `
<div class="qr-container">

  <div class="qr-title">
    📱 Scan QR with WhatsApp
  </div>

  <img
    src="${qrImage}"
    class="qr"
    alt="WhatsApp QR"
  >

  <div class="qr-refresh">
    🔄 QR automatically refreshes
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

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<meta
  http-equiv="refresh"
  content="10"
>

<title>
WhatsApp Report Bot • Premium
</title>

<style>

* {
  box-sizing: border-box;
}

body {

  margin: 0;

  font-family:
    Arial,
    Helvetica,
    sans-serif;

  color: #fff;

  min-height: 100vh;

  background:
    radial-gradient(
      circle at 10% 0%,
      rgba(0,255,170,.18),
      transparent 30%
    ),
    radial-gradient(
      circle at 90% 10%,
      rgba(120,70,255,.20),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 100%,
      rgba(0,160,255,.10),
      transparent 35%
    ),
    #050711;
}

body:before {

  content: "";

  position: fixed;

  inset: 0;

  pointer-events: none;

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

  background-size:
    30px 30px;
}

.container {

  width: 94%;

  max-width: 1350px;

  margin: auto;

  padding:
    25px 0 50px;
}

.header {

  position: relative;

  overflow: hidden;

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 20px;

  padding: 24px;

  margin-bottom: 20px;

  border-radius: 26px;

  background:
    linear-gradient(
      135deg,
      rgba(37,211,102,.11),
      rgba(110,70,255,.09),
      rgba(0,180,255,.06)
    );

  border:
    1px solid
    rgba(255,255,255,.10);

  box-shadow:
    0 20px 70px
    rgba(0,0,0,.35);
}

.brand {

  display: flex;

  align-items:
    center;

  gap: 15px;
}

.logo {

  width: 60px;

  height: 60px;

  display: flex;

  align-items:
    center;

  justify-content:
    center;

  border-radius: 19px;

  font-size: 29px;

  background:
    linear-gradient(
      135deg,
      #25d366,
      #08aeea,
      #7657ff
    );

  box-shadow:
    0 0 35px
    rgba(37,211,102,.30);
}

.brand h1 {

  margin: 0;

  font-size: 24px;

  letter-spacing:
    -.5px;
}

.brand p {

  margin: 6px 0 0;

  color: #8e9ab2;

  font-size: 12px;
}

.status {

  display: flex;

  align-items:
    center;

  gap: 9px;

  padding:
    11px 17px;

  border-radius: 50px;

  background:
    rgba(255,255,255,.06);

  border:
    1px solid
    rgba(255,255,255,.08);

  font-size: 11px;

  font-weight: 800;
}

.dot {

  width: 9px;

  height: 9px;

  border-radius: 50%;
}

.green .dot {

  background: #25d366;

  box-shadow:
    0 0 18px
    #25d366;
}

.yellow .dot {

  background: #ffd54a;

  box-shadow:
    0 0 14px
    #ffd54a;
}

.blue .dot {

  background: #38a9ff;

  box-shadow:
    0 0 14px
    #38a9ff;
}

.red .dot {

  background: #ff5364;

  box-shadow:
    0 0 14px
    #ff5364;
}

.stats {

  display: grid;

  grid-template-columns:
    repeat(4,1fr);

  gap: 15px;

  margin-bottom: 20px;
}

.stat {

  position: relative;

  overflow: hidden;

  padding: 21px;

  border-radius: 22px;

  background:
    rgba(255,255,255,.045);

  border:
    1px solid
    rgba(255,255,255,.08);

  box-shadow:
    0 15px 45px
    rgba(0,0,0,.18);

  transition:
    transform .2s,
    border .2s;
}

.stat:hover {

  transform:
    translateY(-3px);

  border-color:
    rgba(255,255,255,.16);
}

.stat-icon {

  font-size: 23px;
}

.stat-title {

  margin-top: 12px;

  color: #7f8ba3;

  font-size: 10px;

  font-weight: 700;

  letter-spacing:
    1px;
}

.stat-value {

  margin-top: 6px;

  font-size: 25px;

  font-weight: 900;
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
    rgba(255,255,255,.08);

  box-shadow:
    0 15px 50px
    rgba(0,0,0,.22);

  margin-bottom: 20px;

  backdrop-filter:
    blur(12px);
}

.card-title {

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  margin-bottom: 18px;
}

.card-title h2 {

  margin: 0;

  font-size: 16px;
}

.card-title span {

  color: #6f7c94;

  font-size: 9px;

  font-weight: 800;
}

.device {

  padding: 17px;

  border-radius: 18px;

  background:
    linear-gradient(
      135deg,
      rgba(0,0,0,.25),
      rgba(255,255,255,.025)
    );
}

.device-row {

  display: flex;

  justify-content:
    space-between;

  gap: 15px;

  padding: 11px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.06);
}

.device-row:last-child {
  border-bottom: 0;
}

.device-label {

  color: #7f8ba1;

  font-size: 11px;
}

.device-value {

  font-size: 12px;

  font-weight: 700;

  text-align: right;

  word-break: break-word;
}

.online {

  color: #25d366;

  text-shadow:
    0 0 12px
    rgba(37,211,102,.35);
}

.notice {

  margin-top: 15px;

  padding: 13px;

  border-radius: 15px;

  background:
    linear-gradient(
      135deg,
      rgba(38,166,255,.09),
      rgba(111,78,255,.08)
    );

  border:
    1px solid
    rgba(70,150,255,.16);

  color: #9ecbff;

  font-size: 10px;

  line-height: 1.7;
}

.qr-container {

  text-align: center;

  padding: 5px;
}

.qr-title {

  color: #c3ccda;

  margin-bottom: 15px;

  font-size: 12px;

  font-weight: 700;
}

.qr {

  width: 250px;

  max-width: 100%;

  padding: 10px;

  background: white;

  border-radius: 20px;

  box-shadow:
    0 15px 50px
    rgba(255,255,255,.10);
}

.qr-refresh {

  color: #68758b;

  font-size: 10px;

  margin-top: 12px;
}

.qr-wait {

  text-align: center;

  padding: 35px 10px;
}

.spinner {

  width: 43px;

  height: 43px;

  margin: auto;

  border: 4px solid
    rgba(255,255,255,.08);

  border-top-color:
    #25d366;

  border-right-color:
    #7b61ff;

  border-radius: 50%;

  animation:
    spin 1s linear infinite;
}

@keyframes spin {

  to {
    transform: rotate(360deg);
  }

}

.qr-wait h3 {

  margin:
    15px 0 7px;
}

.qr-wait p {

  color: #758197;

  font-size: 11px;
}

.group-card {

  display: flex;

  align-items:
    center;

  gap: 13px;

  padding: 14px;

  margin-bottom: 10px;

  border-radius: 18px;

  background:
    linear-gradient(
      135deg,
      rgba(37,211,102,.055),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.06);
}

.group-icon {

  width: 45px;

  height: 45px;

  flex-shrink: 0;

  border-radius: 14px;

  display: flex;

  align-items:
    center;

  justify-content:
    center;

  background:
    linear-gradient(
      135deg,
      rgba(37,211,102,.15),
      rgba(92,78,255,.15)
    );

  font-size: 20px;
}

.group-info {

  min-width: 0;

  flex: 1;
}

.group-name {

  font-size: 13px;

  font-weight: 800;

  line-height: 1.4;
}

.group-jid {

  color: #5f6c82;

  font-size: 8px;

  margin-top: 5px;

  word-break: break-all;
}

.group-count {

  color: #25d366;

  font-size: 10px;

  margin-top: 6px;

  font-weight: 700;
}

.active-badge {

  display: flex;

  align-items:
    center;

  gap: 5px;

  color: #25d366;

  font-size: 8px;

  font-weight: 900;
}

.active-badge span {

  width: 6px;

  height: 6px;

  border-radius: 50%;

  background: #25d366;

  box-shadow:
    0 0 10px
    #25d366;
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

  border-radius: 15px;

  background:
    rgba(0,0,0,.15);

  border:
    1px solid
    rgba(255,255,255,.045);
}

.all-group-name {

  font-size: 11px;

  font-weight: 700;
}

.all-group-jid {

  color: #59667c;

  font-size: 8px;

  margin-top: 4px;

  word-break: break-all;
}

.target-tag,
.normal-tag {

  padding:
    5px 8px;

  border-radius: 8px;

  font-size: 7px;

  font-weight: 900;
}

.target-tag {

  color: #25d366;

  background:
    rgba(37,211,102,.10);

  border:
    1px solid
    rgba(37,211,102,.15);
}

.normal-tag {

  color: #78849a;

  background:
    rgba(255,255,255,.04);
}

.progress-wrap {

  margin-top: 10px;
}

.progress-info {

  display: flex;

  justify-content:
    space-between;

  color: #8995a9;

  font-size: 10px;

  margin-bottom: 9px;
}

.progress {

  height: 9px;

  background:
    rgba(255,255,255,.07);

  border-radius: 20px;

  overflow: hidden;
}

.progress-bar {

  height: 100%;

  width: ${progress}%;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #00b8ff,
      #7657ff
    );

  box-shadow:
    0 0 18px
    rgba(37,211,102,.35);
}

.empty-box {

  text-align: center;

  padding: 30px;

  color: #8793a7;
}

.empty-icon {

  font-size: 35px;

  margin-bottom: 10px;
}

.empty-box b {

  display: block;

  color: white;

  font-size: 13px;
}

.empty-box small {

  display: block;

  margin-top: 7px;

  font-size: 10px;
}

.footer {

  text-align: center;

  color: #536075;

  font-size: 9px;

  margin-top: 5px;

  letter-spacing:
    .4px;
}

@media(max-width:900px) {

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

  .container {

    width: 92%;

  }

  .header {

    flex-direction:
      column;

    align-items:
      flex-start;

  }

  .stats {

    grid-template-columns:
      repeat(2,1fr);

  }

  .stat {

    padding: 16px;

  }

  .stat-value {

    font-size: 20px;

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
        Premium 7-Day Group Monitoring System
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
      ${
        connected
          ? "Online"
          : "Offline"
      }
    </div>

  </div>

  <div class="stat">

    <div class="stat-icon">
      🎯
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
      TOTAL MESSAGES
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
      LIVE DEVICE
    </span>

  </div>

  <div class="device">

    <div class="device-row">

      <span class="device-label">
        Status
      </span>

      <span class="device-value online">
        ${
          connected
            ? "● Connected"
            : "● " +
              statusText
        }
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

    🔒 Linked WhatsApp device ka
    public IP/country Baileys se
    reliably available nahi hota.

  </div>

</div>

<div class="card">

  <div class="card-title">

    <h2>
      🎯 Target Groups
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
        ${daysLeft} days left
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
  • Premium Dashboard
  • Auto Group Detection
  • !rana
  • !stats
  • 7-Day Reports

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

      messages:
        Object.values(
          messageLog
        ).reduce(
          (
            total,
            group
          ) => {

            return total +
              Object.values(
                group
              ).reduce(
                (
                  sum,
                  arr
                ) =>
                  sum +
                  (
                    Array.isArray(
                      arr
                    )
                      ? arr.length
                      : 0
                  ),
                0
              );

          },
          0
        ),

      device:
        deviceInfo,

      lidMappings:
        Object.keys(
          lidMap
        ).length,

      lastError:
        lastError || null

    });

  }
);

/*
========================================
START BOT
========================================
*/

async function startBot() {

  if (reconnecting) {
    return;
  }

  reconnecting =
    true;

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
    CONNECTION
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
              sock.user || {};

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
        messages,
        type
      }) => {

        try {

          if (
            !messages ||
            !messages.length
          ) {
            return;
          }

          /*
          Only live messages.
          */

          if (
            type !==
            "notify"
          ) {
            return;
          }

          for (
            const msg
            of messages
          ) {

            if (
              !msg ||
              !msg.message
            ) {
              continue;
            }

            const chat =
              msg.key.remoteJid;

            if (!chat) {
              continue;
            }

            if (
              !chat.endsWith(
                "@g.us"
              )
            ) {
              continue;
            }

            /*
            ========================================
            SENDER IDs
            ========================================
            */

            const senderLid =
              msg.key.participant ||
              null;

            const senderPhone =
              msg.key.participantAlt ||
              msg.key.senderPn ||
              null;

            /*
            Save LID ↔ PHONE
            */

            let identityChanged =
              false;

            if (
              rememberIdentity(
                senderLid,
                senderPhone
              )
            ) {

              identityChanged =
                true;

            }

            if (identityChanged) {

              saveJSON(
                LID_MAP_FILE,
                lidMap
              );

            }

            /*
            ========================================
            OWNER CHECK
            ========================================
            */

            const ownerNormalized =
              ownerJid
                ? normalizeJid(
                    ownerJid
                  )
                : null;

            const phoneNormalized =
              senderPhone
                ? normalizeJid(
                    senderPhone
                  )
                : null;

            const isOwner =
              msg.key.fromMe === true ||
              (
                ownerNormalized &&
                phoneNormalized &&
                ownerNormalized ===
                  phoneNormalized
              );

            /*
            ========================================
            TEXT
            ========================================
            */

            const text =
              msg.message
                .conversation ||
              msg.message
                .extendedTextMessage
                ?.text ||
              msg.message
                .imageMessage
                ?.caption ||
              msg.message
                .videoMessage
                ?.caption ||
              "";

            const command =
              String(text)
                .trim()
                .toLowerCase();

            /*
            ========================================
            !RANA
            ========================================
            */

            if (
              command ===
              "!rana"
            ) {

              console.log(
                "📊 !rana received"
              );

              if (!isOwner) {

                console.log(
                  "⛔ Unauthorized !rana:",
                  senderLid ||
                  senderPhone ||
                  "unknown"
                );

                continue;
              }

              if (
                !isTargetGroup(
                  chat
                )
              ) {

                console.log(
                  "⚠️ !rana used in non-target group"
                );

                continue;
              }

              console.log(
                "✅ Authorized !rana"
              );

              await sendReport(
                chat
              );

              continue;
            }

            /*
            ========================================
            !STATS
            ========================================
            */

            if (
              command ===
              "!stats"
            ) {

              if (!isOwner) {

                console.log(
                  "⛔ Unauthorized !stats:",
                  senderLid ||
                  senderPhone ||
                  "unknown"
                );

                continue;
              }

              if (
                !isTargetGroup(
                  chat
                )
              ) {

                continue;
              }

              console.log(
                "✅ Authorized !stats"
              );

              await sendReport(
                chat
              );

              continue;
            }

            /*
            ========================================
            !GROUPS
            ========================================
            */

            if (
              command ===
              "!groups"
            ) {

              if (!isOwner) {

                console.log(
                  "⛔ Unauthorized !groups"
                );

                continue;
              }

              await sendGroupsList(
                chat
              );

              continue;
            }

            /*
            ========================================
            IGNORE BOT OWN NORMAL MESSAGE
            ========================================
            */

            if (
              msg.key.fromMe
            ) {
              continue;
            }

            /*
            ========================================
            TARGET GROUP
            ========================================
            */

            if (
              !isTargetGroup(
                chat
              )
            ) {
              continue;
            }

            /*
            ========================================
            SENDER
            ========================================
            */

            const sender =
              isPhoneJid(
                senderPhone
              )
                ? normalizeJid(
                    senderPhone
                  )
                : normalizeJid(
                    senderLid
                  );

            if (!sender) {
              continue;
            }

            /*
            ========================================
            SAVE MESSAGE
            ========================================
            */

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

            console.log(
              `💬 ${savedGroups.find(
                g =>
                  g.jid === chat
              )?.name || chat}`
            );

            console.log(
              `   📱 ${formatNumber(
                sender
              )}`
            );

            console.log(
              `   💬 ${messageLog[chat][sender].length} messages`
            );

          }

        } catch (error) {

          console.log(
            "❌ Message error:",
            error.message
          );

        }

      }
    );

  } catch (error) {

    console.log(
      "❌ START ERROR:",
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
QR AUTO REFRESH
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
        "♻️ QR EXPIRED — REFRESHING"
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
GROUP RESCAN
========================================
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
7 DAY AUTO REPORT
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
        Date.now() >=
        end
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
        "❌ AUTO REPORT ERROR:",
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
      "💎 PREMIUM DASHBOARD: ON"
    );

    console.log(
      "👥 AUTO GROUP DETECTION: ON"
    );

    console.log(
      "🔗 LID ↔ PHONE MAPPING: ON"
    );

    console.log(
      "📊 LIVE MESSAGE COUNTING: ON"
    );

    console.log(
      "⚡ !RANA REPORT: ON"
    );

    console.log(
      "📈 !STATS REPORT: ON"
    );

    console.log(
      "⏰ 7-DAY AUTO REPORT: ON"
    );

    console.log(
      "🔄 GROUP RESCAN: 30 SEC"
    );

    console.log(
      "🌐 PORT:",
      PORT
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
