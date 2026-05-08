function qs(id) {
  return document.getElementById(id);
}

const DEFAULT_API_BASE = "https://tgs-8ckkn.ondigitalocean.app/api";

function getApiBase() {
  const fromStorage = localStorage.getItem("apiBase");
  const base = fromStorage ? String(fromStorage).trim() : DEFAULT_API_BASE;
  return base.replace(/\/$/, "");
}

function setOut(el, obj) {
  if (!el) return;
  const text =
    typeof obj === "string"
      ? obj
      : obj && (obj.message || obj.error)
        ? obj.message || obj.error
        : JSON.stringify(obj, null, 2);

  el.hidden = !text;
  el.textContent = text || "";
}

function getOccurrenceAdminOut() {
  if (currentViewId === "view-admin-occurrences") {
    return qs("soAdminOut") || qs("occurrenceConfigOut");
  }
  return qs("occurrenceConfigOut") || qs("soAdminOut");
}

function setConsultationAdminVisibility(isAdmin) {
  const adminControls = qs("consultationAdminControls");
  if (adminControls) adminControls.hidden = !isAdmin;

  ["filterUserId", "btnEntriesByUser", "btnAllEntries"].forEach((id) => {
    const el = qs(id);
    if (el) el.disabled = !isAdmin;
  });
}

function setAdminOnlyNavigationVisibility(isAdmin) {
  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    el.hidden = !isAdmin;
    el.disabled = !isAdmin;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMapsCoordsUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function buildMapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderMapLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function renderCoordinateCell(latitude, longitude, axis) {
  if (latitude == null || longitude == null) return "-";
  const value = axis === "lat" ? latitude : longitude;
  const numericValue = Number(value);
  const label = Number.isFinite(numericValue) ? numericValue.toFixed(6) : String(value);
  return renderMapLink(buildMapsCoordsUrl(latitude, longitude), label);
}

function renderGeoOut(geo) {
  const out = qs("geoOut");
  if (!out) return;

  const url = buildMapsCoordsUrl(geo.latitude, geo.longitude);
  const label = `${geo.latitude.toFixed(6)}, ${geo.longitude.toFixed(6)}`;
  out.innerHTML =
    `Localização: ${renderMapLink(url, label)} ` +
    `(±${Math.round(geo.accuracy)}m)`;
}

function setJourneyMeta(message) {
  const meta = qs("journeyMeta");
  if (meta) meta.textContent = message;
}

function setClockActionHint(message) {
  const hint = qs("clockActionHint");
  if (hint) hint.textContent = message;
}

function showToast(message, type = "info", durationMs = 3200) {
  const container = qs("toastContainer");
  if (!container || !message) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = String(message);
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, durationMs);
}

function toastSuccess(message) {
  showToast(message, "success");
}

function toastError(message) {
  showToast(message, "error", 4200);
}

function toastInfo(message) {
  showToast(message, "info");
}

function saveToken(token) {
  if (!token) return;
  localStorage.setItem("token", String(token).trim());
}

function loadToken() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  const normalized = String(token).trim();
  if (!normalized || normalized === "null" || normalized === "undefined") {
    return null;
  }

  return normalized;
}

function clearToken() {
  localStorage.removeItem("token");
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );

    return JSON.parse(json);
  } catch {
    return null;
  }
}

function applyAuthGate() {
  const isLogged = !!loadToken();
  const authGate = qs("authGate");
  const appRoot = qs("appRoot");

  if (authGate) authGate.hidden = isLogged;
  if (appRoot) appRoot.hidden = !isLogged;

  if (document.body) {
    document.body.classList.toggle("auth-only", !isLogged);
  }
}

function two(n) {
  return String(n).padStart(2, "0");
}

function nowISO() {
  return new Date().toISOString();
}

let clockIntervalId = null;

function startClock() {
  const el = qs("clock");
  const elDate = qs("clockDate");
  if (!el || !elDate) return;

  function tick() {
    const d = new Date();
    el.textContent = `${two(d.getHours())}:${two(d.getMinutes())}`;
    elDate.textContent = d.toLocaleDateString("pt-BR");
  }

  tick();

  if (clockIntervalId) return;
  clockIntervalId = setInterval(tick, 1000);
}

function getGeo() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalização não suportada"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        const msg =
          err.code === 1
            ? "Permissão de localização negada"
            : err.code === 2
              ? "Localização indisponível"
              : err.code === 3
                ? "Timeout ao obter localização"
                : "Erro ao obter localização";

        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

startClock();

function updateAuthUI() {
  const token = loadToken();
  const payload = token ? decodeJwtPayload(token) : null;
  const userLabel =
    payload && payload.name
      ? `${payload.name}${payload.role ? ` (${payload.role})` : ""}`
      : null;

  qs("authStatus").textContent = token
    ? userLabel
      ? `Logado: ${userLabel}`
      : "Logado (token salvo)"
    : "Deslogado";

  const isLogged = !!token;
  [
    "btnCreateUser",
    "btnToggleActive",
    "btnListUsers",
    "btnLoadAlerts",
    "btnLoadForgottenRequests",
    "btnApproveForgotten",
    "btnRejectForgotten",
    "btnDownloadForgottenPdf",
    "btnAllEntries",
    "btnEntriesByUser",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isLogged;
  });
}

async function apiFetch(path, options = {}) {
  const base = getApiBase();
  const url = `${base}${path}`;

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = loadToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: "Resposta nÃ£o Ã© JSON" };
  }

  if (!res.ok) {
    const msg = data && data.error ? data.error : "Erro na requisiÃ§Ã£o";
    throw new Error(`${res.status} - ${msg}`);
  }

  return data;
}

function clearEntriesTable() {
  qs("entriesTable").querySelector("tbody").innerHTML = "";
  qs("entriesInfo").textContent = "-";
  setOut(qs("entriesOut"), "");
}

function fmtIsoToBr(iso) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function renderAddressCell(address) {
  if (!address) return "-";
  const escaped = escapeHtml(address).replace(/\n/g, "<br>");
  return `${escaped}<br>${renderMapLink(buildMapsSearchUrl(address), "Abrir no mapa")}`;
}

