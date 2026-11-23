import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=10";
import { STRINGS } from "./i18n.js?v=10";

/* =========================================================
   Idioma
   ========================================================= */
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let lang = ls.get("fm-lang") || ((navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en");
if (!STRINGS[lang]) lang = "en";
const L = () => STRINGS[lang];
function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.es[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}
function setLang(l) {
  lang = l; ls.set("fm-lang", l);
  document.documentElement.lang = l;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("landLead"));
}
setLang(lang);

/* =========================================================
   Constantes y utilidades
   ========================================================= */
const WEEK_TARGET = 15, DAY_MIN = 8, DAY_MAX = 12, WORK_MIN = 25, BREAK_MIN = 5, MIN_BUDDIES = 3;
const EMOJIS = ["✅", "💪", "🔥", "👏", "🍅", "🫂"];
const DKINDS = [["phone", "📱"], ["people", "🗣️"], ["side", "🧩"], ["social", "📲"], ["thoughts", "💭"], ["other", "❓"]];

const $ = s => document.querySelector(s);
const app = $("#app");
const pad = n => String(n).padStart(2, "0");
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dkey(new Date());
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
function weekKey(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = x.getUTCFullYear();
  return `${y}-W${pad(Math.ceil(((x - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7))}`;
}
const periodFor = scope => scope === "day" ? today() : scope === "week" ? weekKey(new Date()) : monthKey(new Date());
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hours = p => (p * WORK_MIN / 60).toFixed(1).replace(".", L().decimal);
const fmtDay = k => {
  const d = parseKey(k), wd = L().days[(d.getDay() + 6) % 7], mo = L().months[d.getMonth()].slice(0, 3);
  return lang === "en" ? `${wd} ${mo} ${d.getDate()}` : `${wd} ${d.getDate()} ${mo}`;
};

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 3500);
}
function failed(error, friendly) {
  if (!error) return false;
  console.error(error);
  if (error.code === "23505") toast(friendly || t("errExists"));
  else toast(friendly || t("errSave"));
  return true;
}

function avatar(p, size = "") {
  const name = p?.display_name || p?.username || "?";
  let h = 0; for (const c of p?.username || name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar ${size}" style="background:hsl(${h} 45% 45%)" aria-hidden="true">${esc(name.trim()[0]?.toUpperCase() || "?")}</span>`;
}
const profileLink = p => `#/u/${encodeURIComponent(p.username)}`;
function armDelete(b, label, onConfirm) {
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = label; setTimeout(() => { delete b.dataset.armed; b.textContent = b.dataset.orig; }, 2500); return; }
  onConfirm();
}

/* =========================================================
   Supabase y estado
   ========================================================= */
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } }) : null;

const S = { session: null, me: null, rt: 0, title: "Focus Mastery", gScope: "day", goals: [], tasks: [], todayRow: null, jDate: today(), pendingIn: 0, pcache: {}, rWeek: dkey(mondayOf(new Date())) };
const myId = () => S.session?.user?.id || null;

async function loadMe() {
  if (!myId()) { S.me = null; return; }
  const { data, error } = await sb.from("profiles").select("*").eq("id", myId()).maybeSingle();
  if (error) console.error(error);
  S.me = data || null;
}
async function profilesByIds(ids) {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return {};
  const { data } = await sb.from("profiles").select("id,username,display_name,bio,start_time").in("id", uniq);
  return Object.fromEntries((data || []).map(p => [p.id, p]));
}
async function ensureProfiles(ids) {
  const miss = [...new Set(ids)].filter(i => i && !S.pcache[i]);
  if (miss.length) Object.assign(S.pcache, await profilesByIds(miss));
}
async function refreshPendingBadge() {
  if (!myId()) return;
  const { count } = await sb.from("buddies").select("id", { count: "exact", head: true }).eq("addressee", myId()).eq("status", "pending");
  S.pendingIn = count || 0;
  const b = $("#navBadge"); if (b) { b.textContent = S.pendingIn; b.hidden = !S.pendingIn; }
}

/* =========================================================
   Router
   ========================================================= */
const NEEDS_LOGIN = ["hoy", "tablero", "diario", "buddies", "sala", "yo", "bienvenida", "contrasena"];
function parseRoute() {
  const [view = "", arg = ""] = location.hash.replace(/^#\/?/, "").split("/");
  return { view, arg: decodeURIComponent(arg) };
}
async function route() {
  const rt = ++S.rt;
  leaveRoom();
  if (!configured) return viewSetup();
  const { view, arg } = parseRoute();
  if (NEEDS_LOGIN.includes(view) && !S.session) { location.hash = "#/"; return; }
  if (S.session && !S.me && view !== "bienvenida" && view !== "contrasena") { location.hash = "#/bienvenida"; return; }
  if (S.me && view === "bienvenida") { location.hash = "#/hoy"; return; }
  renderNav(view);
  S.title = "Focus Mastery"; renderTimer();
  window.scrollTo(0, 0);
  switch (view) {
    case "": return S.session ? (location.hash = "#/hoy") : viewLanding();
    case "bienvenida": return viewOnboarding();
    case "contrasena": return viewPassword();
    case "hoy": return viewHoy(rt);
    case "tablero": return viewBoard(rt);
    case "diario": return viewJournal(rt);
    case "buddies": return viewBuddies(rt);
    case "sala": return viewRoom(rt, arg || "general");
    case "yo": location.hash = profileLink(S.me); return;
    case "u": return viewProfile(rt, arg.toLowerCase());
    default: location.hash = "#/";
  }
}
const alive = rt => rt === S.rt;

function renderNav(view) {
  const nav = $("#nav");
  const langBtn = `<button type="button" id="langBtn" aria-label="${esc(t("langSwitchLabel"))}" title="${esc(t("langSwitchLabel"))}">${t("langSwitch")}</button>`;
  if (!S.session || !S.me) {
    nav.innerHTML = (S.session
      ? `<button type="button" id="logout">${t("navLogout")}</button>`
      : `<a href="#/" ${view === "" ? 'aria-current="page"' : ""}>${t("navLogin")}</a>`) + langBtn;
  } else {
    const ownProfile = view === "u" && parseRoute().arg.toLowerCase() === S.me.username;
    const item = (v, label, lock) => `<a href="#/${v}" ${view === v || (v === "yo" && ownProfile) ? 'aria-current="page"' : ""}>${label}${lock ? ` <span class="lock" aria-label="${t("private")}">🔒</span>` : ""}</a>`;
    nav.innerHTML =
      item("hoy", t("navToday"), true) + item("tablero", t("navBoard"), true) + item("diario", t("navJournal"), true) +
      item("yo", t("navProfile")) +
      `<a href="#/buddies" ${view === "buddies" ? 'aria-current="page"' : ""}>${t("navBuddies")} <span class="badge" id="navBadge" ${S.pendingIn ? "" : "hidden"}>${S.pendingIn}</span></a>` +
      `<a href="#/sala" ${view === "sala" ? 'aria-current="page"' : ""}>${t("navRooms")}</a>` +
      `<button type="button" id="logout">${t("navLogout")}</button>` + langBtn;
  }
  $("#logout")?.addEventListener("click", async () => { await sb.auth.signOut(); location.hash = "#/"; });
  $("#langBtn").addEventListener("click", () => { setLang(lang === "es" ? "en" : "es"); route(); });
}

/* =========================================================
   Vista: falta configurar
   ========================================================= */
function viewSetup() {
  $("#nav").innerHTML = "";
  app.innerHTML = `<div class="panel"><h2>${t("setupTitle")}</h2><p>${t("setupBody")}</p></div>`;
}

/* =========================================================
   Vista: portada + login
   ========================================================= */
function viewLanding() {
  app.innerHTML = `
  <section class="landing">
    <div>
      <div class="label">${t("landEyebrow")}</div>
      <h1 style="margin-top:8px">${t("landTitle1")}<br><em>${t("landTitle2")}</em></h1>
      <p class="lead">${t("landLead")}</p>
      <ol class="rules">
        <li><div><b>${t("rule1Title")}</b><span class="muted">${t("rule1Body")}</span></div></li>
        <li><div><b>${t("rule2Title")}</b><span class="muted">${t("rule2Body")}</span></div></li>
        <li><div><b>${t("rule3Title")}</b><span class="muted">${t("rule3Body")}</span></div></li>
      </ol>
    </div>
    <div class="panel">
      <div class="seg" id="authSeg" role="group" aria-label="${t("authAccess")}" style="margin-bottom:16px">
        <button type="button" data-mode="login" aria-pressed="true">${t("authLogin")}</button>
        <button type="button" data-mode="signup" aria-pressed="false">${t("authSignup")}</button>
      </div>
      <form class="form" id="loginForm">
        <div class="field"><label class="label" for="email">${t("email")}</label>
          <input type="email" id="email" required autocomplete="email" placeholder="${t("emailPh")}"></div>
        <div class="field" id="pwField"><label class="label" for="password">${t("password")}</label>
          <input type="password" id="password" required minlength="8" autocomplete="current-password">
          <p class="hint" id="pwHint" hidden>${t("pwMin")}</p></div>
        <button class="btn primary" id="loginBtn">${t("authLogin")}</button>
        <div class="row" style="gap:16px">
          <button type="button" class="btn ghost small" id="forgotBtn">${t("forgot")}</button>
          <button type="button" class="btn ghost small" id="magicBtn">${t("magic")}</button>
        </div>
      </form>
      <div id="loginSent" class="notice ok" hidden style="margin-top:12px"></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
      <form class="add" id="lookForm">
        <input type="text" id="lookUser" placeholder="${t("lookPh")}" aria-label="${t("lookLabel")}">
        <button class="btn">${t("see")}</button>
      </form>
    </div>
  </section>`;
  let mode = "login";
  const redirect = location.origin + location.pathname;
  const sent = msg => { const n = $("#loginSent"); n.hidden = false; n.textContent = msg; };
  const authError = (error, fallback) => {
    console.error(error);
    if (error.status === 429) return toast(t("errTooMany"));
    if (/invalid login credentials/i.test(error.message)) return toast(t("errBadLogin"));
    if (/email not confirmed/i.test(error.message)) return toast(t("errNotConfirmed"));
    if (/already registered/i.test(error.message)) return toast(t("errRegistered"));
    if (/password/i.test(error.message) && error.status === 422) return toast(t("errWeakPw"));
    toast(fallback);
  };
  const emailVal = () => { const v = $("#email").value.trim(); if (!v) $("#email").reportValidity(); return v; };
  $("#authSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    mode = b.dataset.mode;
    $("#authSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("#loginBtn").textContent = mode === "login" ? t("authLogin") : t("authSignup");
    $("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#pwHint").hidden = mode === "login"; $("#forgotBtn").hidden = mode !== "login";
    $("#loginSent").hidden = true;
  });
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = emailVal(), password = $("#password").value; if (!email) return;
    $("#loginBtn").disabled = true;
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      $("#loginBtn").disabled = false;
      if (error) return authError(error, t("errLogin"));
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      $("#loginBtn").disabled = false;
      if (error) return authError(error, t("errSignup"));
      if (!data.session) sent(t("sentConfirm", { email }));
    }
  });
  $("#forgotBtn").addEventListener("click", async () => {
    const email = emailVal(); if (!email) return;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
    if (error) return authError(error, t("errSendEmail"));
    sent(t("sentReset", { email }));
  });
  $("#magicBtn").addEventListener("click", async () => {
    const email = emailVal(); if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) return authError(error, t("errSendLink"));
    sent(t("sentMagic", { email }));
  });
  $("#lookForm").addEventListener("submit", e => {
    e.preventDefault(); const u = $("#lookUser").value.trim().replace(/^@/, "").toLowerCase(); if (u) location.hash = `#/u/${encodeURIComponent(u)}`;
  });
}

