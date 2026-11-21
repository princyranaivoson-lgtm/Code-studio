// ai.js — assistant IA appelé directement depuis le navigateur (aucun serveur
// intermédiaire). Chaque utilisateur fournit sa propre clé API, stockée
// uniquement dans son localStorage ("bring your own key").
//
// Fournisseurs pris en charge :
//  - "anthropic"  : API Claude en direct, avec l'en-tête spécial qui autorise
//                   les appels navigateur (cf. Anthropic, CORS activé 08/2024).
//  - "openrouter" : passerelle multi-modèles, CORS ouvert nativement.
//  - "custom"     : toute API compatible "OpenAI chat/completions" (Groq,
//                   Mistral, etc.) — fonctionne seulement si ce fournisseur
//                   autorise les appels CORS depuis un navigateur.

function buildSystemPrompt() {
  return (
    "Tu es un assistant de programmation. On te donne le contenu actuel d'un " +
    "fichier de code et une demande en langage naturel. Réponds UNIQUEMENT par " +
    "le code complet et final du fichier (version modifiée), dans un seul bloc " +
    "de code markdown, sans aucune explication avant ou après. Si la demande ne " +
    "nécessite qu'un petit extrait, renvoie quand même le fichier entier mis à jour."
  );
}

function buildUserPrompt(instruction, fileContent, fileName) {
  const fence = "```";
  return (
    `Fichier actuel (${fileName || "sans nom"}) :\n${fence}\n${fileContent || ""}\n${fence}\n\n` +
    `Demande : ${instruction}`
  );
}

function extractCode(text) {
  const match = text.match(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

async function callChatCompletionsAPI(url, headers, model, system, user) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (networkErr) {
    throw new Error(
      "Impossible de joindre l'API (réseau ou blocage CORS par ce fournisseur). " +
        "Essaie OpenRouter, qui autorise les appels directs depuis un navigateur."
    );
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = (body.error && (body.error.message || body.error)) || msg;
    } catch (_) {}
    throw new Error(`Erreur IA : ${msg}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("Réponse inattendue du fournisseur IA.");
  return text;
}

async function callAnthropic(apiKey, model, system, user) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (networkErr) {
    throw new Error("Impossible de joindre l'API Anthropic depuis ce navigateur.");
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = (body.error && body.error.message) || msg;
    } catch (_) {}
    throw new Error(`Erreur IA (Anthropic) : ${msg}`);
  }
  const data = await res.json();
  const text = data.content && data.content[0] && data.content[0].text;
  if (!text) throw new Error("Réponse inattendue de l'API Anthropic.");
  return text;
}

class AIClient {
  constructor({ provider, apiKey, model, baseUrl }) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  // Renvoie le code final (déjà extrait du bloc markdown) pour le fichier donné.
  async generateCode(instruction, fileContent, fileName) {
    if (!this.apiKey) throw new Error("Aucune clé API IA configurée (voir Réglages).");
    const system = buildSystemPrompt();
    const user = buildUserPrompt(instruction, fileContent, fileName);
    let raw;
    if (this.provider === "anthropic") {
      raw = await callAnthropic(this.apiKey, this.model, system, user);
    } else if (this.provider === "openrouter") {
      raw = await callChatCompletionsAPI(
        "https://openrouter.ai/api/v1/chat/completions",
        { Authorization: `Bearer ${this.apiKey}`, "HTTP-Referer": location.origin, "X-Title": "Mobile Code Studio" },
        this.model,
        system,
        user
      );
    } else if (this.provider === "custom") {
      if (!this.baseUrl) throw new Error("URL de base manquante pour le fournisseur personnalisé.");
      raw = await callChatCompletionsAPI(
        this.baseUrl,
        { Authorization: `Bearer ${this.apiKey}` },
        this.model,
        system,
        user
      );
    } else {
      throw new Error("Fournisseur IA inconnu.");
    }
    return extractCode(raw);
  }
}