function renderEntries(entries) {
  const tbody = qs("entriesTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (const e of entries) {
    const tr = document.createElement("tr");

    const userCol = e.name
      ? `${e.name} (${e.cpf}) [${e.user_id}]`
      : String(e.user_id);

    tr.innerHTML = `
      <td>${e.id}</td>
      <td>${userCol}</td>
      <td>${e.type}</td>
      <td>${fmtIsoToBr(e.occurred_at)}</td>
      <td>${renderCoordinateCell(e.latitude, e.longitude, "lat")}</td>
      <td>${renderCoordinateCell(e.latitude, e.longitude, "lng")}</td>
      <td>${renderAddressCell(e.address || e.location_address)}</td>
    `;

    tbody.appendChild(tr);
  }

  qs("entriesInfo").textContent = `Total: ${entries.length}`;
}

function renderUsersTable(users) {
  const table = qs("usersTable");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  for (const user of users) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${user.name || "-"}</td>
      <td>${user.cpf || "-"}</td>
      <td>${user.role || "-"}</td>
      <td>${Number(user.is_active) === 1 ? "Ativo" : "Inativo"}</td>
      <td>${user.created_at ? fmtIsoToBr(user.created_at) : "-"}</td>
    `;
    tbody.appendChild(tr);
  }

  const info = qs("usersInfo");
  if (info) info.textContent = `Total: ${users.length}`;
}

async function loadUsersTable() {
  const data = await apiFetch("/admin/users?limit=50&offset=0", {
    method: "GET",
  });
  const users = data.users || [];
  renderUsersTable(users);
  return users.length;
}

function buildPeriodQuery() {
  const fromVal = qs("fromDate").value;
  const toVal = qs("toDate").value;

  const params = new URLSearchParams();

  if (fromVal) params.set("from", new Date(fromVal).toISOString());
  if (toVal) params.set("to", new Date(toVal).toISOString());

  const q = params.toString();
  return q ? `?${q}` : "";
}

function statusLabel(status) {
  switch (String(status || "").toUpperCase()) {
    case "APPROVED":
      return "Aprovado";
    case "REJECTED":
      return "Rejeitado";
    default:
      return "Pendente";
  }
}

function fmtDateOnlyToBr(dateText) {
  if (!dateText) return "-";
  const [year, month, day] = String(dateText).split("-");
  if (!year || !month || !day) return dateText;
  return `${day}/${month}/${year}`;
}

function fmtTimeValue(timeText) {
  return timeText ? String(timeText).slice(0, 5) : "-";
}

let forgottenRequestsCache = [];
let selectedForgottenRequestId = null;

function clearForgottenDetail() {
  selectedForgottenRequestId = null;
  const empty = qs("forgottenDetailEmpty");
  const content = qs("forgottenDetailContent");
  const signatureImage = qs("forgottenSignatureImage");
  const signatureFallback = qs("forgottenSignatureFallback");

  if (empty) empty.hidden = false;
  if (content) content.hidden = true;
  if (signatureImage) {
    signatureImage.hidden = true;
    signatureImage.removeAttribute("src");
  }
  if (signatureFallback) signatureFallback.hidden = false;
  if (qs("forgottenReviewNotes")) qs("forgottenReviewNotes").value = "";
  if (qs("btnApproveForgotten")) qs("btnApproveForgotten").disabled = true;
  if (qs("btnRejectForgotten")) qs("btnRejectForgotten").disabled = true;
  if (qs("btnDownloadForgottenPdf")) {
    qs("btnDownloadForgottenPdf").disabled = true;
    qs("btnDownloadForgottenPdf").hidden = true;
    delete qs("btnDownloadForgottenPdf").dataset.url;
  }
  setOut(qs("forgottenDetailOut"), "");
}

function setForgottenDetailValue(id, value) {
  const el = qs(id);
  if (!el) return;
  el.textContent = value || "-";
}

function renderForgottenDetail(request) {
  const empty = qs("forgottenDetailEmpty");
  const content = qs("forgottenDetailContent");
  const signatureImage = qs("forgottenSignatureImage");
  const signatureFallback = qs("forgottenSignatureFallback");

  if (!request) {
    clearForgottenDetail();
    return;
  }

  selectedForgottenRequestId = request.id;
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;

  setForgottenDetailValue(
    "forgottenDetailEmployeeName",
    request.user_name
      ? `${request.user_name} (${request.user_cpf || "-"}) [${request.user_id}]`
      : request.employee_name,
  );
  setForgottenDetailValue("forgottenDetailDate", fmtDateOnlyToBr(request.forgotten_date));
  setForgottenDetailValue("forgottenDetailEntry", fmtTimeValue(request.entry_time));
  setForgottenDetailValue("forgottenDetailExit", fmtTimeValue(request.exit_time));
  setForgottenDetailValue("forgottenDetailStatus", statusLabel(request.status));
  setForgottenDetailValue("forgottenDetailSignedAt", fmtIsoToBr(request.signed_at));
  setForgottenDetailValue(
    "forgottenDetailIntegrityHash",
    request.integrity_hash
      ? `${request.integrity_algorithm || "SHA-256"}: ${request.integrity_hash}`
      : "Nao gerada",
  );
  setForgottenDetailValue("forgottenDetailCreatedAt", fmtIsoToBr(request.created_at));
  setForgottenDetailValue(
    "forgottenDetailConfirmed",
    request.confirmed_by_employee ? "Sim" : "Nao",
  );
  setForgottenDetailValue("forgottenDetailReason", request.reason || "-");
  setForgottenDetailValue("forgottenDetailWorkplace", request.workplace || "-");
  setForgottenDetailValue("forgottenDetailNotes", request.notes || "-");
  setForgottenDetailValue(
    "forgottenDetailReview",
    request.review_note
      ? `${request.review_note}${request.reviewed_by_name ? ` | por ${request.reviewed_by_name}` : ""}${request.reviewed_at ? ` em ${fmtIsoToBr(request.reviewed_at)}` : ""}`
      : "Sem analise registrada",
  );

  if (signatureImage && request.signature_data_url) {
    signatureImage.src = request.signature_data_url;
    signatureImage.hidden = false;
    if (signatureFallback) signatureFallback.hidden = true;
  } else {
    if (signatureImage) {
      signatureImage.hidden = true;
      signatureImage.removeAttribute("src");
    }
    if (signatureFallback) signatureFallback.hidden = false;
  }

  if (qs("forgottenReviewNotes")) {
    qs("forgottenReviewNotes").value = request.review_note || "";
  }

  const canReview = request.status === "PENDING";
  if (qs("btnApproveForgotten")) qs("btnApproveForgotten").disabled = !canReview;
  if (qs("btnRejectForgotten")) qs("btnRejectForgotten").disabled = !canReview;

  const pdfButton = qs("btnDownloadForgottenPdf");
  if (pdfButton) {
    const pdfUrl = request.approval_pdf_available ? request.approval_pdf_url : "";
    if (pdfUrl) {
      pdfButton.hidden = false;
      pdfButton.disabled = false;
      pdfButton.dataset.url = pdfUrl;
    } else {
      pdfButton.hidden = true;
      pdfButton.disabled = true;
      delete pdfButton.dataset.url;
    }
  }
}

function getDownloadFilenameFromDisposition(contentDisposition, fallbackName) {
  if (!contentDisposition) return fallbackName;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const simpleMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (simpleMatch && simpleMatch[1]) {
    return simpleMatch[1];
  }

  return fallbackName;
}

async function downloadForgottenApprovalPdf() {
  const pdfButton = qs("btnDownloadForgottenPdf");
  const detailOut = qs("forgottenDetailOut");
  const pdfPath = pdfButton?.dataset?.url;

  if (!pdfPath || !selectedForgottenRequestId) {
    toastError("PDF ainda não disponível para esta solicitação");
    return;
  }

  const token = loadToken();
  if (!token) {
    toastError("Faça login novamente para baixar o PDF");
    return;
  }

  pdfButton.disabled = true;
  setOut(detailOut, "Baixando PDF...");

  try {
    const response = await fetch(`${getApiBase()}${pdfPath}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      let message = "Erro ao baixar PDF";

      if (contentType.includes("application/json")) {
        const data = await response.json();
        message = data.error || data.message || message;
      } else {
        const text = (await response.text()).trim();
        if (text) message = text;
      }

      throw new Error(`${response.status} - ${message}`);
    }

    const fileName = getDownloadFilenameFromDisposition(
      response.headers.get("content-disposition"),
      `solicitacao-esquecimento-${selectedForgottenRequestId}.pdf`,
    );
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    setOut(detailOut, "");
    toastSuccess("PDF baixado com sucesso.");
  } catch (err) {
    setOut(detailOut, err.message);
    toastError(`Erro ao baixar PDF: ${err.message}`);
  } finally {
    if (pdfButton.dataset.url) {
      pdfButton.disabled = false;
    }
  }
}

