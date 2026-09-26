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
const { createClient } = require("@supabase/supabase-js");

/*
==================================================
WHATSAPP REPORT BOT
PREMIUM 5-DAY ACTIVITY MONITOR
==================================================
*/

/*
==================================================
CONFIG
==================================================
*/

const PORT = process.env.PORT || 3000;

/*
IMPORTANT:
5 DAYS ONLY
*/

const REPORT_DAYS = 5;

/*
Removal ke darmiyan chhota delay.
*/

const REMOVE_DELAY_MS = 2500;

/*
TARGET GROUPS
*/

const TARGET_GROUP_NAMES = [
  "مین کور کمیٹی ہوپ لائٹ ویلفیئر آرگنائزیشن",
  "test"
];

/*
==================================================
SUPABASE
==================================================
*/

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase =
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      )
    : null;

/*
==================================================
DIRECTORIES
==================================================
*/

const BASE = __dirname;

const AUTH_DIR =
  path.join(BASE, "auth");

const DATA_DIR =
  path.join(BASE, "data");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, {
    recursive: true
  });
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

/*
==================================================
JSON HELPERS
==================================================
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
      "JSON LOAD ERROR:",
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
      "JSON SAVE ERROR:",
      error.message
    );
  }
}

/*
==================================================
FILES
==================================================
*/

const STATE_FILE =
  path.join(
    DATA_DIR,
    "botState.json"
  );

const GROUP_FILE =
  path.join(
    DATA_DIR,
    "groups.json"
  );

const ALL_GROUP_FILE =
  path.join(
    DATA_DIR,
    "allGroups.json"
  );

const LID_MAP_FILE =
  path.join(
    DATA_DIR,
    "lidMap.json"
  );

/*
Old warning file intentionally kept
for compatibility.

WARNING SYSTEM IS NOT USED.
*/

const WARNING_FILE =
  path.join(
    DATA_DIR,
    "warnings.json"
  );

/*
==================================================
LOCAL DATA
==================================================
*/