/* =========================================================
   Vista: elegir contraseña
   ========================================================= */
function viewPassword() {
  app.innerHTML = `
  <div class="panel">
    <h2>${t("pwTitle")}</h2>
    <form class="form" id="pwForm">
      <div class="field"><label class="label" for="pw1">${t("pwNew")}</label>
        <input type="password" id="pw1" required minlength="8" autocomplete="new-password"></div>
      <div class="field"><label class="label" for="pw2">${t("pwRepeat")}</label>
        <input type="password" id="pw2" required minlength="8" autocomplete="new-password"></div>
      <p class="hint">${t("pwMin")}</p>
      <button class="btn primary" id="pwBtn">${t("pwSave")}</button>
    </form>
  </div>`;
  $("#pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $("#pw1").value, b = $("#pw2").value;
    if (a !== b) { toast(t("pwMismatch")); return; }
    $("#pwBtn").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    $("#pwBtn").disabled = false;
    if (error) { console.error(error); toast(/different from the old/i.test(error.message) ? t("pwSameOld") : t("pwErr")); return; }
    toast(t("pwSaved"));
    location.hash = S.me ? "#/hoy" : "#/bienvenida";
  });
}

/* =========================================================
   Vista: crear perfil
   ========================================================= */
function viewOnboarding() {
  app.innerHTML = `
  <div class="panel">
    <h2>${t("obTitle")}</h2>
    <p class="hint" style="margin-bottom:16px">${t("obIntro")}</p>
    <form class="form" id="obForm">
      <div class="field"><label class="label" for="obUser">${t("obUser")}</label>
        <input type="text" id="obUser" required pattern="[a-z0-9_]{3,20}" placeholder="paula_phd" autocomplete="username">
        <p class="hint">${t("obUserHint")}</p></div>
      <div class="field"><label class="label" for="obName">${t("obName")}</label>
        <input type="text" id="obName" required maxlength="60" placeholder="${t("obNamePh")}"></div>
      <div class="field"><label class="label" for="obStart">${t("obStart")}</label>
        <input type="time" id="obStart" value="09:00"></div>
      <button class="btn primary">${t("obCreate")}</button>
    </form>
  </div>`;
  $("#obUser").addEventListener("input", e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""); });
  $("#obForm").addEventListener("submit", async e => {
    e.preventDefault();
    const row = { id: myId(), username: $("#obUser").value.trim(), display_name: $("#obName").value.trim(), start_time: $("#obStart").value || null };
    const { data, error } = await sb.from("profiles").insert(row).select().single();
    if (failed(error, error?.code === "23505" ? t("obTaken") : undefined)) return;
    S.me = data; toast(t("obDone"));
    location.hash = "#/buddies";
  });
}

/* =========================================================
   Progreso (compartido)
   ========================================================= */
function goalPill(d) {
  if (!d.goals_total) return `<span class="pill none">${t("noGoals")}</span>`;
  if (d.goals_done >= d.goals_total) return `<span class="pill ok">✓ ${d.goals_done}/${d.goals_total}</span>`;
  return `<span class="pill part">${d.goals_done}/${d.goals_total}</span>`;
}
const level = p => (p <= 0 ? 0 : p < 4 ? 1 : p < 8 ? 2 : p < 12 ? 3 : 4);
function streakOf(days, field) {
  const ok = k => field === "pomos" ? (days[k]?.pomos || 0) > 0 : !!days[k]?.checked_in;
  const now = new Date();
  let d = ok(today()) ? now : addDays(now, -1), n = 0;
  while (ok(dkey(d))) { n++; d = addDays(d, -1); }
  return n;
}
function weekTotal(days, ref = new Date()) {
  const mon = mondayOf(ref); let total = 0;
  for (let i = 0; i < 7; i++) total += days[dkey(addDays(mon, i))]?.pomos || 0;
  return total;
}
function progressHTML(days) {
  const now = new Date(), tk = today(), td = days[tk] || {}, mon = mondayOf(now);
  const wk = weekTotal(days), mk = monthKey(now);
  let mo = 0, moDays = 0;
  for (const [k, v] of Object.entries(days)) if (k.startsWith(mk) && v.pomos) { mo += v.pomos; moDays++; }
  let week = "";
  for (let i = 0; i < 7; i++) {
    const dd = addDays(mon, i), k = dkey(dd), v = days[k] || {};
    const cls = ["day", k === tk ? "today" : "", dd > now && k !== tk ? "future" : ""].join(" ");
    week += `<div class="${cls}"><span class="dn">${L().days[i]} ${dd.getDate()}</span><span class="dp num">${v.pomos || 0}</span>
      <span class="dots">${"<b></b>".repeat(Math.min(v.pomos || 0, 16))}</span>${goalPill(v)}
      <span class="st">${v.checked_in ? t("checkDone") : v.first_at ? t("startAt", { t: esc(v.first_at) }) : "—"}</span></div>`;
  }
  let heat = ""; const start = addDays(mon, -19 * 7);
  for (let i = 0; i < 140; i++) {
    const dd = addDays(start, i), k = dkey(dd);
    if (dd > now) heat += `<i class="out"></i>`;
    else { const p = days[k]?.pomos || 0; heat += `<i data-l="${level(p)}" title="${t("heatTitle", { d: dd.getDate(), m: L().months[dd.getMonth()], p })}"></i>`; }
  }
  return `
  <div class="stats">
    <div class="stat"><span class="label">${t("statToday")}</span><span class="big num">${td.pomos || 0}</span><span class="sub">${t("statTodaySub", { h: hours(td.pomos || 0) })}</span></div>
    <div class="stat"><span class="label">${t("statWeek")}</span><span class="big num">${wk}<small> / ${WEEK_TARGET}</small></span>
      <div class="bar ${wk >= WEEK_TARGET ? "ok" : ""}"><i style="width:${Math.min(100, wk / WEEK_TARGET * 100)}%"></i></div>
      <span class="sub">${wk >= WEEK_TARGET ? t("weekDone") : t("weekLeft", { n: WEEK_TARGET - wk })}</span></div>
    <div class="stat"><span class="label">${t("statStreak")}</span><span class="big num">${streakOf(days, "pomos")}</span><span class="sub">${t("statStreakSub")}</span></div>
    <div class="stat"><span class="label">${t("statCheckins")}</span><span class="big num">${streakOf(days, "checked_in")}</span><span class="sub">${t("statCheckinsSub", { mo, d: moDays })}</span></div>
  </div>
  <div class="panel"><h2>${t("thisWeek")}</h2><div class="week">${week}</div></div>
  <div class="panel"><h2>${t("last20")}</h2>
    <div class="heat-wrap"><div class="heat" role="img" aria-label="${t("heatLabel")}">${heat}</div></div>
    <div class="legend">0 <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> ${t("legendMax")}</div>
  </div>`;
}
const ackChip = (q, emoji = "") => `<a class="ack" href="${profileLink(q)}">${avatar(q, "xs")}${esc(q.display_name)}${emoji ? " " + esc(emoji) : ""}</a>`;