function buildForgottenRequestsQuery() {
  const params = new URLSearchParams();

  const status = qs("forgottenStatusFilter").value;
  const collaborator = qs("forgottenCollaboratorFilter").value.trim();
  const forgottenDateFrom = qs("forgottenDateFrom").value;
  const forgottenDateTo = qs("forgottenDateTo").value;
  const createdFrom = qs("forgottenCreatedFrom").value;
  const createdTo = qs("forgottenCreatedTo").value;

  if (status) params.set("status", status);
  if (collaborator) params.set("collaborator", collaborator);
  if (forgottenDateFrom) params.set("forgotten_date_from", forgottenDateFrom);
  if (forgottenDateTo) params.set("forgotten_date_to", forgottenDateTo);
  if (createdFrom) params.set("created_from", new Date(`${createdFrom}T00:00:00`).toISOString());
  if (createdTo) params.set("created_to", new Date(`${createdTo}T23:59:59`).toISOString());

  const query = params.toString();
  return query ? `?${query}` : "";
}

function renderForgottenRequestsTable(rows) {
  const tbody = qs("forgottenTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (const request of rows) {
    const tr = document.createElement("tr");
    const collaboratorLabel = request.user_name
      ? `${request.user_name} [${request.user_id}]`
      : request.employee_name || String(request.user_id);

    tr.innerHTML = `
      <td>${request.id}</td>
      <td>${escapeHtml(collaboratorLabel)}</td>
      <td>${fmtDateOnlyToBr(request.forgotten_date)}</td>
      <td>${fmtTimeValue(request.entry_time)}</td>
      <td>${fmtTimeValue(request.exit_time)}</td>
      <td>${escapeHtml(request.reason || "-")}</td>
      <td>${statusLabel(request.status)}</td>
      <td>${fmtIsoToBr(request.created_at)}</td>
      <td><button data-open-forgotten="${request.id}" class="secondary">Detalhar</button></td>
    `;
    tbody.appendChild(tr);
  }

  qs("forgottenInfo").textContent = `Total: ${rows.length}`;
}

async function loadForgottenRequestDetail(id) {
  const detailOut = qs("forgottenDetailOut");
  setOut(detailOut, "Carregando detalhe...");

  try {
    const data = await apiFetch(`/admin/forgotten-requests/${encodeURIComponent(id)}`, {
      method: "GET",
    });
    renderForgottenDetail(data.request);
    setOut(detailOut, "");
  } catch (err) {
    clearForgottenDetail();
    setOut(detailOut, err.message);
    toastError(`Erro ao carregar solicitacao: ${err.message}`);
  }
}