let botState =
  loadJSON(
    STATE_FILE,
    {
      cycleStart:
        Date.now()
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

let lidMap =
  loadJSON(
    LID_MAP_FILE,
    {}
  );

/*
WARNING DATA IS NOT USED.
*/

let warnings = {};

let messageLog = {};

/*
==================================================
SUPABASE LOAD
==================================================
*/

async function loadCloudData() {
  if (!supabase) {
    console.log(
      "⚠️ Supabase variables not configured."
    );

    return;
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("bot_storage")
        .select(
          "key,value"
        );

    if (error) {
      throw error;
    }

    for (
      const row
      of data || []
    ) {
      if (
        row.key ===
        "messageLog"
      ) {
        messageLog =
          row.value || {};
      }

      if (
        row.key ===
        "botState"
      ) {
        botState =
          row.value ||
          botState;
      }

      if (
        row.key ===
        "savedGroups"
      ) {
        savedGroups =
          row.value || [];
      }

      if (
        row.key ===
        "allGroups"
      ) {
        allGroups =
          row.value || [];
      }

      if (
        row.key ===
        "lidMap"
      ) {
        lidMap =
          row.value || {};
      }
    }

    /*
    Warning system OFF.
    Old warning data ignored.
    */

    warnings = {};

    console.log(
      "☁️ Supabase data loaded"
    );

    console.log(
      "⚠️ Warning system: OFF"
    );

  } catch (error) {

    console.log(
      "❌ Supabase load error:",
      error.message
    );

  }
}

/*
==================================================
SUPABASE SAVE
==================================================
*/

async function saveCloud(
  key,
  value
) {
  if (!supabase) {
    return;
  }

  try {

    const {
      error
    } =
      await supabase
        .from("bot_storage")
        .upsert(
          {
            key,
            value,
            updated_at:
              new Date().toISOString()
          },
          {
            onConflict:
              "key"
          }
        );

    if (error) {
      throw error;
    }

  } catch (error) {

    console.log(
      `❌ Cloud save error (${key}):`,
      error.message
    );

  }
}

async function saveData() {

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

  warnings = {};

  saveJSON(
    WARNING_FILE,
    {}
  );

  await saveCloud(
    "messageLog",
    messageLog
  );

  await saveCloud(
    "botState",
    botState
  );

  await saveCloud(
    "savedGroups",
    savedGroups
  );

  await saveCloud(
    "allGroups",
    allGroups
  );

  await saveCloud(
    "lidMap",
    lidMap
  );

  await saveCloud(
    "warnings",
    {}
  );
}

/*
==================================================
JID HELPERS
==================================================
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
    .endsWith(
      "@s.whatsapp.net"
    );
}

function phoneNumberFromJid(jid) {

  const n =
    normalizeJid(jid);

  if (
    n.endsWith(
      "@s.whatsapp.net"
    )
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

  if (
    n.endsWith(
      "@s.whatsapp.net"
    )
  ) {
    return n.replace(
      "@s.whatsapp.net",
      ""
    );
  }

  if (
    n.endsWith("@c.us")
  ) {
    return n.replace(
      "@c.us",
      ""
    );
  }

  if (
    n.endsWith("@lid")
  ) {
    return n.replace(
      "@lid",
      ""
    );
  }

  return n.split("@")[0];
}

/*
==================================================
LID ↔ PHONE
==================================================
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
    return phoneNumberFromJid(
      n
    );
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

  for (
    const id
    of candidates
  ) {

    if (
      isPhoneJid(id)
    ) {

      return `+${formatNumber(id)}`;

    }
  }

  for (
    const id
    of candidates
  ) {

    const phone =
      getPhoneFromAnyId(
        id
      );

    if (phone) {
      return `+${phone}`;
    }
  }

  return formatNumber(
    participant?.id ||
    participant?.lid ||
    ""
  );
}

function getPrivateJid(
  participant
) {

  const candidates = [
    participant?.phoneNumber,
    participant?.id,
    participant?.lid
  ];

  for (
    const id
    of candidates
  ) {

    const n =
      normalizeJid(id);

    if (
      isPhoneJid(n)
    ) {

      return n;

    }
  }

  for (
    const id
    of candidates
  ) {

    const phone =
      getPhoneFromAnyId(
        id
      );

    if (phone) {

      return `${phone}@s.whatsapp.net`;

    }
  }

  return null;
}

/*
==================================================
GROUP MATCHING
==================================================
*/

function normalizeGroupName(
  name
) {

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

  if (
    !actual ||
    !target
  ) {
    return false;
  }

  if (
    actual === target
  ) {
    return true;
  }

  if (
    actual.includes(target) ||
    target.includes(actual)
  ) {
    return true;
  }

  const a =
    actual.replace(
      /\s+/g,
      ""
    );

  const t =
    target.replace(
      /\s+/g,
      ""
    );

  return (
    a === t ||
    a.includes(t) ||
    t.includes(a)
  );
}

/*
==================================================
HTML ESCAPE
==================================================
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
==================================================
BOT STATE
==================================================
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

const QR_EXPIRE =
  50000;

/*
==================================================
EXPRESS
==================================================
*/

const app =
  express();

app.use(
  express.json()
);

/*
==================================================
TARGET GROUP
==================================================
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
==================================================
GROUP MESSAGE COUNT
==================================================
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
==================================================
MEMBER MESSAGE COUNT
==================================================
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

  for (
    const [lid, phone]
    of Object.entries(
      lidMap
    )
  ) {

    for (
      const id
      of ids
    ) {

      const n =
        normalizeJid(id);

      if (
        isPhoneJid(n) &&
        normalizeJid(phone) ===
          n
      ) {

        candidates.add(
          normalizeJid(lid)
        );

      }
    }
  }

  let result = [];

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

  return [
    ...new Set(result)
  ];
}

/*
==================================================
DELAY HELPER
==================================================
*/

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}

/*
==================================================
REMOVE MEMBER
==================================================

NO WARNING
NO PRIVATE MESSAGE
==================================================
*/

async function removeMember(
  groupJid,
  groupName,
  participant
) {

  try {

    const memberJid =
      normalizeJid(
        participant?.id ||
        ""
      );

    const phoneJid =
      getPrivateJid(
        participant
      );

    const target =
      memberJid ||
      phoneJid;

    if (!target) {

      console.log(
        "❌ REMOVE SKIPPED - NO JID"
      );

      return false;
    }

    /*
    Never remove owner.
    */

    if (
      ownerJid &&
      normalizeJid(
        target
      ) ===
        normalizeJid(
          ownerJid
        )
    ) {

      console.log(
        "🛡️ OWNER SKIPPED:",
        target
      );

      return false;
    }

    /*
    Never remove admins.
    */

    if (
      participant?.admin ===
        "admin" ||
      participant?.admin ===
        "superadmin"
    ) {

      console.log(
        "🛡️ ADMIN SKIPPED:",
        target
      );

      return false;
    }

    await sock.groupParticipantsUpdate(
      groupJid,
      [target],
      "remove"
    );

    console.log(
      "🚫 MEMBER REMOVED:",
      getMemberNumber(
        participant
      ),
      "FROM:",
      groupName
    );

    /*
    NO PRIVATE MESSAGE.
    */

    return true;

  } catch (error) {

    console.log(
      "❌ REMOVE ERROR:",
      error.message
    );

    return false;

  }
}

/*
==================================================
REPORT
==================================================

shouldRemove = false
    !rana / !stats
    REPORT ONLY

shouldRemove = true
    Automatic 5-day cycle
    REPORT + ZERO MESSAGE REMOVAL
==================================================
*/

async function sendReport(
  groupJid,
  shouldRemove = false
) {

  try {

    const meta =
      await sock.groupMetadata(
        groupJid
      );

    const groupData =
      messageLog[groupJid] ||
      {};

    const active = [];

    const inactive = [];

    let totalMessages = 0;

    /*
    ----------------------------------------------
    MEMBER COUNTS
    ----------------------------------------------
    */

    for (
      const participant
      of meta.participants ||
      []
    ) {

      if (
        participant.id &&
        participant.phoneNumber
      ) {

        rememberIdentity(
          participant.id,
          participant.phoneNumber
        );

      }

      if (
        participant.lid &&
        participant.phoneNumber
      ) {

        rememberIdentity(
          participant.lid,
          participant.phoneNumber
        );

      }

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
          count: 0,
          participant
        });

      }
    }

    active.sort(
      (a, b) =>
        b.count -
        a.count
    );

    /*
    ----------------------------------------------
    REPORT TEXT
    ----------------------------------------------
    */

    let text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n";

    text +=
      "   📊 *5 DIN KI REPORT*\n";

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
      `🗓 *PERIOD:* ${REPORT_DAYS} DAYS\n`;

    text +=
      `💬 *TOTAL MESSAGES:* ${totalMessages}\n\n`;

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🟢 *ACTIVE MEMBERS*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (
      !active.length
    ) {

      text +=
        "😅 Kisi ne message nahi kiya.\n\n";

    } else {

      let i = 1;

      for (
        const user
        of active
      ) {

        text +=
          `${i}. 📱 *${user.number}*\n`;

        text +=
          `   💬 *${user.count} messages*\n\n`;

        i++;

      }
    }

    text +=
      "┏━━━━━━━━━━━━━━━━━━━━┓\n";

    text +=
      "┃ 🔴 *0 MESSAGES*\n";

    text +=
      "┗━━━━━━━━━━━━━━━━━━━━┛\n\n";

    if (
      !inactive.length
    ) {

      text +=
        "🎉 Sab members active hain!\n";

    } else {

      let i = 1;

      for (
        const user
        of inactive
      ) {

        text +=
          `${i}. 📱 ${user.number} — *0 messages* 🚫\n`;

        i++;

      }
    }

    text +=
      "\n━━━━━━━━━━━━━━━━━━━━\n";

    text +=
      `📈 *ACTIVE:* ${active.length}\n`;

    text +=
      `📉 *0 MESSAGE:* ${inactive.length}\n`;

    text +=
      `💬 *TOTAL:* ${totalMessages}\n`;

    text +=
      "━━━━━━━━━━━━━━━━━━━━";

    /*
    ----------------------------------------------
    REPORT ALWAYS SENT
    ----------------------------------------------
    */

    await sock.sendMessage(
      groupJid,
      {
        text
      }
    );

    console.log(
      "📊 5-DAY REPORT SENT:",
      meta.subject
    );

    /*
    ==============================================
    IMPORTANT:
    REPORT-ONLY COMMANDS MUST NEVER REMOVE.
    
    Only automatic cycle passes:
        shouldRemove = true
    ==============================================
    */

    if (!shouldRemove) {

      console.log(
        "📊 REPORT ONLY — NO MEMBERS REMOVED:",
        meta.subject
      );

      await saveCloud(
        "lidMap",
        lidMap
      );

      return;
    }

    /*
    ==============================================
    AUTOMATIC ZERO-MESSAGE REMOVAL
    ==============================================
    */

    console.log(
      "🚫 AUTOMATIC REMOVAL ENABLED:",
      meta.subject
    );

    for (
      const user
      of inactive
    ) {

      const participant =
        user.participant;

      /*
      Owner skip
      */

      const privateJid =
        getPrivateJid(
          participant
        );

      if (
        ownerJid &&
        privateJid &&
        normalizeJid(
          privateJid
        ) ===
          normalizeJid(
            ownerJid
          )
      ) {

        console.log(
          "🛡️ OWNER NOT REMOVED:",
          user.number
        );

        continue;
      }

      /*
      Admin skip
      */

      if (
        participant?.admin ===
          "admin" ||
        participant?.admin ===
          "superadmin"
      ) {

        console.log(
          "🛡️ ADMIN NOT REMOVED:",
          user.number
        );

        continue;
      }

      /*
      Delay between removal attempts.
      */

      await sleep(
        REMOVE_DELAY_MS
      );

      /*
      Double-check current group
      before attempting removal.
      */

      try {

        const latestMeta =
          await sock.groupMetadata(
            groupJid
          );

        const stillMember =
          (
            latestMeta.participants ||
            []
          ).find(
            p => {

              const a =
                normalizeJid(
                  p.id
                );

              const b =
                normalizeJid(
                  participant.id
                );

              const ap =
                getPrivateJid(p);

              const bp =
                getPrivateJid(
                  participant
                );

              return (
                a === b ||
                (
                  ap &&
                  bp &&
                  normalizeJid(ap) ===
                    normalizeJid(bp)
                )
              );

            }
          );

        if (!stillMember) {

          console.log(
            "ℹ️ ALREADY LEFT:",
            user.number
          );

          continue;
        }

        await removeMember(
          groupJid,
          meta.subject,
          stillMember
        );

      } catch (checkError) {

        console.log(
          "⚠️ MEMBER CHECK ERROR:",
          checkError.message
        );

      }
    }

    await saveCloud(
      "lidMap",
      lidMap
    );

    console.log(
      "✅ 5-DAY REPORT + ZERO-MESSAGE REMOVAL COMPLETE:",
      meta.subject
    );

  } catch (error) {

    console.log(
      "❌ REPORT ERROR:",
      error.message
    );

  }
}