/* =========================================================
   Vista: perfil público
   ========================================================= */
async function viewProfile(rt, username) {
  app.innerHTML = `<p class="empty">${t("loadingProfile")}</p>`;
  const { data: p } = await sb.from("profiles").select("*").eq("username", username).maybeSingle();
  if (!alive(rt)) return;
  if (!p) { app.innerHTML = `<div class="panel"><h2>${t("noUser", { u: esc(username) })}</h2><p><a href="#/">${t("backHome")}</a></p></div>`; return; }
  const since = dkey(addDays(mondayOf(new Date()), -19 * 7));
  const [daysR, relR, acksR] = await Promise.all([
    sb.from("days").select("*").eq("user_id", p.id).gte("day", since),
    sb.from("buddies").select("*").or(`requester.eq.${p.id},addressee.eq.${p.id}`),
    sb.from("check_acks").select("*").eq("to_user", p.id).eq("day", today()),
  ]);
  if (!alive(rt)) return;
  const days = Object.fromEntries((daysR.data || []).map(d => [d.day, d]));
  const rels = relR.data || [];
  const accepted = rels.filter(r => r.status === "accepted");
  const buddyIds = accepted.map(r => (r.requester === p.id ? r.addressee : r.requester));
  const acks = acksR.data || [];
  const people = await profilesByIds([...buddyIds, ...acks.map(a => a.from_user)]);
  if (!alive(rt)) return;

  const isMe = myId() === p.id;
  const myRel = myId() && !isMe ? rels.find(r => r.requester === myId() || r.addressee === myId()) : null;
  const nb = buddyIds.length, td = days[today()] || {};
  let action = "";
  if (S.me && !isMe) {
    if (!myRel) action = `<button class="btn primary" id="askBuddy">${t("askBuddy")}</button>`;
    else if (myRel.status === "accepted") action = `<span class="pill ok">${t("areBuddies")}</span>`;
    else if (myRel.requester === myId()) action = `<span class="pill none">${t("requestSent")}</span>`;
    else action = `<a class="btn primary" href="#/buddies">${t("answerRequest")}</a>`;
  } else if (!S.session) action = `<a class="btn" href="#/">${t("createMine")}</a>`;

  app.innerHTML = `
  ${isMe ? `<div class="notice ok row between"><span>${t("ownNotice")}</span>
     <button class="btn small" id="copyLink">${t("copyLink")}</button></div>` : ""}
  <div class="phead">
    ${avatar(p)}
    <div style="min-width:0">
      <h1>${esc(p.display_name)}</h1>
      <div class="handle">@${esc(p.username)}</div>
      ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
      <div class="chips">
        ${nb >= MIN_BUDDIES ? `<span class="pill ok">${t("teamFull", { n: nb })}</span>` : `<span class="pill part">${t("teamLooking", { n: nb, min: MIN_BUDDIES })}</span>`}
        ${p.start_time ? `<span class="pill none">${t("startsAt", { t: esc(p.start_time) })}</span>` : ""}
        ${td.checked_in ? `<span class="pill ok">${t("checkinToday")}</span>` : `<span class="pill none">${t("noCheckinToday")}</span>`}
      </div>
    </div>
  </div>
  ${action ? `<div class="row">${action}</div>` : ""}
  <div class="panel">
    <h2>${t("today")}</h2>
    ${td.note ? `<p class="checkin-note">${esc(td.note)}</p>` : `<p class="empty">${t("noNoteYet")}</p>`}
    <div class="label" style="margin:14px 0 8px">${t("acksToday")}</div>
    ${acks.length ? `<div class="acks">${acks.map(a => people[a.from_user] ? ackChip(people[a.from_user], a.emoji) : "").join("")}</div>`
      : `<p class="empty">${t("noAcksYet")}</p>`}
  </div>
  ${progressHTML(days)}
  <div class="panel"><h2>${t("buddies")}</h2>
    ${nb ? `<div class="acks">${buddyIds.map(id => people[id]).filter(Boolean).map(q => ackChip(q)).join("")}</div>`
      : `<p class="empty">${t("noBuddiesYet")}</p>`}
  </div>`;
  S.title = `${p.display_name} · Focus Mastery`; renderTimer();
  $("#copyLink")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast(t("linkCopied")); } catch { toast(location.href); }
  });
  $("#askBuddy")?.addEventListener("click", async () => {
    const { error } = await sb.from("buddies").insert({ requester: myId(), addressee: p.id });
    if (failed(error, error?.code === "23505" ? t("alreadyRequest") : undefined)) return;
    toast(t("requestSent")); route();
  });
}

/* =========================================================
   Vista: buddies
   ========================================================= */