async function loadForgottenRequests({ preserveSelection = true } = {}) {
  const out = qs("forgottenOut");
  setOut(out, "Buscando solicitacoes...");

  try {
    const data = await apiFetch(`/admin/forgotten-requests${buildForgottenRequestsQuery()}`, {
      method: "GET",
    });
    forgottenRequestsCache = data.requests || [];
    renderForgottenRequestsTable(forgottenRequestsCache);
    setOut(out, `${forgottenRequestsCache.length} solicitacao(oes) exibida(s).`);

    if (!forgottenRequestsCache.length) {
      clearForgottenDetail();
      return;
    }

    const nextId = preserveSelection && selectedForgottenRequestId
      ? selectedForgottenRequestId
      : forgottenRequestsCache[0].id;
    const exists = forgottenRequestsCache.some((request) => request.id === nextId);
    await loadForgottenRequestDetail(exists ? nextId : forgottenRequestsCache[0].id);
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao listar solicitacoes: ${err.message}`);
  }
}

async function reviewForgottenRequest(status) {
  if (!selectedForgottenRequestId) {
    toastError("Selecione uma solicitacao antes de analisar");
    return;
  }

  const detailOut = qs("forgottenDetailOut");
  const reviewNotes = qs("forgottenReviewNotes").value.trim();
  setOut(detailOut, status === "APPROVED" ? "Aprovando..." : "Rejeitando...");

  try {
    const data = await apiFetch(
      `/admin/forgotten-requests/${encodeURIComponent(selectedForgottenRequestId)}/review`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          review_notes: reviewNotes,
        }),
      },
    );

    renderForgottenDetail(data.request);
    setOut(detailOut, data.message || "Analise registrada com sucesso.");
    await loadForgottenRequests();
    toastSuccess(data.message || "Analise registrada com sucesso");
  } catch (err) {
    setOut(detailOut, err.message);
    toastError(`Erro ao analisar solicitacao: ${err.message}`);
  }
}

let currentViewId = "view-ponto";
let journeyRefreshInFlight = false;
let isAdminSession = false;

function getCurrentRoutePath() {
  const raw = (window.location.hash || "").replace(/^#/, "").trim();
  return raw || "/ponto";
}

function navigateToRoute(routePath, { replace = false } = {}) {
  const nextHash = `#${routePath}`;
  if (window.location.hash === nextHash) return;
  if (replace) {
    window.history.replaceState(null, "", nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

async function refreshJourneyStatus() {
  if (journeyRefreshInFlight) return;
  journeyRefreshInFlight = true;

  const statusEl = qs("journeyStatus");
  const btn = qs("btnClock");

  const token = loadToken();
  if (!token) {
    statusEl.textContent = "Escala: Faça login";
    setJourneyMeta("Entre no sistema para consultar o status atual.");
    setClockActionHint("Faça login para registrar presença ou ausência.");
    btn.disabled = true;
    btn.textContent = "Faça login";
    journeyRefreshInFlight = false;
    return;
  }

  statusEl.textContent = "Escala: consultando...";
  setJourneyMeta("Atualizando dados da escala...");
  setClockActionHint("Aguarde a atualização antes de registrar uma nova ação.");
  btn.disabled = true;
  btn.textContent = "Carregando...";

  try {
    const data = await apiFetch("/time/status", { method: "GET" });
    const inJourney = !!data.in_journey;
    const lastRecord = data.last?.occurred_at
      ? `Último registro em ${fmtIsoToBr(data.last.occurred_at)}`
      : "Nenhum registro encontrado hoje.";

    statusEl.textContent = inJourney
      ? "Escala: Presente"
      : "Escala: Ausente";
    setJourneyMeta(lastRecord);
    setClockActionHint(
      inJourney
        ? "Registre ausência ao finalizar a escala."
        : "Registre presença ao iniciar a escala.",
    );
    btn.textContent = inJourney ? "Marcar ausência" : "Marcar presença";
    btn.disabled = false;
  } catch (err) {
    statusEl.textContent = "Escala: indisponível";
    setJourneyMeta("Não foi possível consultar a última situação da escala.");
    setClockActionHint("Revise sua conexão e tente novamente.");
    btn.textContent = "Erro";
    btn.disabled = true;
    setOut(qs("clockOut"), err.message);
  } finally {
    journeyRefreshInFlight = false;
  }
}

async function ensureLoggedForEntries() {
  if (!loadToken()) {
    setOut(qs("entriesOut"), "FaÃ§a login para consultar registros.");
    return false;
  }
  return true;
}

function clearAlertsTable() {
  qs("alertsTable").querySelector("tbody").innerHTML = "";
  qs("alertsInfo").textContent = "-";
  setOut(qs("alertsOut"), "");
}

function buildAlertsQuery() {
  const status = qs("alertStatus").value;
  const userId = qs("alertUserId").value.trim();
  const severity = qs("alertSeverity").value;
  const limit = qs("alertLimit").value.trim() || "20";
  const offset = qs("alertOffset").value.trim() || "0";

  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (userId) p.set("user_id", userId);
  if (severity) p.set("severity", severity);
  p.set("limit", limit);
  p.set("offset", offset);

  return `?${p.toString()}`;
}

function renderAlerts(alerts) {
  const tbody = qs("alertsTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (const a of alerts) {
    const tr = document.createElement("tr");

    const userCol = a.user_name
      ? `${a.user_name} (${a.user_cpf}) [${a.user_id}]`
      : String(a.user_id);

    const created = fmtIsoToBr(a.created_at);
    const resolved = a.resolved_at ? fmtIsoToBr(a.resolved_at) : "-";

    tr.innerHTML = `
      <td>${a.id}</td>
      <td>${a.type}</td>
      <td>${a.severity}</td>
      <td>${userCol}</td>
      <td>${a.time_in_entry_id ?? "-"}</td>
      <td>${created}</td>
      <td>${(a.note || "-").toString()}</td>
      <td>${resolved}</td>
      <td>
        ${a.resolved_at ? "-" : `<button data-resolve="${a.id}">Resolver</button>`}
      </td>
    `;

    tbody.appendChild(tr);
  }
}

async function loadAlerts() {
  const out = qs("alertsOut");
  setOut(out, "Buscando...");

  if (!loadToken()) {
    setOut(out, "FaÃ§a login como ADMIN.");
    return;
  }

  try {
    const q = buildAlertsQuery();
    const data = await apiFetch(`/admin/alerts${q}`, { method: "GET" });

    renderAlerts(data.alerts || []);
    qs("alertsInfo").textContent =
      `Total: ${data.total} | Mostrando: ${(data.alerts || []).length}`;

    setOut(out, `${(data.alerts || []).length} alerta(s) exibido(s).`);
  } catch (err) {
    setOut(out, err.message);
  }
}

function setActiveView(viewId, { syncRoute = true } = {}) {
  const isAdminView =
    viewId === "view-consultas" || String(viewId).startsWith("view-admin");
  const tokenRole = decodeJwtPayload(loadToken() || "")?.role;
  const hasAdminAccess = isAdminSession || tokenRole === "ADMIN";

  if (isAdminView && !hasAdminAccess) {
    const fallbackViewId = "view-ponto";
    if (syncRoute && typeof window.viewIdToRoute === "function") {
      navigateToRoute(window.viewIdToRoute(fallbackViewId), { replace: true });
    }
    viewId = fallbackViewId;
  }

  currentViewId = viewId;

  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");

  document
    .querySelectorAll(".navItem")
    .forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.navItem[data-view="${viewId}"]`);
  if (btn) btn.classList.add("active");

  const titles = {
    "view-ponto": [
      "Controle de Escala",
      "Registro de presença e ausência com geolocalização",
    ],
    "view-consultas": ["Consultas", "Registros administrativos"],
    "view-admin-occurrences": [
      "Ocorrências",
      "Registro e acompanhamento das coberturas",
    ],
    "view-admin-forgotten": [
      "Esquecimento de Batida",
      "Fila de análise administrativa com assinatura",
    ],
    "view-admin-users": [
      "Usuários",
      "Cadastro e gestão de acesso",
    ],
    "view-admin-cadastros": [
      "Cadastros",
      "Locais e tipos de ocorrência",
    ],
    "view-admin-alerts": ["Alertas", "Fila auditável e resolução"],
  };

  const [t, s] = titles[viewId] || ["Sistema", ""];
  qs("topTitle").textContent = t;
  qs("topSub").textContent = s;

  if (syncRoute && typeof window.viewIdToRoute === "function") {
    navigateToRoute(window.viewIdToRoute(viewId), { replace: true });
  }

  if (viewId === "view-ponto") {
    refreshJourneyStatus();
  }

  if (
    (
      viewId === "view-admin-occurrences" ||
      viewId === "view-admin-cadastros"
    ) &&
    loadToken()
  ) {
    loadOccurrenceMetadata({ silent: true }).catch(() => {});
  }

  if (viewId === "view-admin-occurrences" && loadToken()) {
    listServiceOrders().catch(() => {});
  }

  if (viewId === "view-admin-forgotten" && loadToken()) {
    loadForgottenRequests().catch(() => {});
  }

  if (viewId === "view-admin-users" && loadToken()) {
    loadUsersTable().catch(() => {});
  }
}

const appRoot = document.querySelector(".app");
const navBackdrop = qs("navBackdrop");
const btnMenu = qs("btnMenu");

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function closeNavMenu() {
  if (appRoot) appRoot.classList.remove("navOpen");
}

if (btnMenu) {
  btnMenu.addEventListener("click", () => {
    if (!appRoot || !isMobileLayout()) return;
    appRoot.classList.toggle("navOpen");
  });
}

if (navBackdrop) {
  navBackdrop.addEventListener("click", closeNavMenu);
}

window.addEventListener("resize", () => {
  if (!isMobileLayout()) closeNavMenu();
});

document.querySelectorAll(".navItem").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

window.addEventListener("hashchange", () => {
  if (typeof window.routeToViewId !== "function") return;
  const routePath = getCurrentRoutePath();
  const viewId = window.routeToViewId(routePath);
  setActiveView(viewId, { syncRoute: false });
});

async function refreshRoleUILegacy() {
  const pill = qs("pillAuth");
  const token = loadToken();

  if (!token) {
    pill.textContent = "Deslogado";
    isAdminSession = false;
    clearForgottenDetail();
    setConsultationAdminVisibility(false);
    setAdminOnlyNavigationVisibility(false);
    document
      .querySelectorAll('.navItem[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = true));
    return;
  }

  try {
    const me = await apiFetch("/me", { method: "GET" });
    const role = me.user.role;
    pill.textContent = `${me.user.id}`;

    const isAdmin = role === "ADMIN";
    isAdminSession = isAdmin;
    setConsultationAdminVisibility(isAdmin);
    setAdminOnlyNavigationVisibility(isAdmin);
    document
      .querySelectorAll('[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = !isAdmin));
  } catch {
    pill.textContent = "SessÃ£o invÃ¡lida";
    isAdminSession = false;
    setConsultationAdminVisibility(false);
    setAdminOnlyNavigationVisibility(false);
    document
      .querySelectorAll('[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = true));
  }
}
function toIsoFromDatetimeLocal(val) {
  if (!val) return "";
  return new Date(val).toISOString();
}

function populateSelect(selectId, rows, placeholder, labelBuilder) {
  const select = qs(selectId);
  if (!select) return;

  select.innerHTML = `<option value="">${placeholder}</option>`;
  for (const row of rows) {
    const option = document.createElement("option");
    option.value = String(row.id);
    option.textContent = labelBuilder(row);
    select.appendChild(option);
  }
}

function renderOccurrenceMetadata(metadata) {
  const locations = metadata.locations || [];
  const occurrenceTypes = metadata.occurrence_types || [];
  const users = metadata.users || [];

  populateSelect(
    "occurrenceLocationSelect",
    locations,
    "Selecione um local",
    (location) => location.name,
  );
  populateSelect(
    "occurrenceTypeSelect",
    occurrenceTypes,
    "Selecione um tipo",
    (occurrenceType) => occurrenceType.name,
  );
  populateSelect(
    "replacedUserSelect",
    users,
    "Selecione um funcionario",
    (user) => `${user.name} [${user.id}]`,
  );
  populateSelect(
    "coverUserSelect",
    users,
    "Selecione um funcionario",
    (user) => `${user.name} [${user.id}]`,
  );

  const info = qs("occurrenceMetaInfo");
  if (info) {
    info.textContent =
      `Locais: ${locations.length} | Tipos: ${occurrenceTypes.length} | Funcionarios: ${users.length}`;
  }
}

async function loadOccurrenceMetadata({ silent = false } = {}) {
  try {
    const data = await apiFetch("/admin/service-orders/metadata", { method: "GET" });
    renderOccurrenceMetadata(data);
    return data;
  } catch (err) {
    if (!silent) {
      setOut(getOccurrenceAdminOut(), err.message);
      toastError(`Erro ao carregar listas: ${err.message}`);
    }
    throw err;
  }
}

function renderServiceOrdersTable(rows) {
  const tbody = qs("soTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (const so of rows) {
    const replacedUserLabel = so.replaced_user_name
      ? `${so.replaced_user_name} [${so.replaced_user_id}]`
      : so.replaced_user_id || "-";
    const coverUserLabel = so.cover_user_name
      ? `${so.cover_user_name} [${so.cover_user_id}]`
      : so.cover_user_id || "-";
    const locationLabel = so.location_name || so.location_text || "-";
    const renderedLocation =
      locationLabel === "-"
        ? "-"
        : renderMapLink(buildMapsSearchUrl(locationLabel), locationLabel);

    const tr = document.createElement("tr");
    tr.innerHTML = `
    <td>${so.id}</td>
    <td>${renderedLocation}</td>
    <td>${so.occurrence_type_name || "-"}</td>
    <td>${replacedUserLabel}</td>
    <td>${coverUserLabel}</td>
    <td>${so.status}</td>
    <td>${fmtIsoToBr(so.expected_start)}</td>
    <td>${so.expected_duration_hours}h</td>
    <td>${so.created_by_name || so.created_by}</td>
    <td>
      ${so.status === "OPEN" ? `<button data-close-so="${so.id}">Encerrar</button>` : "-"}
    </td>
  `;
    tbody.appendChild(tr);
  }
}

async function listServiceOrders() {
  const out = qs("soAdminOut");
  setOut(out, "Buscando ocorrencias...");

  try {
    const data = await apiFetch("/admin/service-orders", { method: "GET" });
    const rows = data.service_orders || [];

    renderServiceOrdersTable(rows);
    setOut(out, `OK - ${rows.length} ocorrencias`);
    toastInfo(`${rows.length} ocorrencias carregadas`);
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao listar ocorrencias: ${err.message}`);
  }
}

qs("soTable").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-close-so]");
  if (!btn) return;

  const soId = btn.getAttribute("data-close-so");
  if (!confirm(`Encerrar ocorrencia #${soId}?`)) return;

  try {
    await apiFetch(`/admin/service-orders/${encodeURIComponent(soId)}/close`, {
      method: "PATCH",
    });

    setOut(qs("soAdminOut"), `Ocorrencia #${soId} encerrada.`);
    await listServiceOrders();
    toastSuccess(`Ocorrencia #${soId} encerrada`);
  } catch (err) {
    setOut(qs("soAdminOut"), err.message);
    toastError(`Erro ao encerrar ocorrencia: ${err.message}`);
  }
});