/*
==================================================
GROUP SCAN
==================================================
*/

async function findTargetGroups() {

  if (!sock) {
    return;
  }

  try {

    console.log(
      "🔍 Scanning groups..."
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
          jid: match.jid,
          name: match.name,
          target:
            targetName
        });

      }
    }

    savedGroups =
      detected.slice(0, 2);

    saveJSON(
      GROUP_FILE,
      savedGroups
    );

    saveJSON(
      ALL_GROUP_FILE,
      allGroups
    );

    await saveCloud(
      "savedGroups",
      savedGroups
    );

    await saveCloud(
      "allGroups",
      allGroups
    );

    console.log(
      "🎯 TARGET GROUPS:",
      savedGroups.length
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
==================================================
GROUP LIST
==================================================
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

  if (
    !allGroups.length
  ) {

    text +=
      "❌ Groups abhi detect nahi hue.";

  } else {

    allGroups.forEach(
      (
        group,
        index
      ) => {

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
==================================================
DURATION
==================================================
*/

function formatDuration(
  ms
) {

  const totalSeconds =
    Math.floor(
      ms / 1000
    );

  const days =
    Math.floor(
      totalSeconds /
        86400
    );

  const hours =
    Math.floor(
      (totalSeconds %
        86400) /
        3600
    );

  const minutes =
    Math.floor(
      (totalSeconds %
        3600) /
        60
    );

  return `${days}d ${hours}h ${minutes}m`;
}

/*
==================================================
DASHBOARD
==================================================
*/

app.get(
  "/",
  async (
    req,
    res
  ) => {

    let qrImage = "";

    if (latestQR) {

      try {

        qrImage =
          await QRCode.toDataURL(
            latestQR
          );

      } catch {}

    }

    const connected =
      !!ownerJid;

    const elapsed =
      Math.max(
        0,
        Date.now() -
          Number(
            botState.cycleStart ||
            Date.now()
          )
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
          (elapsed /
            totalTime) *
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
      const group
      of Object.values(
        messageLog
      )
    ) {

      for (
        const arr
        of Object.values(
          group || {}
        )
      ) {

        if (
          Array.isArray(arr)
        ) {

          totalMessages +=
            arr.length;

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
    ----------------------------------------------
    TARGET GROUPS HTML
    ----------------------------------------------
    */

    const groupsHTML =
      savedGroups.length
        ? savedGroups
            .map(
              (
                group,
                index
              ) => `
<div class="group-card">

  <div class="group-glow"></div>

  <div class="group-icon">
    ${index === 0 ? "🏢" : "🧪"}
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
      <span>●</span>
      ${getGroupMessageCount(
        group.jid
      )}
      messages
    </div>

  </div>

  <div class="active-badge">
    TARGET
  </div>

</div>
`
            )
            .join("")
        : `
<div class="empty-box">
  <div class="empty-icon">👥</div>
  <b>No target groups detected</b>
  <small>Bot automatically scans groups.</small>
</div>
`;

    /*
    ----------------------------------------------
    ALL GROUPS HTML
    ----------------------------------------------
    */

    const allGroupsHTML =
      allGroups.length
        ? allGroups
            .map(
              group => {

                const target =
                  savedGroups.some(
                    g =>
                      g.jid ===
                      group.jid
                  );

                return `
<div class="all-group">

  <div class="all-left">

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
    target
      ? `<span class="target-tag">TARGET</span>`
      : `<span class="normal-tag">GROUP</span>`
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
    ----------------------------------------------
    QR HTML
    ----------------------------------------------
    */

    const qrHTML =
      qrImage
        ? `
<div class="qr-container">

  <div class="qr-ring">

    <div class="qr-inner">

      <img
        src="${qrImage}"
        class="qr"
        alt="WhatsApp QR"
      >

    </div>

  </div>

  <div class="qr-title">
    SCAN WITH WHATSAPP
  </div>

  <div class="qr-subtitle">
    Open WhatsApp → Linked Devices
  </div>

  <div class="qr-refresh">
    ◉ QR AUTO REFRESH
  </div>

</div>
`
        : `
<div class="qr-wait">

  <div class="scanner-icon">
    ${
      connected
        ? "✓"
        : "◌"
    }
  </div>

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

    /*
    ----------------------------------------------
    DASHBOARD
    ----------------------------------------------
    */

    res.send(`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<meta
  http-equiv="refresh"
  content="10"
/>

<title>
WhatsApp Activity Monitor
</title>

<style>

/* =================================================
   PREMIUM RESET
================================================= */

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;

  font-family:
    Inter,
    Arial,
    sans-serif;

  color: #eef5ff;

  min-height: 100vh;

  background:
    radial-gradient(
      circle at 10% 0%,
      rgba(0,255,170,.18),
      transparent 27%
    ),
    radial-gradient(
      circle at 90% 5%,
      rgba(124,58,237,.20),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 100%,
      rgba(0,150,255,.13),
      transparent 35%
    ),
    #040611;

  overflow-x: hidden;
}

body::before {
  content: "";

  position: fixed;

  inset: 0;

  pointer-events: none;

  opacity: .18;

  background-image:
    linear-gradient(
      rgba(255,255,255,.025) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      rgba(255,255,255,.025) 1px,
      transparent 1px
    );

  background-size:
    45px 45px;

  mask-image:
    linear-gradient(
      to bottom,
      black,
      transparent
    );
}

.container {
  width: 94%;

  max-width:
    1450px;

  margin:
    0 auto;

  padding:
    28px 0 55px;
}

.header {
  position: relative;

  padding: 24px;

  margin-bottom: 20px;

  border-radius: 28px;

  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 20px;

  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.075),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.11);

  box-shadow:
    0 30px 90px
    rgba(0,0,0,.42),
    inset 0 1px 0
    rgba(255,255,255,.07);

  backdrop-filter:
    blur(22px);

  overflow: hidden;
}

.header::after {
  content: "";

  position: absolute;

  width: 300px;
  height: 300px;

  right: -180px;
  top: -180px;

  border-radius: 50%;

  background:
    rgba(0,255,180,.12);

  filter:
    blur(50px);

  pointer-events: none;
}

.brand {
  display: flex;

  align-items: center;

  gap: 16px;

  position: relative;

  z-index: 2;
}

.logo {
  width: 68px;
  height: 68px;

  border-radius: 21px;

  display: flex;

  align-items: center;

  justify-content: center;

  font-size: 32px;

  background:
    linear-gradient(
      135deg,
      #00f5a0,
      #00b7ff,
      #7c3aed,
      #ec4899
    );

  box-shadow:
    0 0 45px
    rgba(0,245,160,.23);

  position: relative;
}

.logo::after {
  content: "";

  position: absolute;

  inset: 1px;

  border-radius: 20px;

  border:
    1px solid
    rgba(255,255,255,.25);
}

h1 {
  margin: 0;

  font-size: 25px;

  letter-spacing:
    -.5px;
}

.brand p {
  margin:
    7px 0 0;

  color:
    #8290a8;

  font-size:
    10px;

  letter-spacing:
    1.5px;

  font-weight:
    800;

  text-transform:
    uppercase;
}

.status {
  padding:
    11px 17px;

  border-radius:
    999px;

  background:
    rgba(255,255,255,.055);

  border:
    1px solid
    rgba(255,255,255,.10);

  font-size:
    10px;

  font-weight:
    900;

  letter-spacing:
    1px;

  position:
    relative;

  z-index:
    2;
}

.green {
  color:
    #00f5a0;

  box-shadow:
    0 0 25px
    rgba(0,245,160,.08);
}

.blue {
  color:
    #38bdf8;
}

.red {
  color:
    #ff5577;
}

.yellow {
  color:
    #ffd34e;
}

.stats {
  display:
    grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap:
    15px;

  margin-bottom:
    20px;
}

.stat {
  position:
    relative;

  padding:
    21px;

  min-height:
    135px;

  border-radius:
    22px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.065),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.09);

  box-shadow:
    0 18px 55px
    rgba(0,0,0,.25);

  overflow:
    hidden;

  backdrop-filter:
    blur(16px);
}

.stat::after {
  content: "";

  position:
    absolute;

  width:
    110px;

  height:
    110px;

  right:
    -60px;

  bottom:
    -60px;

  border-radius:
    50%;

  background:
    rgba(0,255,180,.08);

  filter:
    blur(25px);
}

.stat-icon {
  font-size:
    25px;
}

.stat-title {
  margin-top:
    10px;

  color:
    #69768d;

  font-size:
    8px;

  font-weight:
    900;

  letter-spacing:
    1.5px;
}

.stat-value {
  margin-top:
    5px;

  font-size:
    25px;

  font-weight:
    900;

  letter-spacing:
    -.7px;
}

.grid {
  display:
    grid;

  grid-template-columns:
    1.15fr .85fr;

  gap:
    20px;
}

.card {
  position:
    relative;

  padding:
    22px;

  margin-bottom:
    20px;

  border-radius:
    25px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.065),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.09);

  box-shadow:
    0 25px 70px
    rgba(0,0,0,.27),
    inset 0 1px 0
    rgba(255,255,255,.04);

  backdrop-filter:
    blur(20px);

  overflow:
    hidden;
}

.card::before {
  content: "";

  position:
    absolute;

  top:
    0;

  left:
    0;

  width:
    90px;

  height:
    1px;

  background:
    linear-gradient(
      90deg,
      #00f5a0,
      transparent
    );

  opacity:
    .7;
}

.card-title {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  margin-bottom:
    18px;
}

.card-title h2 {
  margin:
    0;

  font-size:
    15px;

  letter-spacing:
    -.2px;
}

.card-title span {
  color:
    #65738a;

  font-size:
    8px;

  font-weight:
    900;

  letter-spacing:
    1px;
}

.device {
  padding:
    17px;

  border-radius:
    18px;

  background:
    rgba(0,0,0,.20);

  border:
    1px solid
    rgba(255,255,255,.055);
}

.device-row {
  display:
    flex;

  justify-content:
    space-between;

  gap:
    15px;

  padding:
    12px 0;

  border-bottom:
    1px solid
    rgba(255,255,255,.055);
}

.device-row:last-child {
  border-bottom:
    0;
}

.device-label {
  color:
    #738198;

  font-size:
    10px;
}

.device-value {
  font-size:
    11px;

  font-weight:
    800;

  text-align:
    right;

  word-break:
    break-word;
}

.online {
  color:
    #00f5a0;
}

.notice {
  margin-top:
    15px;

  padding:
    14px;

  border-radius:
    16px;

  color:
    #93a5bd;

  font-size:
    9px;

  line-height:
    1.8;

  background:
    rgba(0,150,255,.055);

  border:
    1px solid
    rgba(0,150,255,.12);
}

.notice b {
  color:
    #dce8f7;
}

.qr-container {
  text-align:
    center;

  padding:
    5px 0 10px;
}

.qr-ring {
  width:
    285px;

  max-width:
    100%;

  margin:
    0 auto 17px;

  padding:
    10px;

  border-radius:
    27px;

  background:
    linear-gradient(
      135deg,
      #00f5a0,
      #00b7ff,
      #7c3aed,
      #ec4899
    );

  box-shadow:
    0 0 45px
    rgba(0,245,160,.12);
}

.qr-inner {
  padding:
    12px;

  background:
    #ffffff;

  border-radius:
    19px;
}

.qr {
  display:
    block;

  width:
    100%;

  border-radius:
    10px;
}

.qr-title {
  color:
    #dce7f5;

  font-size:
    11px;

  font-weight:
    900;

  letter-spacing:
    1.5px;
}

.qr-subtitle {
  margin-top:
    6px;

  color:
    #68768c;

  font-size:
    9px;
}

.qr-refresh {
  margin-top:
    13px;

  color:
    #00d99a;

  font-size:
    8px;

  font-weight:
    900;

  letter-spacing:
    1px;
}

.qr-wait {
  text-align:
    center;

  padding:
    35px 10px;
}

.scanner-icon {
  width:
    65px;

  height:
    65px;

  margin:
    0 auto 15px;

  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  border-radius:
    20px;

  font-size:
    32px;

  color:
    #00f5a0;

  background:
    rgba(0,245,160,.07);

  border:
    1px solid
    rgba(0,245,160,.15);
}

.qr-wait h3 {
  margin:
    0;

  font-size:
    15px;
}

.qr-wait p {
  color:
    #68768c;

  font-size:
    9px;
}

.group-card {
  position:
    relative;

  display:
    flex;

  align-items:
    center;

  gap:
    13px;

  padding:
    14px;

  margin-bottom:
    10px;

  border-radius:
    18px;

  background:
    rgba(0,0,0,.16);

  border:
    1px solid
    rgba(255,255,255,.065);

  overflow:
    hidden;
}

.group-glow {
  position:
    absolute;

  width:
    80px;

  height:
    80px;

  left:
    -40px;

  top:
    -40px;

  border-radius:
    50%;

  background:
    rgba(0,245,160,.10);

  filter:
    blur(20px);
}

.group-icon {
  width:
    46px;

  height:
    46px;

  flex-shrink:
    0;

  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  border-radius:
    14px;

  background:
    linear-gradient(
      135deg,
      #00f5a0,
      #00aaff,
      #7c3aed
    );

  position:
    relative;
}

.group-info {
  flex:
    1;

  min-width:
    0;
}

.group-name {
  font-size:
    12px;

  font-weight:
    900;

  line-height:
    1.4;
}

.group-jid {
  margin-top:
    5px;

  color:
    #4f5d73;

  font-size:
    7px;

  word-break:
    break-all;
}

.group-count {
  margin-top:
    6px;

  color:
    #00e89d;

  font-size:
    9px;

  font-weight:
    800;
}

.group-count span {
  font-size:
    7px;
}

.active-badge {
  color:
    #00f5a0;

  font-size:
    7px;

  font-weight:
    900;

  letter-spacing:
    1px;

  padding:
    6px 8px;

  border-radius:
    8px;

  background:
    rgba(0,245,160,.07);

  border:
    1px solid
    rgba(0,245,160,.10);
}

.all-group {
  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap:
    10px;

  padding:
    12px;

  margin-bottom:
    8px;

  border-radius:
    15px;

  background:
    rgba(0,0,0,.14);

  border:
    1px solid
    rgba(255,255,255,.045);
}

.all-left {
  min-width:
    0;
}

.all-group-name {
  font-size:
    10px;

  font-weight:
    800;
}

.all-group-jid {
  margin-top:
    4px;

  color:
    #4e5b70;

  font-size:
    7px;

  word-break:
    break-all;
}

.target-tag,
.normal-tag {
  padding:
    5px 8px;

  border-radius:
    8px;

  font-size:
    7px;

  font-weight:
    900;

  flex-shrink:
    0;
}

.target-tag {
  color:
    #00f5a0;

  background:
    rgba(0,245,160,.08);

  border:
    1px solid
    rgba(0,245,160,.10);
}

.normal-tag {
  color:
    #718096;

  background:
    rgba(255,255,255,.035);
}

.progress-wrap {
  margin-top:
    10px;
}

.progress-info {
  display:
    flex;

  justify-content:
    space-between;

  margin-bottom:
    9px;

  color:
    #7d8ba1;

  font-size:
    9px;
}

.progress {
  height:
    9px;

  overflow:
    hidden;

  border-radius:
    20px;

  background:
    rgba(255,255,255,.055);

  border:
    1px solid
    rgba(255,255,255,.04);
}

.progress-bar {
  width:
    ${progress}%;

  height:
    100%;

  border-radius:
    inherit;

  background:
    linear-gradient(
      90deg,
      #00f5a0,
      #00b7ff,
      #7c3aed,
      #ec4899
    );

  box-shadow:
    0 0 18px
    rgba(0,245,160,.20);
}

.empty-box {
  padding:
    30px;

  text-align:
    center;

  color:
    #7b889e;
}

.empty-icon {
  font-size:
    25px;

  margin-bottom:
    8px;
}

.empty-box b {
  display:
    block;

  color:
    #e6eef8;

  font-size:
    12px;
}

.empty-box small {
  display:
    block;

  margin-top:
    7px;

  font-size:
    9px;
}

.footer {
  text-align:
    center;

  color:
    #4d5b70;

  font-size:
    8px;

  letter-spacing:
    .5px;

  padding-top:
    5px;
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
    width:
      92%;

    padding-top:
      16px;
  }

  .header {
    flex-direction:
      column;

    align-items:
      flex-start;

    padding:
      20px;
  }

  .stats {
    grid-template-columns:
      repeat(2,1fr);

    gap:
      10px;
  }

  .stat {
    padding:
      15px;

    min-height:
      115px;
  }

  .stat-value {
    font-size:
      18px;
  }

  .card {
    padding:
      17px;
  }

  .logo {
    width:
      56px;

    height:
      56px;

    font-size:
      27px;
  }

  h1 {
    font-size:
      20px;
  }

  .group-card {
    padding:
      11px;
  }

  .active-badge {
    display:
      none;
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
          WhatsApp Activity Monitor
        </h1>

        <p>
          PREMIUM • CLOUD • 5-DAY MONITORING
        </p>

      </div>

    </div>

    <div
      class="status ${statusClass}"
    >
      ● ${statusText}
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
        MESSAGES
      </div>

      <div class="stat-value">
        ${totalMessages}
      </div>

    </div>

    <div class="stat">

      <div class="stat-icon">
        ☁️
      </div>

      <div class="stat-title">
        STORAGE
      </div>

      <div class="stat-value">
        ${
          supabase
            ? "Cloud"
            : "Local"
        }
      </div>

    </div>

  </div>

  <div class="grid">

    <div>

      <div class="card">

        <div class="card-title">

          <h2>
            📱 Linked WhatsApp
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
              ${
                connected
                  ? "● Connected"
                  : statusText
              }
            </span>

          </div>

          <div class="device-row">

            <span class="device-label">
              Number
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
              Cloud Storage
            </span>

            <span class="device-value">
              ${
                supabase
                  ? "🟢 Active"
                  : "🟡 Waiting"
              }
            </span>

          </div>

          <div class="device-row">

            <span class="device-label">
              Uptime
            </span>

            <span class="device-value">
              ${uptime}
            </span>

          </div>

        </div>

        <div class="notice">

          ☁️ Message counting data
          Supabase mein save hoga.

          <br><br>

          📊 <b>!rana / !stats</b>
          = sirf 5-day report.

          <br><br>

          🟢 5 din mein <b>1+ message</b>
          = active.

          <br><br>

          🔴 5 din mein <b>0 messages</b>
          = automatic removal attempt.

          <br><br>

          🔕 Private warning system:
          <b>OFF</b>

        </div>

      </div>

      <div class="card">

        <div class="card-title">

          <h2>
            🎯 Target Groups
          </h2>

          <span>
            ${savedGroups.length}/2
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
            AUTO
          </span>

        </div>

        ${qrHTML}

      </div>

      <div class="card">

        <div class="card-title">

          <h2>
            📋 All Groups
          </h2>

          <span>
            ${allGroups.length}
          </span>

        </div>

        ${allGroupsHTML}

      </div>

      <div class="card">

        <div class="card-title">

          <h2>
            📊 5-Day Activity Cycle
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

    WhatsApp Activity Monitor
    • PREMIUM DASHBOARD
    • 5-DAY REPORT
    • WARNING OFF
    • ZERO-MESSAGE AUTO REMOVAL

  </div>

</div>

</body>

</html>
`);
  }
);

/*
==================================================
HEALTH
==================================================
*/

app.get(
  "/health",
  (
    req,
    res
  ) => {

    res.json({

      status:
        "ok",

      whatsapp:
        ownerJid
          ? "connected"
          : connectionStatus,

      owner:
        ownerJid || null,

      targetGroups:
        savedGroups,

      allGroups:
        allGroups.length,

      cloud:
        !!supabase,

      reportDays:
        REPORT_DAYS,

      warnings:
        "OFF",

      autoRemoval:
        "ON",

      messages:
        Object.values(
          messageLog
        ).reduce(
          (
            total,
            group
          ) =>
            total +
            Object.values(
              group || {}
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
            ),
          0
        ),

      lidMappings:
        Object.keys(
          lidMap
        ).length,

      lastError:
        lastError ||
        null

    });

  }
);

/*
==================================================
START BOT
==================================================
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
    ==============================================
    CONNECTION UPDATE
    ==============================================
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

          /*
          Connected WhatsApp number
          automatically detected.
          */

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
            "☁️ CLOUD:",
            !!supabase
          );

          console.log(
            "📊 REPORT:",
            `${REPORT_DAYS} DAYS`
          );

          console.log(
            "🔕 WARNING:",
            "OFF"
          );

          console.log(
            "🚫 ZERO-MESSAGE REMOVAL:",
            "ON"
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

          setTimeout(
            startBot,
            5000
          );

        }

      }
    );

    /*
    ==============================================
    MESSAGE LISTENER
    ==============================================
    */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type
      }) => {

        try {

          if (
            !messages?.length ||
            type !== "notify"
          ) {
            return;
          }

          let changed =
            false;

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

            if (
              !chat ||
              !chat.endsWith(
                "@g.us"
              )
            ) {
              continue;
            }

            const senderLid =
              msg.key.participant ||
              null;

            const senderPhone =
              msg.key.participantAlt ||
              msg.key.senderPn ||
              null;

            if (
              rememberIdentity(
                senderLid,
                senderPhone
              )
            ) {

              changed =
                true;

            }

            /*
            ==========================================
            MESSAGE TEXT
            ==========================================
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
            ==========================================
            OWNER CHECK
            ==========================================
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
              msg.key.fromMe ===
                true ||
              (
                ownerNormalized &&
                phoneNormalized &&
                ownerNormalized ===
                  phoneNormalized
              );

            /*
            ==========================================
            !RANA
            REPORT ONLY
            ==========================================
            */

            if (
              command ===
              "!rana"
            ) {

              if (
                isOwner &&
                isTargetGroup(
                  chat
                )
              ) {

                await sendReport(
                  chat,
                  false
                );

              }

              continue;
            }

            /*
            ==========================================
            !STATS
            REPORT ONLY
            ==========================================
            */

            if (
              command ===
              "!stats"
            ) {

              if (
                isOwner &&
                isTargetGroup(
                  chat
                )
              ) {

                await sendReport(
                  chat,
                  false
                );

              }

              continue;
            }

            /*
            ==========================================
            !GROUPS
            ==========================================
            */

            if (
              command ===
              "!groups"
            ) {

              if (isOwner) {

                await sendGroupsList(
                  chat
                );

              }

              continue;
            }

            /*
            ==========================================
            IGNORE BOT'S OWN NORMAL MESSAGE
            ==========================================
            */

            if (
              msg.key.fromMe
            ) {
              continue;
            }

            /*
            ==========================================
            TARGET GROUPS ONLY
            ==========================================
            */

            if (
              !isTargetGroup(
                chat
              )
            ) {
              continue;
            }

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
            ==========================================
            SAVE MESSAGE
            ==========================================
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

            messageLog[chat][sender].push(
              timestamp ||
              Date.now()
            );

            changed =
              true;

            console.log(
              `💬 MESSAGE SAVED: ${chat}`
            );

          }

          if (changed) {
            await saveData();
          }

        } catch (error) {

          console.log(
            "❌ MESSAGE ERROR:",
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
==================================================
QR EXPIRY
==================================================
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
        "♻️ QR EXPIRED"
      );

      latestQR =
        null;

      qrGeneratedAt =
        0;

    }

  },
  10000
);

/*
==================================================
GROUP RESCAN
==================================================
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
==================================================
AUTOMATIC 5-DAY REPORT
==================================================

5 din complete hone par:

1. Report group mein send
2. 0-message members identify
3. Warning nahi
4. Private message nahi
5. Sirf 0-message members remove attempt
6. 1+ message walon ko kuch nahi
7. New 5-day cycle
8. Message log reset

IMPORTANT:
!rana aur !stats yahan se alag hain.
Woh sendReport(group, false) use karte hain.
Automatic cycle sendReport(group, true) use karta hai.
==================================================
*/

setInterval(
  async () => {

    try {

      const end =
        Number(
          botState.cycleStart
        ) +
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
            "⏰ 5 DAYS COMPLETE"
          );

          /*
          ----------------------------------------
          REPORT + REMOVAL
          ----------------------------------------
          */

          for (
            const group
            of savedGroups
          ) {

            await sendReport(
              group.jid,
              true
            );

            await sleep(
              3000
            );

          }

          /*
          ----------------------------------------
          NEW CYCLE
          ----------------------------------------
          */

          botState.cycleStart =
            Date.now();

          messageLog =
            {};

          warnings =
            {};

          await saveData();

          console.log(
            "🔄 NEW 5-DAY CYCLE STARTED"
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
==================================================
SERVER
==================================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🤖 WHATSAPP ACTIVITY BOT"
    );

    console.log(
      "✨ PREMIUM DASHBOARD: ON"
    );

    console.log(
      "☁️ SUPABASE STORAGE:",
      !!supabase
    );

    console.log(
      "📊 MESSAGE PERSISTENCE: ON"
    );

    console.log(
      "📊 REPORT:",
      `${REPORT_DAYS} DAYS`
    );

    console.log(
      "🔕 PRIVATE WARNING:",
      "OFF"
    );

    console.log(
      "🚫 ZERO-MESSAGE REMOVAL:",
      "ON"
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
==================================================
BOOT
==================================================
*/

(async () => {

  console.log(
    "🚀 Starting WhatsApp Bot..."
  );

  await loadCloudData();

  startBot();

})();