async function viewBuddies(rt) {
  app.innerHTML = `<p class="empty">${t("loadingBuddies")}</p>`;
  const me = myId(), tk = today(), monday = dkey(mondayOf(new Date()));
  const { data: rels } = await sb.from("buddies").select("*").or(`requester.eq.${me},addressee.eq.${me}`);
  if (!alive(rt)) return;
  const all = rels || [];
  const other = r => (r.requester === me ? r.addressee : r.requester);
  const accepted = all.filter(r => r.status === "accepted");
  const incoming = all.filter(r => r.status === "pending" && r.addressee === me);
  const outgoing = all.filter(r => r.status === "pending" && r.requester === me);
  const buddyIds = accepted.map(other);
  const since = dkey(addDays(new Date(), -90));
  const [people, daysR, acksR, nudgeR] = await Promise.all([
    profilesByIds(all.map(other)),
    buddyIds.length ? sb.from("days").select("*").in("user_id", buddyIds).gte("day", monday) : Promise.resolve({ data: [] }),
    sb.from("check_acks").select("*").gte("day", since).or(`from_user.eq.${me},to_user.eq.${me}`),
    sb.from("nudges").select("to_user").eq("day", tk).eq("from_user", me),
  ]);
  if (!alive(rt)) return;
  S.pendingIn = incoming.length;
  const badge = $("#navBadge"); if (badge) { badge.hidden = !incoming.length; badge.textContent = incoming.length; }
  const daysBy = {}; for (const d of daysR.data || []) (daysBy[d.user_id] ||= {})[d.day] = d;
  const acksAll = acksR.data || [], acks = acksAll.filter(a => a.day === tk);
  const nudged = new Set((nudgeR.data || []).map(n => n.to_user));
  // Racha compartida: días seguidos en los que os habéis hecho el check las dos personas
  const pairStreak = id => {
    const out = new Set(), inn = new Set();
    for (const a of acksAll) { if (a.from_user === me && a.to_user === id) out.add(a.day); else if (a.from_user === id && a.to_user === me) inn.add(a.day); }
    const both = k => out.has(k) && inn.has(k);
    let d = both(tk) ? new Date() : addDays(new Date(), -1), n = 0;
    while (both(dkey(d))) { n++; d = addDays(d, -1); }
    return n;
  };
  const given = Object.fromEntries(acks.filter(a => a.from_user === me).map(a => [a.to_user, a.emoji]));
  const received = acks.filter(a => a.to_user === me);
  const nb = buddyIds.length, checkedCount = buddyIds.filter(id => given[id]).length;

  const slots = Array.from({ length: Math.max(MIN_BUDDIES, nb) }, (_, i) => `<span class="slot ${i < nb ? "filled" : ""}"></span>`).join("");
  const left = nb - checkedCount;
  const status = nb < MIN_BUDDIES
    ? `<div class="notice alert">${t("missingBuddies", { n: MIN_BUDDIES - nb, min: MIN_BUDDIES })}<div class="slots">${slots}</div></div>`
    : left > 0
      ? `<div class="notice alert">${t("checkProgress", { done: checkedCount, total: nb, n: left, who: left === 1 ? t("buddyOne") : t("buddyMany") })}<div class="slots">${slots}</div></div>`
      : `<div class="notice ok">${t("checkComplete", { n: nb })}<div class="slots">${slots}</div></div>`;

  const card = id => {
    const q = people[id]; if (!q) return "";
    const d = daysBy[id] || {}, td = d[tk] || {};
    const wk = weekTotal(d), mine = given[id], ps = pairStreak(id);
    return `<article class="bcard ${mine ? "" : "todo"}">
      <div class="who">${avatar(q, "sm")}<div style="min-width:0;flex:1"><a href="${profileLink(q)}">${esc(q.display_name)}</a><div class="handle muted" style="font-size:12px">@${esc(q.username)}</div></div>
        ${ps ? `<span class="pill ok" title="${t("pairStreakTitle")}">🔥 ${t("pairStreak", { n: ps })}</span>` : ""}</div>
      <div class="nums"><span><strong class="num">${td.pomos || 0}</strong>${t("cardToday")}</span><span><strong class="num">${wk}</strong>${t("cardWeek", { n: WEEK_TARGET })}</span><span>${goalPill(td)}</span></div>
      ${td.checked_in ? (td.note ? `<p class="checkin-note" style="font-size:14px">${esc(td.note)}</p>` : `<p class="muted" style="margin:0">${t("checkinNoNote")}</p>`)
        : `<div class="row between"><p class="muted" style="margin:0">${t("noCheckinYet")}</p>
           <button type="button" class="btn small" data-nudge="${id}" ${nudged.has(id) ? "disabled" : ""}>${nudged.has(id) ? t("nudgeSent") : t("nudge")}</button></div>`}
      <div><div class="label" style="margin-bottom:6px">${mine ? t("youAcked") : t("giveAck")}</div>
        <div class="emojis" data-to="${id}">${EMOJIS.map(e => `<button type="button" aria-pressed="${mine === e}" data-emoji="${e}" aria-label="${t("ackWith", { e })}">${e}</button>`).join("")}</div></div>
    </article>`;
  };

  app.innerHTML = `
  <div class="row between"><h1 style="font-size:32px">${t("yourBuddies")}</h1><a class="btn" href="#/yo">${t("seeMyProfile")}</a></div>
  ${status}
  ${received.length ? `<div class="panel"><h2>${t("ackedYouToday")}</h2><div class="acks">${received.map(a => people[a.from_user] ? ackChip(people[a.from_user], a.emoji) : "").join("")}</div></div>` : ""}
  ${nb ? `<div class="feed">${buddyIds.sort((a, b) => !!given[a] - !!given[b]).map(card).join("")}</div>` : ""}
  ${incoming.length ? `<div class="panel"><h2>${t("wantBuddy")}</h2>${incoming.map(r => { const q = people[r.requester]; return q ? `<div class="req">${avatar(q, "sm")}<div class="grow"><a href="${profileLink(q)}">${esc(q.display_name)}</a> <span class="muted">@${esc(q.username)}</span></div>
      <button class="btn primary small" data-accept="${r.id}">${t("accept")}</button><button class="btn ghost small" data-remove="${r.id}">${t("reject")}</button></div>` : ""; }).join("")}</div>` : ""}
  <div class="grid2">
    <div class="panel"><h2>${t("addBuddy")}</h2>
      <form class="add" id="addBuddy"><input type="text" id="buddyUser" placeholder="${t("userPh")}" aria-label="${t("buddyUserLabel")}"><button class="btn primary">${t("sendRequest")}</button></form>
      <p class="hint" style="margin-top:10px">${t("noAccountYet")} <code id="myLink"></code></p>
    </div>
    <div class="panel"><h2>${t("sentRequests")}</h2>
      ${outgoing.length ? outgoing.map(r => { const q = people[r.addressee]; return q ? `<div class="req">${avatar(q, "sm")}<div class="grow"><a href="${profileLink(q)}">${esc(q.display_name)}</a></div><button class="btn ghost small" data-remove="${r.id}">${t("cancel")}</button></div>` : ""; }).join("") : `<p class="empty">${t("nonePending")}</p>`}
    </div>
  </div>
  ${nb ? `<div class="panel"><h2>${t("manage")}</h2>${accepted.map(r => { const q = people[other(r)]; return q ? `<div class="req">${avatar(q, "xs")}<div class="grow">${esc(q.display_name)}</div><button class="btn ghost small" data-remove="${r.id}" data-confirm data-orig="${t("unbuddy")}">${t("unbuddy")}</button></div>` : ""; }).join("")}</div>` : ""}`;

  $("#myLink").textContent = `${location.origin}${location.pathname}#/u/${S.me.username}`;
  app.querySelectorAll(".emojis").forEach(box => box.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    const { error } = await sb.from("check_acks").upsert({ day: tk, from_user: me, to_user: box.dataset.to, emoji: b.dataset.emoji }, { onConflict: "day,from_user,to_user" });
    if (!failed(error)) route();
  }));
  app.querySelectorAll("[data-nudge]").forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.nudge;
    const { error } = await sb.from("nudges").insert({ day: tk, to_user: id });
    if (error && error.code !== "23505") { failed(error, t("needSql")); return; }
    b.disabled = true; b.textContent = t("nudgeSent");
    toast(t("nudgeToast", { n: people[id]?.display_name || "" }));
  }));
  app.querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("buddies").update({ status: "accepted" }).eq("id", b.dataset.accept);
    if (!failed(error)) { toast(t("newBuddy")); route(); }
  }));
  app.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => {
    const remove = async () => {
      const { error } = await sb.from("buddies").delete().eq("id", b.dataset.remove);
      if (!failed(error)) route();
    };
    if (b.hasAttribute("data-confirm")) armDelete(b, t("sure"), remove); else remove();
  }));
  $("#addBuddy").addEventListener("submit", async e => {
    e.preventDefault();
    const u = $("#buddyUser").value.trim().replace(/^@/, "").toLowerCase(); if (!u) return;
    if (u === S.me.username) { toast(t("thatsYou")); return; }
    const { data: q } = await sb.from("profiles").select("id").eq("username", u).maybeSingle();
    if (!q) { toast(t("noSuchUser", { u })); return; }
    const { error } = await sb.from("buddies").insert({ requester: me, addressee: q.id });
    if (failed(error, error?.code === "23505" ? t("alreadyRequest") : undefined)) return;
    toast(t("requestSent")); route();
  });
}

/* =========================================================
   Días: escritura
   ========================================================= */
async function upsertToday(patch) {
  const row = { user_id: myId(), day: today(), ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await sb.from("days").upsert(row, { onConflict: "user_id,day" }).select().single();
  if (!failed(error)) S.todayRow = data;
  return !error;
}
async function syncTodayGoals() {
  const gs = S.goals.filter(g => g.scope === "day" && g.period === today());
  const done = gs.filter(g => g.done).length, total = gs.length, cur = S.todayRow || {};
  if (cur.goals_done !== done || cur.goals_total !== total) await upsertToday({ goals_done: done, goals_total: total });
}

/* =========================================================
   Temporizador (funciona en cualquier vista)
   ========================================================= */
const timer = Object.assign({ mode: "work", running: false, endAt: 0, remaining: WORK_MIN * 60e3, taskId: "", room: "" }, ls.get("fm-timer") || {});
const saveTimer = () => ls.set("fm-timer", timer);
const fullMs = () => (timer.mode === "work" ? WORK_MIN : BREAK_MIN) * 60e3;
const leftMs = () => (timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining);
let audio;
function beep() {
  try {
    audio ||= new AudioContext();
    [0, 0.25, 0.5].forEach(off => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.15, audio.currentTime + off);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + off + 0.2);
      o.connect(g).connect(audio.destination); o.start(audio.currentTime + off); o.stop(audio.currentTime + off + 0.22);
    });
  } catch {}
}
let finishing = false;
async function finish() {
  if (finishing) return; finishing = true;
  const wasWork = timer.mode === "work", startedAt = new Date(timer.endAt - WORK_MIN * 60e3), prevEnd = timer.endAt;
  timer.running = false; timer.mode = wasWork ? "break" : "work"; timer.remaining = fullMs();
  // En una sala, el descanso empieza solo y a la vez para todos
  if (wasWork && timer.room) { timer.running = true; timer.endAt = prevEnd + BREAK_MIN * 60e3; } else timer.room = "";
  saveTimer(); beep();
  if (wasWork && S.me) {
    const { error } = await sb.rpc("add_pomodoro", { p_day: dkey(startedAt), p_first_at: `${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}` });
    if (!failed(error, t("errPomo"))) {
      if (timer.taskId) {
        const { data: task } = await sb.from("tasks").select("spent,col").eq("id", timer.taskId).maybeSingle();
        if (task) await sb.from("tasks").update({ spent: task.spent + 1, col: task.col === "todo" ? "doing" : task.col }).eq("id", timer.taskId);
      }
      toast(t("pomoDone"));
    }
    if (parseRoute().view === "hoy") route();
  } else if (!wasWork) toast(t("breakDone"));
  finishing = false;
  renderTimer();
}
function renderTimer() {
  const clock = $("#tClock");
  const ms = leftMs(), s = Math.ceil(ms / 1000), txt = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  document.title = timer.running ? `${txt} · ${timer.mode === "work" ? t("focus") : t("break")}` : S.title;
  if (!clock) return;
  clock.textContent = txt;
  const rx = $("#relax"); if (rx) rx.hidden = timer.mode !== "break";
  $("#tMode").textContent = timer.mode === "work" ? t("focus") : t("break");
  $("#timer").classList.toggle("brk", timer.mode !== "work");
  $("#ringPrg").style.strokeDashoffset = (276.46 * (1 - ms / fullMs())).toFixed(2);
  $("#tStart").textContent = timer.running ? t("pause") : ms < fullMs() ? t("resume") : timer.mode === "work" ? t("start") : t("startBreak");
}
setInterval(() => {
  if (room) renderRoom();
  if (!timer.running) return;
  if (Date.now() >= timer.endAt) { if (S.me || !S.session) finish(); }
  else renderTimer();
}, 500);

/* =========================================================
   Salas de foco: pomodoro compartido, quién está y chat
   'general' = todo el mundo con cuenta; <id> = sala de esa persona y sus buddies
   ========================================================= */
