const SUPABASE_URL = "https://umncetdwojshmfybrnjq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DsthlKdZ4pMNo-yXjAZNyA_sU6vhg3f";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sessionCodeEl = document.getElementById("sessionCode");
const joinBtn = document.getElementById("joinBtn");
const sessionInfo = document.getElementById("sessionInfo");
const priceInput = document.getElementById("priceInput");
const savePriceBtn = document.getElementById("savePriceBtn");
const nameInput = document.getElementById("nameInput");
const addBeerBtn = document.getElementById("addBeerBtn");
const rowsEl = document.getElementById("rows");
const grandTotalEl = document.getElementById("grandTotal");

let currentSession = null;
let currentRows = [];

const qp = new URLSearchParams(location.search);
if (qp.get("s")) sessionCodeEl.value = qp.get("s");

joinBtn.addEventListener("click", joinOrCreateSession);
savePriceBtn.addEventListener("click", savePrice);
addBeerBtn.addEventListener("click", addBeer);

async function joinOrCreateSession() {
  const code = (sessionCodeEl.value || "").trim().toLowerCase();
  if (!code) return alert("Pon un código de sesión");
  history.replaceState({}, "", `?s=${encodeURIComponent(code)}`);

  let { data: found, error } = await sb.from("sessions").select("*").eq("code", code).maybeSingle();
  if (error) return alert(error.message);

  if (!found) {
    const { data: created, error: e2 } = await sb
      .from("sessions")
      .insert({ code, price_per_beer: 0 })
      .select("*")
      .single();
    if (e2) return alert(e2.message);
    found = created;
  }

  currentSession = found;
  priceInput.value = Number(found.price_per_beer || 0);
  sessionInfo.textContent = `Sesión activa: ${found.code}`;
  await loadRows();
  subscribeRealtime();
}

async function savePrice() {
  if (!currentSession) return alert("Entra en una sesión primero");
  const p = Number(priceInput.value || 0);
  const { error } = await sb.from("sessions").update({ price_per_beer: p }).eq("id", currentSession.id);
  if (error) return alert(error.message);
  currentSession.price_per_beer = p;
  render();
}

async function addBeer() {
  if (!currentSession) return alert("Entra en una sesión primero");
  const name = (nameInput.value || "").trim();
  if (!name) return alert("Pon un nombre");

  const existing = currentRows.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    const { error } = await sb.from("orders").insert({
      session_id: currentSession.id,
      name,
      beers: 1
    });
    if (error) return alert(error.message);
  } else {
    const { error } = await sb.from("orders").update({ beers: existing.beers + 1 }).eq("id", existing.id);
    if (error) return alert(error.message);
  }

  nameInput.value = "";
  await loadRows();
}

async function removeOne(id) {
  const row = currentRows.find(r => r.id === id);
  if (!row) return;
  if (row.beers <= 1) {
    const { error } = await sb.from("orders").delete().eq("id", id);
    if (error) return alert(error.message);
  } else {
    const { error } = await sb.from("orders").update({ beers: row.beers - 1 }).eq("id", id);
    if (error) return alert(error.message);
  }
  await loadRows();
}

async function loadRows() {
  if (!currentSession) return;
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("session_id", currentSession.id)
    .order("name", { ascending: true });
  if (error) return alert(error.message);
  currentRows = data || [];
  render();
}

function render() {
  const price = Number(currentSession?.price_per_beer || 0);
  rowsEl.innerHTML = "";
  let grand = 0;

  for (const r of currentRows) {
    const total = r.beers * price;
    grand += total;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td>${r.beers}</td>
      <td>${total.toFixed(2)} €</td>
      <td><button class="small danger" data-id="${r.id}">-1</button></td>
    `;
    rowsEl.appendChild(tr);
  }

  grandTotalEl.textContent = `Total general: ${grand.toFixed(2)} €`;
  document.querySelectorAll("button[data-id]").forEach(b => {
    b.onclick = () => removeOne(Number(b.dataset.id));
  });
}

function subscribeRealtime() {
  sb.channel(`orders-${currentSession.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "orders",
      filter: `session_id=eq.${currentSession.id}`
    }, () => loadRows())
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "sessions",
      filter: `id=eq.${currentSession.id}`
    }, async () => {
      const { data } = await sb.from("sessions").select("*").eq("id", currentSession.id).single();
      currentSession = data || currentSession;
      priceInput.value = Number(currentSession.price_per_beer || 0);
      render();
    })
    .subscribe();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}