qs("btnCreateLocation").addEventListener("click", async () => {
  const out = getOccurrenceAdminOut();
  const name = qs("newLocationName").value.trim();

  if (!name || name.length < 2) {
    setOut(out, "Informe um local valido.");
    toastError("Informe um local valido");
    return;
  }

  setOut(out, "Cadastrando local...");

  try {
    await apiFetch("/admin/service-orders/locations", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    qs("newLocationName").value = "";
    await loadOccurrenceMetadata({ silent: true });
    setOut(out, `Local "${name}" cadastrado com sucesso.`);
    toastSuccess("Local cadastrado com sucesso");
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao cadastrar local: ${err.message}`);
  }
});

qs("btnCreateOccurrenceType").addEventListener("click", async () => {
  const out = getOccurrenceAdminOut();
  const name = qs("newOccurrenceTypeName").value.trim();

  if (!name || name.length < 2) {
    setOut(out, "Informe um tipo de ocorrencia valido.");
    toastError("Informe um tipo de ocorrencia valido");
    return;
  }

  setOut(out, "Cadastrando tipo de ocorrencia...");

  try {
    await apiFetch("/admin/service-orders/occurrence-types", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    qs("newOccurrenceTypeName").value = "";
    await loadOccurrenceMetadata({ silent: true });
    setOut(out, `Tipo de ocorrencia "${name}" cadastrado com sucesso.`);
    toastSuccess("Tipo de ocorrencia cadastrado com sucesso");
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao cadastrar tipo de ocorrencia: ${err.message}`);
  }
});

