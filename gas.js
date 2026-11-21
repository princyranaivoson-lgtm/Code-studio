// gas.js — accès à Google Apps Script, entièrement côté client (aucun serveur).
//
// - Connexion : Google Identity Services (jeton d'accès OAuth valable ~1 h,
//   gardé en mémoire uniquement, jamais écrit dans le dépôt).
// - Lecture / écriture des fichiers d'un projet : API Apps Script
//   (projects.getContent / projects.updateContent).
// - Liste des scripts autonomes : API Drive (les scripts liés à un Google
//   Sheets n'y apparaissent pas : on les ajoute par leur ID ou leur URL).

const GAS_SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

const GAS_API = "https://script.googleapis.com/v1/projects";
const GAS_EXT = { SERVER_JS: ".gs", HTML: ".html", JSON: ".json" };

class GoogleAuth {
  constructor(clientId) {
    this.clientId = clientId;
    this.token = null;
    this.expiresAt = 0;
    this.tokenClient = null;
  }

  hasValidToken() {
    return !!this.token && Date.now() < this.expiresAt - 30000;
  }

  signOut() {
    if (this.token && window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(this.token, () => {});
    }
    this.token = null;
    this.expiresAt = 0;
  }

  _init() {
    if (this.tokenClient) return;
    if (!this.clientId) throw new Error("ID client Google manquant (voir Réglages).");
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      throw new Error("Bibliothèque Google non chargée (vérifie ta connexion).");
    }
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: GAS_SCOPES,
      callback: () => {},
      error_callback: () => {},
    });
  }

  // À appeler idéalement depuis un tap (le navigateur peut bloquer la fenêtre sinon).
  getToken() {
    return new Promise((resolve, reject) => {
      if (this.hasValidToken()) return resolve(this.token);
      try {
        this._init();
      } catch (e) {
        return reject(e);
      }
      this.tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        this.token = resp.access_token;
        this.expiresAt = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000;
        localStorage.setItem("mcs_google_consented", "1");
        resolve(this.token);
      };
      this.tokenClient.error_callback = (err) => {
        const type = err && err.type;
        if (type === "popup_closed") reject(new Error("Connexion Google annulée."));
        else if (type === "popup_failed_to_open")
          reject(new Error("Fenêtre Google bloquée : appuie sur « Se connecter à Google »."));
        else reject(new Error((err && (err.message || err.type)) || "Connexion Google impossible."));
      };
      const consented = localStorage.getItem("mcs_google_consented") === "1";
      this.tokenClient.requestAccessToken({ prompt: consented ? "" : "consent" });
    });
  }
}

class AppsScriptClient {
  constructor(auth) {
    this.auth = auth;
  }

  async request(url, options = {}) {
    const token = await this.auth.getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body && body.error && body.error.message) message = body.error.message;
      } catch (_) {
        /* pas de corps JSON */
      }
      if (res.status === 401) this.auth.token = null;
      if (/usersettings/i.test(message) || /Apps Script API has not been used/i.test(message)) {
        message =
          "L'API Apps Script n'est pas activée : ouvre script.google.com/home/usersettings, " +
          "active « API Google Apps Script », puis réessaie.";
      } else if (res.status === 404) {
        message = "Script introuvable (ID incorrect, ou ce compte Google n'y a pas accès).";
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  getProject(scriptId) {
    return this.request(`${GAS_API}/${encodeURIComponent(scriptId)}`);
  }

  getContent(scriptId) {
    return this.request(`${GAS_API}/${encodeURIComponent(scriptId)}/content`);
  }

  // Remplace TOUS les fichiers du projet : on renvoie donc la liste complète.
  updateContent(scriptId, files) {
    const clean = files.map((f) => ({ name: f.name, type: f.type, source: f.source }));
    return this.request(`${GAS_API}/${encodeURIComponent(scriptId)}/content`, {
      method: "PUT",
      body: JSON.stringify({ files: clean }),
    });
  }

  // Scripts autonomes visibles dans Drive (pas les scripts liés à un Sheets).
  async listDriveScripts() {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.script' and trashed=false");
    const data = await this.request(
      "https://www.googleapis.com/drive/v3/files" +
        `?q=${q}&fields=${encodeURIComponent("files(id,name,modifiedTime)")}` +
        "&orderBy=modifiedTime%20desc&pageSize=100"
    );
    return (data.files || []).map((f) => ({ id: f.id, name: f.name }));
  }
}

// Nom affiché dans l'éditeur : "Code" (SERVER_JS) → "Code.gs", etc.
function gasDisplayName(file) {
  return file.name + (GAS_EXT[file.type] || "");
}

// Accepte un ID brut ou une URL script.google.com/... et en extrait l'ID.
function gasParseScriptId(input) {
  const m = (input || "").match(/[-\w]{25,}/);
  return m ? m[0] : null;
}
