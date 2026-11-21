// app.js — colle l'UI, l'éditeur CodeMirror, le module GitHub et l'assistant IA.
// Toute la persistance se fait en localStorage : rien ne quitte le téléphone
// sauf les appels directs vers l'API GitHub et vers le fournisseur IA choisi.

const LS = {
  ghToken: "mcs_gh_token",
  aiProvider: "mcs_ai_provider",
  aiKey: "mcs_ai_key",
  aiModel: "mcs_ai_model",
  aiBaseUrl: "mcs_ai_baseurl",
  fontSize: "mcs_font_size",
  lastRepo: "mcs_last_repo",
  googleClientId: "mcs_google_client_id",
  gasProjects: "mcs_gas_projects",
  lastGas: "mcs_gas_last",
};

const state = {
  gh: null, // instance GitHubClient
  repos: [],
  currentRepo: null, // { owner, name, branch }
  currentFile: null, // { source: "github", path, sha } ou { source: "gas", path, scriptId, gasName, gasType }
  cm: null, // instance CodeMirror
  gasAuth: null, // instance GoogleAuth
  gasClient: null, // instance AppsScriptClient
  gasProject: null, // { id, name }
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Hauteur réelle de la fenêtre visible (gère le clavier virtuel sur mobile)
// ---------------------------------------------------------------------------

function setAppHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", h + "px");
}
window.addEventListener("resize", setAppHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setAppHeight);
}
setAppHeight();

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;
function showToast(message, type = "info", duration = 3200) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast" + (type !== "info" ? " " + type : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

// ---------------------------------------------------------------------------
// Panneaux (tiroir fichiers, feuille IA, feuille réglages) + overlay commun
// ---------------------------------------------------------------------------

function openPanel(el) {
  document.getElementById("app").classList.add("panel-open");
  el.classList.add("open");
}
function closePanel(el) {
  el.classList.remove("open");
  const anyOpen = document.querySelectorAll(".drawer.open, .sheet.open").length > 0;
  if (!anyOpen) document.getElementById("app").classList.remove("panel-open");
}
function closeAllPanels() {
  document.querySelectorAll(".drawer.open, .sheet.open").forEach(closePanel);
}

$("overlay").addEventListener("click", closeAllPanels);

$("btn-files").addEventListener("click", () => openPanel($("files-drawer")));
$("btn-close-files").addEventListener("click", () => closePanel($("files-drawer")));

$("btn-ai").addEventListener("click", () => {
  if (!state.currentFile) {
    $("ai-use-context").checked = false;
    $("ai-use-context").disabled = true;
  } else {
    $("ai-use-context").disabled = false;
  }
  openPanel($("ai-panel"));
});
$("btn-close-ai").addEventListener("click", () => closePanel($("ai-panel")));

$("btn-settings").addEventListener("click", () => {
  loadSettingsIntoForm();
  openPanel($("settings-panel"));
});
$("btn-close-settings").addEventListener("click", () => closePanel($("settings-panel")));

// ---------------------------------------------------------------------------
// Éditeur CodeMirror
// ---------------------------------------------------------------------------

function initEditor() {
  state.cm = CodeMirror.fromTextArea($("code-area"), {
    lineNumbers: true,
    lineWrapping: true,
    theme: "dracula",
    tabSize: 2,
    indentUnit: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    mode: null,
  });

  const field = state.cm.getInputField();
  field.setAttribute("autocorrect", "off");
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("spellcheck", "false");

  const savedFont = parseInt(localStorage.getItem(LS.fontSize) || "16", 10);
  setEditorFontSize(savedFont);
}