qs("btnCreateSO").addEventListener("click", async () => {
  const out = qs("soAdminOut");
  setOut(out, "Registrando ocorrencia...");

  try {
    const location_id = Number(qs("occurrenceLocationSelect").value);
    const occurrence_type_id = Number(qs("occurrenceTypeSelect").value);
    const replaced_user_id = Number(qs("replacedUserSelect").value);
    const cover_user_id = Number(qs("coverUserSelect").value);
    const expectedStartLocal = qs("soExpectedStart").value;
    const expected_duration_hours = Number(qs("soDurationHours").value);

    if (!Number.isFinite(location_id) || location_id <= 0) {
      setOut(out, "Selecione um local.");
      toastError("Selecione um local");
      return;
    }
    if (!Number.isFinite(occurrence_type_id) || occurrence_type_id <= 0) {
      setOut(out, "Selecione um tipo de ocorrencia.");
      toastError("Selecione um tipo de ocorrencia");
      return;
    }
    if (!Number.isFinite(replaced_user_id) || replaced_user_id <= 0) {
      setOut(out, "Selecione o funcionario substituido.");
      toastError("Selecione o funcionario substituido");
      return;
    }
    if (!Number.isFinite(cover_user_id) || cover_user_id <= 0) {
      setOut(out, "Selecione o funcionario de cobertura.");
      toastError("Selecione o funcionario de cobertura");
      return;
    }
    if (replaced_user_id === cover_user_id) {
      setOut(out, "Os funcionarios de substituicao e cobertura devem ser diferentes.");
      toastError("Os funcionarios devem ser diferentes");
      return;
    }
    if (!expectedStartLocal) {
      setOut(out, "Informe o inicio previsto.");
      toastError("Informe o inicio previsto");
      return;
    }
    if (
      !Number.isFinite(expected_duration_hours) ||
      expected_duration_hours <= 0
    ) {
      setOut(out, "Duracao invalida.");
      toastError("Duracao invalida");
      return;
    }

    const payload = {
      location_id,
      occurrence_type_id,
      replaced_user_id,
      cover_user_id,
      expected_start: toIsoFromDatetimeLocal(expectedStartLocal),
      expected_duration_hours,
    };

    const data = await apiFetch("/admin/service-orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setOut(out, `Ocorrencia criada (#${data.service_order?.id ?? "?"})`);

    await listServiceOrders();
    toastSuccess(`Ocorrencia #${data.service_order?.id ?? "?"} criada`);
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao registrar ocorrencia: ${err.message}`);
  }
});

qs("btnListSO").addEventListener("click", listServiceOrders);
qs("btnRefreshOccurrenceMeta").addEventListener("click", async () => {
  try {
    await loadOccurrenceMetadata();
    toastSuccess("Listas atualizadas");
  } catch {}
});

const btnHealth = qs("btnHealth");
if (btnHealth) {
  btnHealth.addEventListener("click", async () => {
    const out = qs("healthOut");
    setOut(out, "Consultando...");
    try {
      const data = await apiFetch("/health", { method: "GET" });
      setOut(out, data);
      toastSuccess("API online");
    } catch (err) {
      setOut(out, err.message);
      toastError(`Falha no /health: ${err.message}`);
    }
  });
}

qs("btnLogin").addEventListener("click", async () => {
  const out = qs("loginOut");
  setOut(out, "Autenticando...");

  const cpf = qs("loginCpf").value.trim();
  const password = qs("loginPassword").value;

  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ cpf, password }),
    });

    saveToken(data.token);
    updateAuthUI();
    applyAuthGate();
    await refreshRoleUI();
    if (currentViewId === "view-ponto") {
      await refreshJourneyStatus();
    }
    if (
      currentViewId === "view-admin-occurrences" ||
      currentViewId === "view-admin-cadastros"
    ) {
      await loadOccurrenceMetadata({ silent: true });
    }
    if (currentViewId === "view-admin-occurrences") {
      await listServiceOrders();
    }
    if (currentViewId === "view-admin-forgotten") {
      await loadForgottenRequests();
    }
    if (currentViewId === "view-admin-users") {
      await loadUsersTable();
    }
    setOut(out, "Login realizado com sucesso.");
    toastSuccess("Login realizado com sucesso");
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro no login: ${err.message}`);
  }
});