let room = null;
function leaveRoom() { if (room?.ch) sb.removeChannel(room.ch); room = null; }
function roomPhase(st) {
  if (!st || st.mode !== "work" || !st.ends_at) return { ph: "idle" };
  const end = Date.parse(st.ends_at), now = Date.now();
  if (now < end) return { ph: "work", left: end - now, full: WORK_MIN * 60e3 };
  if (now < end + BREAK_MIN * 60e3) return { ph: "break", left: end + BREAK_MIN * 60e3 - now, full: BREAK_MIN * 60e3 };
  return { ph: "idle" };
}
// Al estar en la sala, tu temporizador sigue al de la sala (y cuenta tus pomodoros)
function syncTimerToRoom() {
  if (!room) return;
  const st = room.state, end = st?.mode === "work" && st.ends_at ? Date.parse(st.ends_at) : 0;
  if (end > Date.now()) {
    if (!(timer.running && timer.mode === "work" && timer.endAt === end)) {
      Object.assign(timer, { mode: "work", running: true, endAt: end, room: room.id }); saveTimer();
    }
  } else if (timer.room === room.id && timer.running && timer.mode === "work") {
    Object.assign(timer, { mode: "work", running: false, remaining: WORK_MIN * 60e3, room: "" }); saveTimer();
  }
}
function renderRoom() {
  if (!room || !$("#rClock")) return;
  const p = roomPhase(room.state), ms = p.left || 0, sec = Math.ceil(ms / 1000);
  $("#rClock").textContent = p.ph === "idle" ? `${pad(WORK_MIN)}:00` : `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  $("#rMode").textContent = p.ph === "work" ? t("focus") : p.ph === "break" ? t("break") : t("roomIdle");
  $("#rTimer").classList.toggle("brk", p.ph === "break");
  $("#rRing").style.strokeDashoffset = p.ph === "idle" ? "0" : (276.46 * (1 - ms / p.full)).toFixed(2);
  $("#rStart").hidden = p.ph === "work";
  $("#rStart").textContent = p.ph === "break" ? t("startNext") : t("startTogether");
  $("#rStop").hidden = p.ph !== "work";
  $("#relax").hidden = p.ph !== "break";
  const lock = p.ph === "work", input = $("#chatIn");
  input.disabled = lock; $("#chatSend").disabled = lock;
  input.placeholder = lock ? t("chatPaused") : t("chatPh");
  if (p.ph !== room.lastPh) { room.lastPh = p.ph; if (p.ph === "idle" && timer.room === room.id) syncTimerToRoom(); }
}
async function renderHere() {
  if (!room?.ch) return;
  const st = room.ch.presenceState();
  const ids = Object.keys(st).filter(uid => !room.allowed || room.allowed.has(uid));
  await ensureProfiles(ids);
  const box = $("#here"); if (!box || !room) return;
  const ps = ids.map(id => S.pcache[id]).filter(Boolean);
  box.innerHTML = `<div class="label" style="margin-bottom:6px">${t("here")} · <span class="num">${ps.length}</span></div>` +
    (ps.length > 1 ? `<div class="acks">${ps.map(q => ackChip(q)).join("")}</div>` : `<p class="empty" style="padding:0">${t("nobodyHere")}</p>`);
}
function renderMsgs() {
  const box = $("#msgs"); if (!box || !room) return;
  box.innerHTML = room.msgs.length ? room.msgs.map(m => {
    const q = S.pcache[m.user_id], d = new Date(m.created_at);
    return `<div class="msg ${m.user_id === myId() ? "mine" : ""}"><div class="mh">${q ? `<a href="${profileLink(q)}">${esc(q.display_name)}</a>` : "?"} <span class="when num">${pad(d.getHours())}:${pad(d.getMinutes())}</span></div><div class="mb">${esc(m.body)}</div></div>`;
  }).join("") : `<p class="empty">${t("chatEmpty")}</p>`;
  box.scrollTop = box.scrollHeight;
}
async function viewRoom(rt, id) {
  app.innerHTML = `<p class="empty">${t("loading")}</p>`;
  const me = myId(), owner = id === "general" ? null : id;
  const { data: rels } = await sb.from("buddies").select("requester,addressee").eq("status", "accepted").or(`requester.eq.${me},addressee.eq.${me}`);
  if (!alive(rt)) return;
  const myBuddies = (rels || []).map(r => (r.requester === me ? r.addressee : r.requester));
  if (owner && owner !== me && !myBuddies.includes(owner)) { location.hash = "#/sala"; return; }
  let allowed = null;
  if (owner) {
    const orels = owner === me ? rels : (await sb.from("buddies").select("requester,addressee").eq("status", "accepted").or(`requester.eq.${owner},addressee.eq.${owner}`)).data;
    allowed = new Set([owner, ...(orels || []).map(r => (r.requester === owner ? r.addressee : r.requester))]);
  }
  const [stR, msgR] = await Promise.all([
    sb.from("room_state").select("*").eq("room", id).maybeSingle(),
    sb.from("room_messages").select("*").eq("room", id).order("created_at", { ascending: false }).limit(60),
  ]);
  if (!alive(rt)) return;
  if (stR.error || msgR.error) { app.innerHTML = `<div class="notice alert">${t("needSql")}</div>`; return; }
  const msgs = (msgR.data || []).reverse();
  await ensureProfiles([me, ...myBuddies, ...(allowed || []), ...msgs.map(m => m.user_id)]);
  if (!alive(rt)) return;

  const ownerP = owner ? S.pcache[owner] : null;
  const name = !owner ? t("roomGeneral") : owner === me ? t("roomMine") : t("roomOf", { n: esc(ownerP?.display_name || "?") });
  const desc = !owner ? t("roomGeneralDesc") : owner === me ? t("roomMineDesc") : t("roomOfDesc", { n: esc(ownerP?.display_name || "?") });
  const tab = (rid, label) => `<a href="#/sala${rid === "general" ? "" : "/" + rid}" ${rid === id ? 'aria-current="page"' : ""}>${label}</a>`;
  app.innerHTML = `
  <nav class="roomtabs" aria-label="${t("navRooms")}">${tab("general", t("roomGeneral"))}${tab(me, t("roomMine"))}${myBuddies.map(b => S.pcache[b] ? tab(b, t("roomOf", { n: esc(S.pcache[b].display_name) })) : "").join("")}</nav>
  <div class="grid2">
    <div class="panel">
      <h1 style="font-size:28px">${name}</h1>
      <p class="hint" style="margin:4px 0 14px">${desc}</p>
      <div id="here"></div>
      <div class="timer" id="rTimer" style="margin-top:16px">
        <div class="ring">
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="44"/><circle class="prg" id="rRing" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg>
          <div class="t"><span class="mode" id="rMode"></span><span class="clock num" id="rClock">25:00</span></div>
        </div>
        <div class="row center"><button class="btn primary" id="rStart">${t("startTogether")}</button><button class="btn" id="rStop" hidden data-orig="${t("stopAll")}">${t("stopAll")}</button></div>
        <p class="hint">${t("roomHint")}</p>
        ${distractHTML()}
      </div>
    </div>
    <div class="panel chat">
      <h2>${t("chat")}</h2>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <form class="add" id="chatForm"><input type="text" id="chatIn" maxlength="500" aria-label="${t("chatPh")}" autocomplete="off"><button class="btn" id="chatSend">${t("send")}</button></form>
      <p class="hint" style="margin-top:8px">${t("chatHint")}</p>
    </div>
  </div>
  ${relaxHTML(false)}`;
  S.title = `${name.replace(/<[^>]*>/g, "")} · Focus Mastery`;

  room = { id, state: stR.data, msgs, allowed, ch: null, lastPh: null };
  syncTimerToRoom(); renderRoom(); renderMsgs(); wireDistract(); wireRelax();

  const ch = sb.channel(`room:${id}`, { config: { presence: { key: me } } });
  ch.on("presence", { event: "sync" }, renderHere)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room=eq.${id}` }, async ({ new: m }) => {
      if (room?.id !== id || room.msgs.some(x => x.id === m.id)) return;
      room.msgs.push(m); room.msgs = room.msgs.slice(-100);
      await ensureProfiles([m.user_id]); renderMsgs();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "room_state", filter: `room=eq.${id}` }, ({ new: st }) => {
      if (room?.id !== id || !st?.room) return;
      room.state = st; syncTimerToRoom(); renderRoom();
    })
    .subscribe(async status => { if (status === "SUBSCRIBED") await ch.track({ at: Date.now() }); });
  room.ch = ch;

  const setState = async patch => {
    const { data, error } = await sb.from("room_state").upsert({ room: id, by_user: me, updated_at: new Date().toISOString(), ...patch }).select().single();
    if (failed(error) || room?.id !== id) return;
    room.state = data; syncTimerToRoom(); renderRoom();
  };
  $("#rStart").addEventListener("click", () => {
    try { (audio ||= new AudioContext()).resume(); } catch {}
    setState({ mode: "work", ends_at: new Date(Date.now() + WORK_MIN * 60e3).toISOString() });
  });
  const stop = $("#rStop");
  stop.addEventListener("click", () => armDelete(stop, t("sure"), () => setState({ mode: "idle", ends_at: null })));
  $("#chatForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#chatIn"), body = input.value.trim(); if (!body || input.disabled) return;
    const { data, error } = await sb.from("room_messages").insert({ room: id, body }).select().single();
    if (failed(error)) return;
    input.value = "";
    if (room?.id === id && !room.msgs.some(x => x.id === data.id)) { room.msgs.push(data); renderMsgs(); }
  });
}