function setEditorFontSize(px) {
  let styleEl = document.getElementById("cm-font-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "cm-font-style";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `.CodeMirror { font-size: ${px}px; }`;
  if (state.cm) state.cm.refresh();
}

function modeForPath(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "js":
    case "gs":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return { name: "javascript", json: true };
    case "html":
    case "htm":
      return "htmlmixed";
    case "css":
      return "css";
    case "py":
      return "python";
    case "xml":
      return "xml";
    case "java":
      return "text/x-java";
    case "c":
    case "h":
      return "text/x-csrc";
    case "cpp":
    case "cc":
      return "text/x-c++src";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Barre de symboles (insertion sans perdre le focus / le clavier virtuel)
// ---------------------------------------------------------------------------

function wireSymbolToolbar() {
  document.querySelectorAll("#symbol-toolbar .sym").forEach((btn) => {
    // preventDefault sur mousedown/touchstart empêche le textarea caché de
    // perdre le focus, donc le clavier virtuel reste ouvert sur mobile.
    const prevent = (e) => e.preventDefault();
    btn.addEventListener("mousedown", prevent);
    btn.addEventListener("touchstart", prevent, { passive: false });
    btn.addEventListener("click", () => {
      if (!state.cm) return;
      const action = btn.dataset.action;
      if (action === "indent") {
        state.cm.execCommand("indentMore");
      } else if (action === "undo") {
        state.cm.execCommand("undo");
      } else if (action === "redo") {
        state.cm.execCommand("redo");
      } else if (btn.dataset.insert !== undefined) {
        state.cm.replaceSelection(btn.dataset.insert);
      }
      state.cm.focus();
    });
  });
}

// ---------------------------------------------------------------------------
// GitHub : dépôts, arborescence, ouverture et sauvegarde de fichiers
// ---------------------------------------------------------------------------

async function initGitHub() {
  const token = localStorage.getItem(LS.ghToken);
  const repoSelect = $("repo-select");
  const treeStatus = $("tree-status");

  if (!token) {
    repoSelect.innerHTML = "<option>Configure ton jeton GitHub…</option>";
    repoSelect.disabled = true;
    treeStatus.textContent = "Ouvre ⚙️ Réglages pour coller ton jeton GitHub.";
    return;
  }

  state.gh = new GitHubClient(token);
  repoSelect.disabled = true;
  repoSelect.innerHTML = "<option>Chargement des dépôts…</option>";
  treeStatus.textContent = "";

  try {
    await state.gh.getUser(); // valide le token
    state.repos = await state.gh.listRepos();
    repoSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.textContent = "— Choisir un dépôt —";
    placeholder.value = "";
    repoSelect.appendChild(placeholder);
    state.repos.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.full_name;
      opt.textContent = r.full_name;
      repoSelect.appendChild(opt);
    });
    repoSelect.disabled = false;

    const last = JSON.parse(localStorage.getItem(LS.lastRepo) || "null");
    if (last && state.repos.some((r) => r.full_name === `${last.owner}/${last.name}`)) {
      repoSelect.value = `${last.owner}/${last.name}`;
      loadRepo(last.owner, last.name);
    }
  } catch (err) {
    repoSelect.innerHTML = "<option>Erreur de connexion</option>";
    treeStatus.textContent = `Jeton invalide ou réseau indisponible : ${err.message}`;
    showToast("Connexion GitHub impossible : " + err.message, "error");
  }
}

$("repo-select").addEventListener("change", (e) => {
  const value = e.target.value;
  if (!value) return;
  const [owner, name] = value.split("/");
  loadRepo(owner, name);
});

async function loadRepo(owner, name) {
  const treeStatus = $("tree-status");
  const fileTreeEl = $("file-tree");
  fileTreeEl.innerHTML = "";
  treeStatus.textContent = "Chargement de l'arborescence…";
  try {
    const branch = await state.gh.getDefaultBranch(owner, name);
    state.currentRepo = { owner, name, branch };
    localStorage.setItem(LS.lastRepo, JSON.stringify({ owner, name }));
    const flat = await state.gh.listTree(owner, name, branch);
    const tree = buildFileTree(flat);
    treeStatus.textContent = "";
    renderTree(tree, fileTreeEl, 0, true);
  } catch (err) {
    treeStatus.textContent = `Impossible de charger ce dépôt : ${err.message}`;
    showToast(err.message, "error");
  }
}