["btnLogout", "btnTopLogout"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;

  el.addEventListener("click", () => {
    clearToken();
    updateAuthUI();
    applyAuthGate();
    if (currentViewId === "view-ponto") {
      refreshJourneyStatus();
    }
    clearForgottenDetail();
    setActiveView("view-ponto");
    navigateToRoute("/ponto", { replace: true });
    refreshRoleUI();
    toastInfo("Sessao encerrada");
  });
});

qs("btnCreateUser").addEventListener("click", async () => {
  const out = qs("adminOut");
  setOut(out, "Enviando...");

  const name = qs("newName").value.trim();
  const cpf = qs("newCpf").value.trim();
  const password = qs("newPassword").value;
  const role = qs("newRole").value;

  try {
    const data = await apiFetch("/admin/users", {
      method: "POST",
      body: JSON.stringify({ name, cpf, password, role }),
    });

    setOut(out, `Usuário #${data.id} cadastrado com sucesso.`);
    toastSuccess("Usuario cadastrado com sucesso");
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao cadastrar usuario: ${err.message}`);
  }
});

qs("btnGetGeo").addEventListener("click", async () => {
  const out = qs("geoOut");
  out.textContent = "LocalizaÃ§Ã£o: capturando...";
  try {
    const geo = await getGeo();
    renderGeoOut(geo);
  } catch (err) {
    out.textContent = `LocalizaÃ§Ã£o: ${err.message}`;
  }
});
qs("btnClock").addEventListener("click", async () => {
  const out = qs("clockOut");
  setOut(out, "Processando...");

  try {
    let geo = { latitude: null, longitude: null };

    try {
      const g = await getGeo();
      geo = { latitude: g.latitude, longitude: g.longitude };
      renderGeoOut(g);
    } catch (geoErr) {
      qs("geoOut").textContent = `Localização: ${geoErr.message}`;
    }

    const statusData = await apiFetch("/time/status", { method: "GET" });
    const type = statusData.in_journey ? "OUT" : "IN";

    const payload = {
      type,
      occurred_at: nowISO(),
      latitude: geo.latitude,
      longitude: geo.longitude,
    };

    const data = await apiFetch("/time/clock", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setOut(
      out,
      type === "IN"
        ? "Presença registrada com sucesso."
        : "Ausência registrada com sucesso.",
    );
    await refreshJourneyStatus();
    toastSuccess(
      type === "IN"
        ? "Escala marcada como presente"
        : "Escala marcada como ausente",
    );
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao atualizar escala: ${err.message}`);
  }
});

qs("btnRefreshStatus").addEventListener("click", refreshJourneyStatus);

qs("btnEntriesByUser").addEventListener("click", async () => {
  if (!(await ensureLoggedForEntries())) return;

  const userId = qs("filterUserId").value.trim();
  if (!userId) {
    setOut(qs("entriesOut"), "Informe um user_id.");
    return;
  }

  setOut(qs("entriesOut"), "Buscando...");

  try {
    const base = new URLSearchParams();
    base.set("user_id", userId);

    const fromVal = qs("fromDate").value;
    const toVal = qs("toDate").value;
    if (fromVal) base.set("from", new Date(fromVal).toISOString());
    if (toVal) base.set("to", new Date(toVal).toISOString());

    const data = await apiFetch(`/entries?${base.toString()}`, {
      method: "GET",
    });

    renderEntries(data.entries || []);
    setOut(qs("entriesOut"), `${(data.entries || []).length} registro(s) encontrado(s).`);
  } catch (err) {
    setOut(qs("entriesOut"), err.message);
    toastError(`${err.message}`);
  }
});

