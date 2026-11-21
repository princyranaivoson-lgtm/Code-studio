// github.js — petite couche au-dessus de l'API REST GitHub, entièrement
// côté client (aucun serveur). Le token est un Personal Access Token (PAT)
// que l'utilisateur crée lui-même sur github.com/settings/tokens avec les
// droits "repo" (ou "Contents: Read and write" pour un token fin), et qui
// reste stocké uniquement dans le localStorage de ce navigateur.

const GITHUB_API = "https://api.github.com";

// ---- utilitaires base64 <-> UTF-8 (atob/btoa ne gèrent pas l'UTF-8 directement) ----

function uint8ToBinaryString(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return binary;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  return btoa(uint8ToBinaryString(bytes));
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

class GitHubClient {
  constructor(token) {
    this.token = token;
  }

  headers(extra = {}) {
    return {
      Authorization: `token ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }

  async request(path, options = {}) {
    const res = await fetch(`${GITHUB_API}${path}`, {
      ...options,
      headers: this.headers(options.headers),
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body && body.message) message = body.message;
      } catch (_) {
        /* pas de corps JSON */
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // Vérifie le token et renvoie le profil GitHub (sert aussi de "ping").
  async getUser() {
    return this.request("/user");
  }

  // Dépôts accessibles par ce token, triés par dernière mise à jour.
  async listRepos() {
    const repos = [];
    let page = 1;
    // Jusqu'à 300 dépôts (3 pages de 100) ; largement suffisant pour un usage perso.
    while (page <= 3) {
      const batch = await this.request(
        `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator`
      );
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return repos;
  }

  async getDefaultBranch(owner, repo) {
    const info = await this.request(`/repos/${owner}/${repo}`);
    return info.default_branch;
  }

  // Liste à plat tous les fichiers du dépôt (arborescence Git complète).
  async listTree(owner, repo, branch) {
    const ref = await this.request(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    const commitSha = ref.object.sha;
    const commit = await this.request(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
    const tree = await this.request(
      `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`
    );
    if (tree.truncated) {
      console.warn("Arborescence tronquée par GitHub (dépôt très volumineux).");
    }
    return tree.tree.filter((entry) => entry.type === "blob");
  }

  // Charge le contenu texte d'un fichier + son sha (nécessaire pour le commit de mise à jour).
  async getFile(owner, repo, path, ref) {
    const data = await this.request(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`
    );
    if (Array.isArray(data)) {
      throw new Error("Ce chemin est un dossier, pas un fichier.");
    }
    const content = data.encoding === "base64" ? base64ToUtf8(data.content) : data.content;
    return { content, sha: data.sha };
  }

  // Crée ou met à jour un fichier (sha requis seulement pour une mise à jour).
  async putFile({ owner, repo, path, content, message, sha, branch }) {
    const body = {
      message,
      content: utf8ToBase64(content),
      branch,
    };
    if (sha) body.sha = sha;
    return this.request(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
      { method: "PUT", body: JSON.stringify(body) }
    );
  }
}

// Construit une arborescence imbriquée { dossiers / fichiers } à partir de la
// liste à plat renvoyée par listTree(), pour l'affichage dans le panneau fichiers.
function buildFileTree(flatList) {
  const root = { name: "", path: "", type: "dir", children: {} };
  for (const entry of flatList) {
    const parts = entry.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        node.children[part] = { name: part, path: entry.path, type: "file", sha: entry.sha };
      } else {
        if (!node.children[part]) {
          node.children[part] = {
            name: part,
            path: parts.slice(0, i + 1).join("/"),
            type: "dir",
            children: {},
          };
        }
        node = node.children[part];
      }
    });
  }
  return root;
}