function renderTree(node, container, depth, isRoot) {
  const entries = Object.values(node.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  entries.forEach((entry) => {
    const wrap = document.createElement("div");
    wrap.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = 8 + depth * 14 + "px";

    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.textContent = entry.type === "dir" ? "📁" : "📄";

    const label = document.createElement("span");
    label.textContent = entry.name;

    row.appendChild(icon);
    row.appendChild(label);
    wrap.appendChild(row);

    if (entry.type === "dir") {
      const childrenEl = document.createElement("div");
      childrenEl.className = "tree-children";
      childrenEl.style.display = "none";
      wrap.appendChild(childrenEl);
      renderTree(entry, childrenEl, depth + 1, false);

      row.addEventListener("click", () => {
        const isOpen = childrenEl.style.display !== "none";
        childrenEl.style.display = isOpen ? "none" : "block";
        icon.textContent = entry.type === "dir" ? (isOpen ? "📁" : "📂") : icon.textContent;
      });
    } else {
      row.addEventListener("click", () => openFile(entry.path));
    }

    container.appendChild(wrap);
  });
}

async function openFile(path) {
  if (!state.currentRepo) return;
  try {
    showToast("Ouverture de " + path + "…");
    const { owner, name, branch } = state.currentRepo;
    const { content, sha } = await state.gh.getFile(owner, name, path, branch);
    state.currentFile = { source: "github", path, sha };
    state.cm.setValue(content);
    state.cm.setOption("mode", modeForPath(path));
    $("current-file").textContent = path;
    $("btn-save").disabled = false;
    document.getElementById("app").classList.add("file-open");
    closeAllPanels();
    document.querySelectorAll("#file-tree .tree-row").forEach((r) => r.classList.remove("file-selected"));
  } catch (err) {
    showToast("Erreur à l'ouverture : " + err.message, "error");
  }
}

$("btn-save").addEventListener("click", async () => {
  if (!state.currentFile) return;
  if (state.currentFile.source === "gas") return saveGasFile();
  if (!state.currentRepo) return;
  const message = window.prompt("Message de commit :", "Mise à jour depuis Mobile Code Studio");
  if (message === null) return; // annulé
  $("btn-save").disabled = true;
  try {
    const { owner, name, branch } = state.currentRepo;
    const res = await state.gh.putFile({
      owner,
      repo: name,
      path: state.currentFile.path,
      content: state.cm.getValue(),
      message: message || "Mise à jour depuis Mobile Code Studio",
      sha: state.currentFile.sha,
      branch,
    });
    state.currentFile.sha = res.content.sha;
    showToast("Commit envoyé sur GitHub ✅", "success");
  } catch (err) {
    showToast("Échec du commit : " + err.message, "error");
  } finally {
    $("btn-save").disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Google Apps Script : projets, fichiers, enregistrement
// ---------------------------------------------------------------------------

function getGasClient() {
  const clientId = (localStorage.getItem(LS.googleClientId) || "").trim();
  if (!clientId) {
    throw new Error("Ajoute d'abord ton ID client Google dans ⚙️ Réglages.");
  }
  if (!state.gasAuth || state.gasAuth.clientId !== clientId) {
    state.gasAuth = new GoogleAuth(clientId);
    state.gasClient = new AppsScriptClient(state.gasAuth);
  }
  return state.gasClient;
}

function getGasProjects() {
  try {
    return JSON.parse(localStorage.getItem(LS.gasProjects) || "[]");
  } catch (_) {
    return [];
  }
}

function saveGasProjects(list) {
  localStorage.setItem(LS.gasProjects, JSON.stringify(list));
}

function addGasProject(project) {
  const list = getGasProjects();
  const existing = list.find((p) => p.id === project.id);
  if (existing) existing.name = project.name || existing.name;
  else list.push(project);
  saveGasProjects(list);
}

function setGasStatus(text) {
  $("gas-status").textContent = text || "";
}

function updateGasConnectButton() {
  const ok = state.gasAuth && state.gasAuth.hasValidToken();
  $("btn-gas-connect").textContent = ok ? "✅ Connecté à Google" : "Se connecter à Google";
}

function renderGasProjects(selectedId) {
  const sel = $("gas-project-select");
  const list = getGasProjects();
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length ? "— Choisir un script —" : "— Aucun script ajouté —";
  sel.appendChild(placeholder);
  list.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    sel.appendChild(opt);
  });
  if (selectedId && list.some((p) => p.id === selectedId)) sel.value = selectedId;
}

function switchSource(source) {
  document.querySelectorAll("#source-tabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.source === source);
  });
  $("github-pane").hidden = source === "gas";
  $("gas-pane").hidden = source !== "gas";
  if (source === "gas") {
    renderGasProjects(localStorage.getItem(LS.lastGas));
    updateGasConnectButton();
  }
}

document.querySelectorAll("#source-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchSource(tab.dataset.source));
});

$("btn-gas-connect").addEventListener("click", async () => {
  try {
    getGasClient();
    await state.gasAuth.getToken();
    updateGasConnectButton();
    setGasStatus("Connecté à Google.");
  } catch (err) {
    setGasStatus(err.message);
    showToast(err.message, "error");
  }
});