qs("btnAllEntries").addEventListener("click", async () => {
  if (!(await ensureLoggedForEntries())) return;

  setOut(qs("entriesOut"), "Buscando...");
  try {
    const q = buildPeriodQuery();
    const data = await apiFetch(`/entries/all${q}`, { method: "GET" });
    renderEntries(data.entries || []);
    setOut(qs("entriesOut"), `${(data.entries || []).length} registro(s) encontrado(s).`);
  } catch (err) {
    setOut(qs("entriesOut"), err.message);
    toastError(`${err.message}`);
  }
});

qs("btnToggleActive").addEventListener("click", async () => {
  const out = qs("toggleOut");
  setOut(out, "Enviando...");

  const userId = qs("toggleUserId").value.trim();
  if (!userId) {
    setOut(out, "Informe um ID de usuÃ¡rio.");
    toastError("Informe um ID de usuario");
    return;
  }

  const is_active = qs("toggleActive").value === "true";

  try {
    const data = await apiFetch(
      `/admin/users/${encodeURIComponent(userId)}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ is_active }),
      },
    );

    setOut(
      out,
      is_active
        ? `Usuário #${userId} ativado com sucesso.`
        : `Usuário #${userId} desativado com sucesso.`,
    );
    toastSuccess(is_active ? "Usuario ativado" : "Usuario desativado");
    await loadUsersTable();
  } catch (err) {
    setOut(out, err.message);
    toastError(`Erro ao alterar usuario: ${err.message}`);
  }
});

qs("btnListUsers").addEventListener("click", async () => {
  try {
    const total = await loadUsersTable();
    toastInfo(`${total} usuarios carregados`);
  } catch (err) {
    toastError(`Erro ao listar usuarios: ${err.message}`);
  }
});

qs("btnLoadAlerts").addEventListener("click", loadAlerts);
qs("btnClearAlerts").addEventListener("click", clearAlertsTable);

qs("btnLoadForgottenRequests").addEventListener("click", () => {
  loadForgottenRequests({ preserveSelection: false });
});

qs("btnClearForgottenFilters").addEventListener("click", () => {
  [
    "forgottenStatusFilter",
    "forgottenCollaboratorFilter",
    "forgottenDateFrom",
    "forgottenDateTo",
    "forgottenCreatedFrom",
    "forgottenCreatedTo",
  ].forEach((id) => {
    const el = qs(id);
    if (el) el.value = "";
  });

  loadForgottenRequests({ preserveSelection: false }).catch(() => {});
});

qs("forgottenTable").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-open-forgotten]");
  if (!btn) return;

  const requestId = btn.getAttribute("data-open-forgotten");
  await loadForgottenRequestDetail(requestId);
});

qs("btnApproveForgotten").addEventListener("click", async () => {
  await reviewForgottenRequest("APPROVED");
});

qs("btnRejectForgotten").addEventListener("click", async () => {
  await reviewForgottenRequest("REJECTED");
});

qs("btnDownloadForgottenPdf").addEventListener("click", async () => {
  await downloadForgottenApprovalPdf();
});

qs("alertsTable").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-resolve]");
  if (!btn) return;

  const alertId = btn.getAttribute("data-resolve");
  const note = prompt("Descreva a resoluÃ§Ã£o (obrigatÃ³rio):");
  if (!note || note.trim().length < 3) {
    toastError("Resolucao deve ter ao menos 3 caracteres");
    return;
  }

  try {
    const data = await apiFetch(
      `/admin/alerts/${encodeURIComponent(alertId)}/resolve`,
      {
        method: "PATCH",
        body: JSON.stringify({ resolution_note: note.trim() }),
      },
    );

    setOut(qs("alertsOut"), `Alerta #${alertId} resolvido com sucesso.`);
    await loadAlerts();
    toastSuccess(`Alerta #${alertId} resolvido`);
  } catch (err) {
    setOut(qs("alertsOut"), err.message);
    toastError(`Erro ao resolver alerta: ${err.message}`);
  }
});

// Mantem estado de login mesmo quando /me falhar.
async function refreshRoleUI() {
  const pill = qs("pillAuth");
  const token = loadToken();

  if (!token) {
    pill.textContent = "Deslogado";
    isAdminSession = false;
    setConsultationAdminVisibility(false);
    setAdminOnlyNavigationVisibility(false);
    document
      .querySelectorAll('[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = true));
    return;
  }

  try {
    const me = await apiFetch("/me", { method: "GET" });
    const role = me.user.role;
    pill.textContent = `${me.user.id}`;

    const isAdmin = role === "ADMIN";
    isAdminSession = isAdmin;
    setConsultationAdminVisibility(isAdmin);
    setAdminOnlyNavigationVisibility(isAdmin);
    document
      .querySelectorAll('[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = !isAdmin));
  } catch {
    pill.textContent = "Sessão inválida";
    isAdminSession = false;
    clearForgottenDetail();
    setConsultationAdminVisibility(false);
    setAdminOnlyNavigationVisibility(false);
    document
      .querySelectorAll('[data-view^="view-admin"]')
      .forEach((b) => (b.disabled = true));
  }
}

qs("btnClearEntries").addEventListener("click", clearEntriesTable);

clearForgottenDetail();
updateAuthUI();
applyAuthGate();
if (typeof window.routeToViewId === "function") {
  const routePath = getCurrentRoutePath();
  const viewId = window.routeToViewId(routePath);
  setActiveView(viewId, { syncRoute: false });
  navigateToRoute(window.viewIdToRoute(viewId), { replace: true });
} else {
  setActiveView("view-ponto");
}
refreshRoleUI();
startClock();
