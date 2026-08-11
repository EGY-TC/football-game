/* =========================================================
   مزاد النجوم — سيرفر Relay (WebSocket)
   كل الرسائل بتعدي عبر السيرفر ده: مفيش WebRTC ولا NAT ولا STUN/TURN.
   يشتغل على Render / Railway / Fly / أي VPS. Node 18+
   ========================================================= */
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8787;
const ROOM_TTL_MS = 60 * 60 * 1000; // ساعة بدون نشاط = تُحذف
const LOBBY_TTL_MS = 25 * 1000; // غرفة بدون نبضة = تختفي من القائمة

/** @type {Map<string, {code:string, host:any, guest:any, info:any, ts:number, lastState:any}>} */
const rooms = new Map();

const now = () => Date.now();
const send = (ws, obj) => {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  } catch (_) {}
};

function publicRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.info || !r.host || r.host.readyState !== 1) continue;
    if (now() - (r.info.ts || 0) > LOBBY_TTL_MS) continue;
    if (r.guest && r.guest.readyState === 1) continue; // ممتلئة
    out.push({
      code: r.code,
      name: r.info.name || "لاعب",
      gameType: r.info.gameType || "",
      locked: !!r.info.locked,
      ts: r.info.ts,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/rooms") {
    const body = JSON.stringify({ rooms: publicRooms() });
    res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(body);
  }
  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, up: process.uptime() }));
  }
  res.writeHead(404, CORS);
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const code = (url.searchParams.get("room") || "").toUpperCase().trim();
  const role = url.searchParams.get("role") === "host" ? "host" : "guest";
  if (!code) {
    send(ws, { t: "err", reason: "no-code" });
    return ws.close();
  }

  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  let room = rooms.get(code);

  if (role === "host") {
    if (room && room.host && room.host.readyState === 1 && room.host !== ws) {
      // نفس الرمز مستخدم بمضيف حي
      send(ws, { t: "code-taken" });
      return ws.close();
    }
    if (!room) room = { code, host: null, guest: null, info: null, ts: now(), lastState: null };
    room.host = ws;
    room.ts = now();
    rooms.set(code, room);
    ws.room = room;
    ws.role = "host";
    send(ws, { t: "ready" }); // الغرفة جاهزة
    if (room.guest && room.guest.readyState === 1) {
      send(ws, { t: "open" });
      send(room.guest, { t: "open" });
    }
  } else {
    if (!room || !room.host || room.host.readyState !== 1) {
      send(ws, { t: "no-room" });
      return ws.close();
    }
    if (room.guest && room.guest.readyState === 1 && room.guest !== ws) {
      try {
        room.guest.close();
      } catch (_) {}
    }
    room.guest = ws;
    room.ts = now();
    ws.room = room;
    ws.role = "guest";
    send(ws, { t: "open" });
    send(room.host, { t: "open" });
  }

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    const r = ws.room;
    if (!r) return;
    r.ts = now();

    if (m.t === "announce") {
      // المضيف بيعلن غرفته في القائمة العامة (بديل jsonblob)
      if (ws.role === "host") r.info = { ...(m.info || {}), ts: now() };
      return;
    }
    if (m.t === "unannounce") {
      if (ws.role === "host") r.info = null;
      return;
    }
    if (m.t === "ping") return send(ws, { t: "pong" });

    if (m.t === "msg") {
      const other = ws.role === "host" ? r.guest : r.host;
      send(other, { t: "msg", d: m.d });
    }
  });

  const bye = () => {
    const r = ws.room;
    if (!r) return;
    if (ws.role === "host" && r.host === ws) {
      r.host = null;
      send(r.guest, { t: "peer-left" });
      // نحتفظ بالغرفة فترة عشان المضيف يقدر يرجع بنفس الرمز
      setTimeout(() => {
        const cur = rooms.get(r.code);
        if (cur && !cur.host) rooms.delete(r.code);
      }, 60 * 1000);
    } else if (ws.role === "guest" && r.guest === ws) {
      r.guest = null;
      send(r.host, { t: "peer-left" });
    }
  };
  ws.on("close", bye);
  ws.on("error", bye);
});

// نبضات للحفاظ على الاتصال حي عبر أي بروكسي/CDN
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (_) {}
  });
  for (const [code, r] of rooms) {
    if (now() - r.ts > ROOM_TTL_MS) rooms.delete(code);
  }
}, 25000);

server.listen(PORT, () => console.log("Relay running on :" + PORT));