$("btn-gas-add").addEventListener("click", async () => {
  const id = gasParseScriptId($("gas-add-input").value);
  if (!id) {
    showToast("ID ou URL de script non reconnu.", "error");
    return;
  }
  try {
    const client = getGasClient();
    setGasStatus("Vérification du script…");
    const info = await client.getProject(id);
    addGasProject({ id, name: info.title || id });
    $("gas-add-input").value = "";
    renderGasProjects(id);
    updateGasConnectButton();
    await loadGasProject(id);
  } catch (err) {
    setGasStatus(err.message);
    showToast(err.message, "error");
  }
});

$("btn-gas-drive").addEventListener("click", async () => {
  try {
    const client = getGasClient();
    setGasStatus("Recherche des scripts dans Drive…");
    const found = await client.listDriveScripts();
    found.forEach(addGasProject);
    renderGasProjects(localStorage.getItem(LS.lastGas));
    updateGasConnectButton();
    setGasStatus(
      found.length
        ? `${found.length} script(s) autonome(s) trouvé(s). Les scripts liés à un Sheets s'ajoutent avec leur ID.`
        : "Aucun script autonome trouvé. Les scripts liés à un Sheets s'ajoutent avec leur ID ou leur URL."
    );
  } catch (err) {
    setGasStatus(err.message);
    showToast(err.message, "error");
  }
});

$("gas-project-select").addEventListener("change", (e) => {
  if (e.target.value) loadGasProject(e.target.value);
});

async function loadGasProject(id) {
  const listEl = $("gas-file-list");
  listEl.innerHTML = "";
  setGasStatus("Chargement des fichiers…");
  try {
    const client = getGasClient();
    const content = await client.getContent(id);
    const known = getGasProjects().find((p) => p.id === id);
    state.gasProject = { id, name: (known && known.name) || id };
    localStorage.setItem(LS.lastGas, id);
    updateGasConnectButton();
    setGasStatus("");
    renderGasFiles(content.files || []);
  } catch (err) {
    setGasStatus(err.message);
    showToast(err.message, "error");
  }
}

function renderGasFiles(files) {
  const order = { SERVER_JS: 0, HTML: 1, JSON: 2 };
  const icons = { SERVER_JS: "📜", HTML: "🌐", JSON: "⚙️" };
  const listEl = $("gas-file-list");
  listEl.innerHTML = "";
  [...files]
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name))
    .forEach((file) => {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = "8px";
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = icons[file.type] || "📄";
      const label = document.createElement("span");
      label.textContent = gasDisplayName(file);
      row.appendChild(icon);
      row.appendChild(label);
      row.addEventListener("click", () => openGasFile(file));
      listEl.appendChild(row);
    });
}

function openGasFile(file) {
  const project = state.gasProject;
  if (!project) return;
  const display = gasDisplayName(file);
  state.currentFile = {
    source: "gas",
    path: `${project.name}/${display}`,
    scriptId: project.id,
    gasName: file.name,
    gasType: file.type,
  };
  state.cm.setValue(file.source || "");
  state.cm.setOption("mode", modeForPath(display));
  $("current-file").textContent = `${project.name} › ${display}`;
  $("btn-save").disabled = false;
  document.getElementById("app").classList.add("file-open");
  closeAllPanels();
}