/* =========================================================
   Distracciones y zona relax (Hoy y salas)
   ========================================================= */
const distractHTML = () => `<div class="distract"><button type="button" class="btn ghost small" id="dOpen" aria-expanded="false">😵 ${t("gotDistracted")}</button>
  <div class="dkinds" id="dKinds" hidden>${DKINDS.map(([k, e]) => `<button type="button" class="btn small" data-kind="${k}">${e} ${t("dk_" + k)}</button>`).join("")}</div></div>`;
function wireDistract() {
  const open = $("#dOpen"), box = $("#dKinds"); if (!open) return;
  open.addEventListener("click", () => { box.hidden = !box.hidden; open.setAttribute("aria-expanded", !box.hidden); });
  box.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("distractions").insert({ day: today(), kind: b.dataset.kind });
    if (failed(error, error ? t("needSql") : undefined)) return;
    box.hidden = true; open.setAttribute("aria-expanded", "false"); toast(t("distractSaved"));
  }));
}
const relaxHTML = show => `<div class="panel relax" id="relax" ${show ? "" : "hidden"}>
  <h2>${t("relaxTitle")}</h2>
  <div class="breath" aria-hidden="true"><div class="bcircle"></div>
    <div class="blabel"><span>${t("inhale")}</span><span>${t("hold")}</span><span>${t("exhale")}</span><span>${t("hold")}</span></div></div>
  <p class="tip" id="rTip"></p>
  <div class="row center"><button type="button" class="btn small" id="rNext">${t("otherIdea")}</button></div>
  <p class="hint" style="text-align:center">${t("relaxHint")}</p></div>`;
function wireRelax() {
  const tips = L().tips; let i = Math.floor(Math.random() * tips.length);
  const show = () => { const el = $("#rTip"); if (el) el.textContent = tips[i % tips.length]; };
  show(); $("#rNext")?.addEventListener("click", () => { i++; show(); });
}

/* =========================================================
   Vista: Hoy (privado)
   ========================================================= */
async function viewHoy(rt) {
  app.innerHTML = `<p class="empty">${t("loading")}</p>`;
  const wd = new Date().getDay(), weekend = wd === 0 || wd >= 5;
  const [dayR, goalsR, tasksR, acksR, nudgeR, revR] = await Promise.all([
    sb.from("days").select("*").eq("user_id", myId()).eq("day", today()).maybeSingle(),
    sb.from("goals").select("*").order("created_at"),
    sb.from("tasks").select("id,title,project,col").neq("col", "done").order("created_at"),
    sb.from("check_acks").select("*").eq("to_user", myId()).eq("day", today()),
    sb.from("nudges").select("from_user").eq("to_user", myId()).eq("day", today()),
    weekend ? sb.from("reviews").select("worked,distracted,change").eq("week", dkey(mondayOf(new Date()))).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!alive(rt)) return;
  S.todayRow = dayR.data || null; S.goals = goalsR.data || []; S.tasks = tasksR.data || [];
  const acks = acksR.data || [];
  const nudgers = (nudgeR.data || []).map(n => n.from_user);
  const people = await profilesByIds([...acks.map(a => a.from_user), ...nudgers]);
  if (!alive(rt)) return;
  const td = S.todayRow || {};
  const p = td.pomos || 0;
  const nudgeNames = nudgers.map(id => people[id]?.display_name).filter(Boolean);
  const rv = revR.data, reviewDue = weekend && !revR.error && !(rv && (rv.worked || rv.distracted || rv.change));

  app.innerHTML = `
  ${nudgeNames.length && !td.checked_in ? `<div class="notice alert">${t(nudgeNames.length === 1 ? "nudgedYouOne" : "nudgedYouMany", { n: esc(nudgeNames.join(", ")) })}</div>` : ""}
  ${reviewDue ? `<div class="notice ok row between"><span>${t("reviewDue")}</span><a class="btn small" href="#/diario">${t("doReview")}</a></div>` : ""}
  <div class="grid2">
    <div class="panel">
      <div class="timer" id="timer">
        <div class="ring">
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="44"/><circle class="prg" id="ringPrg" cx="50" cy="50" r="44" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg>
          <div class="t"><span class="mode" id="tMode">${t("focus")}</span><span class="clock num" id="tClock">25:00</span></div>
        </div>
        <label class="row center" style="width:100%"><span class="label">${t("workingOn")}</span>
          <select id="tTask" style="max-width:100%;flex:1 1 200px"><option value="">${t("noTask")}</option>
            ${S.tasks.map(k => `<option value="${k.id}">${esc((k.project ? k.project + " · " : "") + k.title)}</option>`).join("")}</select></label>
        <div class="row center">
          <button class="btn primary" id="tStart">${t("start")}</button>
          <button class="btn" id="tReset">${t("reset")}</button>
          <button class="btn ghost" id="tSkip">${t("skip")}</button>
        </div>
        <div class="today-count">${t("todayCount", { p, min: DAY_MIN, max: DAY_MAX })}${S.me.start_time ? t("youStartAt", { t: esc(S.me.start_time) }) : ""}</div>
        ${timer.room && timer.running ? `<div class="hint">${t("linkedRoom")}</div>` : ""}
        ${distractHTML()}
        ${p >= DAY_MAX + 2 ? `<div class="warn">${t("overWarn")}</div>` : p >= DAY_MAX ? `<div class="warn">${t("dailyReached")}</div>` : ""}
      </div>
    </div>
    <div class="panel">
      <div class="row between" style="margin-bottom:4px">
        <h2 style="margin:0">${t("goals")}</h2>
        <div class="seg" id="gSeg" role="group" aria-label="${t("period")}">
          <button type="button" data-scope="day">${t("scopeDay")}</button><button type="button" data-scope="week">${t("scopeWeek")}</button><button type="button" data-scope="month">${t("scopeMonth")}</button>
        </div>
      </div>
      <ul class="list" id="gList"></ul>
      <form class="add" id="gForm"><input type="text" id="gInput" placeholder="${t("newGoal")}" maxlength="200" aria-label="${t("newGoalLabel")}"><button class="btn">${t("add")}</button></form>
      <p class="privnote" style="margin-top:10px">${t("goalsPrivate")}</p>
    </div>
  </div>
  ${relaxHTML(timer.mode === "break")}
  <div class="panel">
    <div class="row between"><h2 style="margin:0">${t("checkinTitle")}</h2>${td.checked_in ? `<span class="pill ok">${t("done")}</span>` : `<span class="pill part">${t("pending")}</span>`}</div>
    <p class="hint" style="margin:8px 0 12px">${t("checkinHint")}</p>
    <form id="ciForm" style="display:grid;gap:10px">
      <textarea id="ciNote" maxlength="280" rows="2" placeholder="${t("checkinPh")}">${esc(td.note || "")}</textarea>
      <div class="row"><button class="btn primary">${td.checked_in ? t("checkinUpdate") : t("checkinDo")}</button><span class="hint">${t("checkinPublic")}</span></div>
    </form>
    <div class="label" style="margin:16px 0 8px">${t("ackedYou")}</div>
    ${acks.length ? `<div class="acks">${acks.map(a => people[a.from_user] ? ackChip(people[a.from_user], a.emoji) : "").join("")}</div>` : `<p class="empty">${t("nobodyYet")}</p>`}
  </div>
  <div class="panel">
    <h2>${t("yourProfile")}</h2>
    <form id="pfForm" class="grid2" style="gap:14px">
      <div class="field"><label class="label" for="pfName">${t("displayName")}</label><input type="text" id="pfName" maxlength="60" value="${esc(S.me.display_name)}"></div>
      <div class="field"><label class="label" for="pfStart">${t("dailyStart")}</label><input type="time" id="pfStart" value="${esc(S.me.start_time || "")}"></div>
      <div class="field" style="grid-column:1/-1"><label class="label" for="pfBio">${t("bio")}</label><input type="text" id="pfBio" maxlength="280" value="${esc(S.me.bio || "")}" placeholder="${t("bioPh")}"></div>
      <div class="row"><button class="btn">${t("saveProfile")}</button><a class="btn ghost" href="#/contrasena">${t("changePw")}</a></div>
    </form>
  </div>`;

  const sel = $("#tTask"); sel.value = S.tasks.some(k => k.id === timer.taskId) ? timer.taskId : "";
  sel.addEventListener("change", () => { timer.taskId = sel.value; saveTimer(); });
  $("#tStart").addEventListener("click", () => {
    timer.room = "";
    if (timer.running) { timer.remaining = leftMs(); timer.running = false; }
    else { timer.endAt = Date.now() + timer.remaining; timer.running = true; try { (audio ||= new AudioContext()).resume(); } catch {} }
    saveTimer(); renderTimer();
  });
  $("#tReset").addEventListener("click", () => { timer.room = ""; timer.running = false; timer.remaining = fullMs(); saveTimer(); renderTimer(); });
  $("#tSkip").addEventListener("click", () => { timer.room = ""; timer.running = false; timer.mode = timer.mode === "work" ? "break" : "work"; timer.remaining = fullMs(); saveTimer(); renderTimer(); });
  renderTimer(); wireDistract(); wireRelax();

  $("#gSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.gScope = b.dataset.scope; renderGoals(); } });
  $("#gForm").addEventListener("submit", async e => {
    e.preventDefault(); const text = $("#gInput").value.trim(); if (!text) return;
    const { data, error } = await sb.from("goals").insert({ text, scope: S.gScope, period: periodFor(S.gScope) }).select().single();
    if (failed(error)) return;
    S.goals.push(data); $("#gInput").value = ""; renderGoals();
    if (S.gScope === "day") syncTodayGoals();
  });
  renderGoals();

  $("#ciForm").addEventListener("submit", async e => {
    e.preventDefault();
    const ok = await upsertToday({ checked_in: true, checkin_at: new Date().toISOString(), note: $("#ciNote").value.trim() || null });
    if (ok) { toast(t("checkinSaved")); route(); }
  });

  $("#pfForm").addEventListener("submit", async e => {
    e.preventDefault();
    const patch = { display_name: $("#pfName").value.trim() || S.me.display_name, start_time: $("#pfStart").value || null, bio: $("#pfBio").value.trim() || null };
    const { data, error } = await sb.from("profiles").update(patch).eq("id", myId()).select().single();
    if (!failed(error)) { S.me = data; toast(t("profileSaved")); }
  });
}
function renderGoals() {
  const list = $("#gList"); if (!list) return;
  document.querySelectorAll("#gSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.scope === S.gScope));
  const per = periodFor(S.gScope);
  const gs = S.goals.filter(g => g.scope === S.gScope && g.period === per);
  const empty = { day: t("emptyDay"), week: t("emptyWeek"), month: t("emptyMonth") }[S.gScope];
  list.innerHTML = gs.length ? gs.map(g => `<li class="${g.done ? "done" : ""}"><input type="checkbox" id="g-${g.id}" data-id="${g.id}" ${g.done ? "checked" : ""}>
      <span>${esc(g.text)}</span><button type="button" class="btn ghost" data-del="${g.id}" data-orig="✕" aria-label="${t("deleteGoal")}">✕</button></li>`).join("")
    : `<li class="empty">${empty}</li>`;
  list.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", async () => {
    const g = S.goals.find(x => x.id === cb.dataset.id); g.done = cb.checked; renderGoals();
    const { error } = await sb.from("goals").update({ done: g.done }).eq("id", g.id);
    if (!failed(error) && g.scope === "day") syncTodayGoals();
  }));
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => armDelete(b, t("confirmDelete"), async () => {
    const g = S.goals.find(x => x.id === b.dataset.del);
    const { error } = await sb.from("goals").delete().eq("id", g.id);
    if (failed(error)) return;
    S.goals = S.goals.filter(x => x !== g); renderGoals();
    if (g.scope === "day") syncTodayGoals();
  })));
}

/* =========================================================
   Vista: Tablero (privado)
   ========================================================= */
const COLS = ["todo", "doing", "done"];
const colLabel = c => ({ todo: t("colTodo"), doing: t("colDoing"), done: t("colDone") }[c]);
async function viewBoard(rt) {
  app.innerHTML = `<p class="empty">${t("loadingBoard")}</p>`;
  const { data, error } = await sb.from("tasks").select("*").order("created_at");
  if (!alive(rt)) return;
  if (failed(error, t("errBoard"))) return;
  S.tasks = data || [];
  app.innerHTML = `
  <div class="panel">
    <form class="add" id="kForm">
      <input type="text" id="kTitle" placeholder="${t("newTask")}" maxlength="200" aria-label="${t("taskTitle")}">
      <input type="text" id="kProj" placeholder="${t("projectPh")}" maxlength="40" style="flex:0 1 220px" aria-label="${t("project")}">
      <label class="row" style="gap:6px"><span class="label">${t("estimate")}</span><input type="number" id="kEst" min="0" max="500" value="4" style="width:70px"></label>
      <button class="btn primary">${t("add")}</button>
    </form>
    <p class="privnote" style="margin-top:10px">${t("boardPrivate")}</p>
  </div>
  <div class="board" id="board">${COLS.map(c => `<div class="col" data-col="${c}"><h3>${colLabel(c)} <span class="num" data-count></span></h3></div>`).join("")}</div>`;
  $("#kForm").addEventListener("submit", async e => {
    e.preventDefault(); const title = $("#kTitle").value.trim(); if (!title) return;
    const row = { title, project: $("#kProj").value.trim() || null, estimate: Math.max(0, parseInt($("#kEst").value) || 0) };
    const { data, error } = await sb.from("tasks").insert(row).select().single();
    if (failed(error)) return;
    S.tasks.push(data); $("#kTitle").value = ""; renderBoard();
  });
  document.querySelectorAll(".col").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", e => { e.preventDefault(); col.classList.remove("over"); moveTask(e.dataTransfer.getData("text/plain"), col.dataset.col); });
  });
  renderBoard();
}
async function moveTask(id, col) {
  const task = S.tasks.find(x => x.id === id); if (!task || task.col === col) return;
  const prev = task.col; task.col = col; renderBoard();
  const { error } = await sb.from("tasks").update({ col }).eq("id", id);
  if (failed(error)) { task.col = prev; renderBoard(); }
}
function renderBoard() {
  for (const c of COLS) {
    const el = document.querySelector(`.col[data-col="${c}"]`); if (!el) return;
    el.querySelectorAll(".card,.empty").forEach(n => n.remove());
    const ts = S.tasks.filter(x => x.col === c);
    el.querySelector("[data-count]").textContent = ts.length;
    if (!ts.length) el.insertAdjacentHTML("beforeend", `<p class="empty">${c === "todo" ? t("firstTask") : t("dragHere")}</p>`);
    const i = COLS.indexOf(c);
    for (const task of ts) {
      if (S.editId === task.id) {
        el.insertAdjacentHTML("beforeend", `<form class="card editing" data-id="${task.id}">
          <input type="text" name="title" value="${esc(task.title)}" maxlength="200" required aria-label="${t("taskTitle")}">
          <input type="text" name="project" value="${esc(task.project || "")}" maxlength="40" placeholder="${t("projectPh")}" aria-label="${t("project")}">
          <div class="row" style="gap:6px;flex-wrap:wrap"><span>🍅</span>
            <input type="number" name="spent" min="0" max="500" value="${task.spent}" style="width:64px" aria-label="${t("spentLabel")}"> /
            <input type="number" name="estimate" min="0" max="500" value="${task.estimate}" style="width:64px" aria-label="${t("estimate")}">
          </div>
          <div class="row" style="gap:6px;justify-content:flex-end">
            <button type="button" class="btn small" data-cancel>${t("cancel")}</button>
            <button class="btn small primary">${t("saveBtn")}</button>
          </div></form>`);
        continue;
      }
      el.insertAdjacentHTML("beforeend", `<div class="card ${timer.taskId === task.id ? "active" : ""}" draggable="true" data-id="${task.id}">
        <div class="tt">${esc(task.title)}</div>
        <div class="row between"><div class="meta">${task.project ? `<span class="tag">${esc(task.project)}</span>` : ""}<span class="num">🍅 ${task.spent}${task.estimate ? " / " + task.estimate : ""}</span></div>
        <div class="acts">
          ${i > 0 ? `<button type="button" class="btn ghost" data-move="${COLS[i - 1]}" aria-label="${t("moveTo", { c: colLabel(COLS[i - 1]) })}">◀</button>` : ""}
          ${i < 2 ? `<button type="button" class="btn ghost" data-move="${COLS[i + 1]}" aria-label="${t("moveTo", { c: colLabel(COLS[i + 1]) })}">▶</button>` : ""}
          ${c !== "done" ? `<button type="button" class="btn ghost" data-focus aria-label="${t("workOnTask")}" title="${t("workOnTask")}">🍅</button>` : ""}
          <button type="button" class="btn ghost" data-edit aria-label="${t("editTask")}" title="${t("editTask")}">✎</button>
          <button type="button" class="btn ghost" data-del data-orig="✕" aria-label="${t("deleteTask")}">✕</button>
        </div></div></div>`);
    }
  }
  const edit = document.querySelector(".card.editing");
  if (edit) {
    const id = edit.dataset.id, f = edit.elements;
    f.title.focus();
    edit.querySelector("[data-cancel]").addEventListener("click", () => { S.editId = null; renderBoard(); });
    edit.addEventListener("keydown", e => { if (e.key === "Escape") { S.editId = null; renderBoard(); } });
    edit.addEventListener("submit", async e => {
      e.preventDefault();
      const title = f.title.value.trim(); if (!title) return;
      const patch = { title, project: f.project.value.trim() || null,
        spent: Math.max(0, parseInt(f.spent.value) || 0), estimate: Math.max(0, parseInt(f.estimate.value) || 0) };
      const { error } = await sb.from("tasks").update(patch).eq("id", id);
      if (failed(error)) return;
      Object.assign(S.tasks.find(x => x.id === id), patch); S.editId = null; renderBoard();
    });
  }
  document.querySelectorAll(".card:not(.editing)").forEach(card => {
    const id = card.dataset.id;
    const openEdit = () => { S.editId = id; renderBoard(); };
    card.querySelector("[data-edit]").addEventListener("click", openEdit);
    card.querySelector(".tt").addEventListener("dblclick", openEdit);
    card.addEventListener("dragstart", e => { card.classList.add("dragging"); e.dataTransfer.setData("text/plain", id); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.querySelectorAll("[data-move]").forEach(b => b.addEventListener("click", () => moveTask(id, b.dataset.move)));
    card.querySelector("[data-focus]")?.addEventListener("click", () => { timer.taskId = id; saveTimer(); location.hash = "#/hoy"; });
    const del = card.querySelector("[data-del]");
    del.addEventListener("click", () => armDelete(del, t("confirmDelete"), async () => {
      const { error } = await sb.from("tasks").delete().eq("id", id);
      if (!failed(error)) { S.tasks = S.tasks.filter(x => x.id !== id); renderBoard(); }
    }));
  });
}

/* =========================================================
   Vista: Diario (privado)
   ========================================================= */
let jTimer = null;
async function viewJournal(rt) {
  app.innerHTML = `<p class="empty">${t("loadingJournal")}</p>`;
  const { data, error } = await sb.from("journal").select("day,text").order("day", { ascending: false });
  if (!alive(rt)) return;
  if (failed(error, t("errJournal"))) return;
  const entries = Object.fromEntries((data || []).map(j => [j.day, j.text]));
  app.innerHTML = `
  <div class="panel" id="review">
    <div class="row between" style="margin-bottom:10px">
      <h2 style="margin:0">${t("weeklyReview")}</h2>
      <div class="row" style="gap:4px"><button type="button" class="btn ghost small" id="rwPrev" aria-label="${t("prevWeek")}">◀</button>
        <span id="rwLabel" class="num"></span>
        <button type="button" class="btn ghost small" id="rwNext" aria-label="${t("nextWeek")}">▶</button></div>
    </div>
    <div id="rwBody"><p class="empty">${t("loading")}</p></div>
  </div>
  <div class="jgrid">
    <div class="panel"><div class="label" style="margin-bottom:8px">${t("entries")}</div><ul class="jlist" id="jList"></ul></div>
    <div class="panel">
      <div class="row between" style="margin-bottom:10px"><input type="date" id="jDate" aria-label="${t("date")}"><span class="saved" id="jSaved"></span></div>
      <textarea id="jText" aria-label="${t("journalEntry")}" placeholder="${t("journalPh")}"></textarea>
      <p class="privnote" style="margin-top:8px">${t("journalPrivate")}</p>
    </div>
  </div>`;
  const text = $("#jText");
  const renderList = () => {
    const keys = new Set(Object.keys(entries).filter(k => entries[k]?.trim())); keys.add(today()); keys.add(S.jDate);
    $("#jList").innerHTML = [...keys].sort().reverse().map(k => `<li><button type="button" data-day="${k}" aria-current="${k === S.jDate}">${fmtDay(k)} ${k.slice(0, 4)}</button></li>`).join("");
    $("#jList").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { flush(); S.jDate = b.dataset.day; load(); }));
  };
  const load = () => { $("#jDate").value = S.jDate; text.value = entries[S.jDate] || ""; $("#jSaved").textContent = ""; renderList(); };
  const flush = async () => {
    if (!jTimer) return; clearTimeout(jTimer); jTimer = null;
    const day = S.jDate, value = text.value; entries[day] = value;
    const { error } = await sb.from("journal").upsert({ user_id: myId(), day, text: value, updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
    if (!failed(error) && $("#jSaved")) { $("#jSaved").textContent = t("saved"); renderList(); }
  };
  text.addEventListener("input", () => { $("#jSaved").textContent = t("typing"); clearTimeout(jTimer); jTimer = setTimeout(() => { flush(); }, 1200); });
  text.addEventListener("blur", flush);
  const goWeek = n => { flushReview(); S.rWeek = dkey(addDays(parseKey(S.rWeek), 7 * n)); loadReview(rt); };
  $("#rwPrev").addEventListener("click", () => goWeek(-1));
  $("#rwNext").addEventListener("click", () => goWeek(1));
  loadReview(rt);
  $("#jDate").addEventListener("change", e => { if (!e.target.value) return; flush(); S.jDate = e.target.value; load(); });
  load();
}

/* Revisión semanal (dentro del Diario) */
let rwTimer = null, rwPending = null;
async function flushReview() {
  if (!rwTimer) return; clearTimeout(rwTimer); rwTimer = null;
  const row = rwPending; rwPending = null;
  const { error } = await sb.from("reviews").upsert(row, { onConflict: "user_id,week" });
  if (!failed(error) && $("#rwSaved") && S.rWeek === row.week) $("#rwSaved").textContent = t("saved");
}
async function loadReview(rt) {
  const curMon = dkey(mondayOf(new Date()));
  if (S.rWeek > curMon) S.rWeek = curMon;
  const week = S.rWeek, mon = parseKey(week), end = dkey(addDays(mon, 6));
  $("#rwLabel").textContent = t("weekOf", { d: fmtDay(week) });
  $("#rwNext").disabled = week >= curMon;
  const [dR, gR, xR, rR] = await Promise.all([
    sb.from("days").select("day,pomos,checked_in").eq("user_id", myId()).gte("day", week).lte("day", end),
    sb.from("goals").select("done").eq("scope", "week").eq("period", weekKey(mon)),
    sb.from("distractions").select("kind").gte("day", week).lte("day", end),
    sb.from("reviews").select("*").eq("week", week).maybeSingle(),
  ]);
  if (!alive(rt) || S.rWeek !== week || !$("#rwBody")) return;
  if (xR.error || rR.error) { $("#rwBody").innerHTML = `<p class="notice alert">${t("needSql")}</p>`; return; }
  const days = dR.data || [], goals = gR.data || [], xs = xR.data || [], rv = rR.data || {};
  const pomos = days.reduce((a, d) => a + (d.pomos || 0), 0), checks = days.filter(d => d.checked_in).length;
  const gDone = goals.filter(g => g.done).length;
  const counts = {}; for (const x of xs) counts[x.kind] = (counts[x.kind] || 0) + 1;
  const kinds = DKINDS.filter(([k]) => counts[k]).sort((a, b) => counts[b[0]] - counts[a[0]]);
  const q = (id, key, val) => `<div class="field"><label class="label" for="${id}">${t(key)}</label><textarea id="${id}" rows="3" maxlength="4000">${esc(val || "")}</textarea></div>`;
  $("#rwBody").innerHTML = `
    <div class="rwstats">
      <span><strong class="num">${pomos}</strong> ${t("rwPomos", { h: hours(pomos), target: WEEK_TARGET })}</span>
      <span><strong class="num">${checks}/7</strong> ${t("rwCheckins")}</span>
      <span>${goals.length ? `<strong class="num">${gDone}/${goals.length}</strong> ${t("rwGoals")}` : t("rwNoGoals")}</span>
    </div>
    <div class="label" style="margin:12px 0 6px">${t("rwDistractions")}</div>
    ${kinds.length ? `<div class="acks">${kinds.map(([k, e]) => `<span class="ack" style="padding:3px 10px">${e} ${t("dk_" + k)} · <b class="num">${counts[k]}</b></span>`).join("")}</div>`
      : `<p class="empty">${t("rwNoDistractions")}</p>`}
    <div class="rwqs">${q("rw1", "rwQ1", rv.worked)}${q("rw2", "rwQ2", rv.distracted)}${q("rw3", "rwQ3", rv.change)}</div>
    <div class="row between"><p class="privnote" style="margin:0">${t("reviewPrivate")}</p><span class="saved" id="rwSaved"></span></div>`;
  ["rw1", "rw2", "rw3"].forEach(id => {
    const el = $("#" + id);
    el.addEventListener("input", () => {
      $("#rwSaved").textContent = t("typing");
      rwPending = { user_id: myId(), week, worked: $("#rw1").value, distracted: $("#rw2").value, change: $("#rw3").value, updated_at: new Date().toISOString() };
      clearTimeout(rwTimer); rwTimer = setTimeout(flushReview, 1200);
    });
    el.addEventListener("blur", flushReview);
  });
}

/* =========================================================
   Arranque
   ========================================================= */
if (!configured) {
  viewSetup();
} else {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (S.session) { await loadMe(); refreshPendingBadge(); }
  sb.auth.onAuthStateChange((ev, session) => {
    const changed = (session?.user?.id || null) !== myId();
    S.session = session;
    if (ev === "PASSWORD_RECOVERY") {
      setTimeout(async () => {
        if (changed) { await loadMe(); refreshPendingBadge(); }
        history.replaceState(null, "", location.pathname + "#/contrasena");
        route();
      }, 0);
      return;
    }
    if (!changed) return;
    // No llamar a Supabase dentro del callback: se difiere
    setTimeout(async () => {
      await loadMe(); refreshPendingBadge();
      if (location.search.includes("code=")) history.replaceState(null, "", location.pathname + (location.hash || "#/hoy"));
      route();
    }, 0);
  });
  if (location.search.includes("code=") && S.session) history.replaceState(null, "", location.pathname + (location.hash || "#/hoy"));
  addEventListener("hashchange", route);
  addEventListener("beforeunload", () => { if (jTimer) $("#jText")?.dispatchEvent(new Event("blur")); flushReview(); });
  route();
}