async function saveGasFile() {
  const cur = state.currentFile;
  if (!cur || cur.source !== "gas") return;
  if (!window.confirm("Enregistrer ce fichier dans Apps Script ?")) return;
  $("btn-save").disabled = true;
  try {
    const client = getGasClient();
    // On relit le projet juste avant : l'API remplace TOUS les fichiers d'un coup,
    // donc on repart de la version la plus récente et on ne change que ce fichier.
    const content = await client.getContent(cur.scriptId);
    const files = content.files || [];
    const target = files.find((f) => f.name === cur.gasName && f.type === cur.gasType);
    if (!target) throw new Error("Ce fichier n'existe plus dans le projet Apps Script.");
    target.source = state.cm.getValue();
    await client.updateContent(cur.scriptId, files);
    showToast("Enregistré dans Apps Script ✅", "success");
  } catch (err) {
    showToast("Échec de l'enregistrement : " + err.message, "error", 5000);
  } finally {
    $("btn-save").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Assistant IA
// ---------------------------------------------------------------------------

function currentAIClient() {
  const provider = localStorage.getItem(LS.aiProvider) || "anthropic";
  const apiKey = localStorage.getItem(LS.aiKey) || "";
  const model = localStorage.getItem(LS.aiModel) || "";
  const baseUrl = localStorage.getItem(LS.aiBaseUrl) || "";
  return new AIClient({ provider, apiKey, model, baseUrl });
}

$("btn-ai-generate").addEventListener("click", async () => {
  const instruction = $("ai-instruction").value.trim();
  if (!instruction) {
    showToast("Décris d'abord ce que tu veux.", "error");
    return;
  }
  const useContext = $("ai-use-context").checked && state.currentFile;
  const fileContent = useContext ? state.cm.getValue() : "";
  const fileName = useContext ? state.currentFile.path : "nouveau fichier";

  $("btn-ai-generate").disabled = true;
  $("ai-status").textContent = "Génération en cours…";
  $("ai-result").hidden = true;

  try {
    const client = currentAIClient();
    const code = await client.generateCode(instruction, fileContent, fileName);
    $("ai-result-code").textContent = code;
    $("ai-result").hidden = false;
    $("ai-status").textContent = "";
    $("ai-result-code").dataset.code = code;
  } catch (err) {
    $("ai-status").textContent = err.message;
    showToast(err.message, "error");
  } finally {
    $("btn-ai-generate").disabled = false;
  }
});

$("btn-ai-apply").addEventListener("click", () => {
  const code = $("ai-result-code").dataset.code || "";
  if (!state.currentFile) {
    // Pas de fichier ouvert : on ouvre quand même l'éditeur avec ce code,
    // à enregistrer manuellement ensuite (ex: en créant un nouveau fichier sur GitHub).
    document.getElementById("app").classList.add("file-open");
  }
  state.cm.setValue(code);
  closePanel($("ai-panel"));
  showToast(state.currentFile ? "Code appliqué — pense à enregistrer 💾" : "Code inséré dans l'éditeur");
});

$("btn-ai-discard").addEventListener("click", () => {
  $("ai-result").hidden = true;
  $("ai-instruction").value = "";
});

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

function loadSettingsIntoForm() {
  $("gh-token").value = localStorage.getItem(LS.ghToken) || "";
  $("ai-provider").value = localStorage.getItem(LS.aiProvider) || "anthropic";
  $("ai-key").value = localStorage.getItem(LS.aiKey) || "";
  $("ai-model").value = localStorage.getItem(LS.aiModel) || "";
  $("ai-baseurl").value = localStorage.getItem(LS.aiBaseUrl) || "";
  $("google-client-id").value = localStorage.getItem(LS.googleClientId) || "";
  const fs = parseInt(localStorage.getItem(LS.fontSize) || "16", 10);
  $("font-size").value = fs;
  $("font-size-value").textContent = fs;
  toggleBaseUrlRow();
}

function toggleBaseUrlRow() {
  $("ai-baseurl-row").style.display = $("ai-provider").value === "custom" ? "block" : "none";
}
$("ai-provider").addEventListener("change", toggleBaseUrlRow);

$("font-size").addEventListener("input", (e) => {
  $("font-size-value").textContent = e.target.value;
});

$("btn-save-settings").addEventListener("click", async () => {
  const oldToken = localStorage.getItem(LS.ghToken) || "";
  const newToken = $("gh-token").value.trim();

  localStorage.setItem(LS.ghToken, newToken);
  localStorage.setItem(LS.aiProvider, $("ai-provider").value);
  localStorage.setItem(LS.aiKey, $("ai-key").value.trim());
  localStorage.setItem(LS.aiModel, $("ai-model").value.trim());
  localStorage.setItem(LS.aiBaseUrl, $("ai-baseurl").value.trim());
  localStorage.setItem(LS.fontSize, $("font-size").value);
  const newGoogleId = $("google-client-id").value.trim();
  if (newGoogleId !== (localStorage.getItem(LS.googleClientId) || "")) {
    if (state.gasAuth) state.gasAuth.signOut();
    state.gasAuth = null;
    state.gasClient = null;
  }
  localStorage.setItem(LS.googleClientId, newGoogleId);

  setEditorFontSize(parseInt($("font-size").value, 10));
  closePanel($("settings-panel"));
  showToast("Réglages enregistrés", "success");

  if (newToken !== oldToken) {
    await initGitHub();
  }
});

$("btn-gas-signout").addEventListener("click", () => {
  if (state.gasAuth) state.gasAuth.signOut();
  updateGasConnectButton();
  showToast("Déconnecté de Google");
});

// ---------------------------------------------------------------------------
// Service worker (coquille hors-ligne)
// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* silencieux : l'appli fonctionne quand même sans service worker */
    });
  });
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

initEditor();
wireSymbolToolbar();
initGitHub();
