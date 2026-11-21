# Mobile Code Studio

Éditeur de code pensé pour le téléphone, relié directement à tes dépôts
GitHub, avec un assistant IA intégré pour générer ou modifier du code à
partir d'une simple description. Aucun serveur : tout tourne dans le
navigateur, les fichiers sont lus et enregistrés directement sur GitHub.

## Fonctionnalités

- Parcourir tes dépôts GitHub et ouvrir n'importe quel fichier
- Éditeur avec coloration syntaxique (JS/Apps Script, HTML, CSS, Python…),
  fermeture automatique des parenthèses, et une **barre de symboles**
  au-dessus du clavier (`{ } ( ) [ ] ; : = " ' < > /`) pour éviter la galère
  du clavier mobile standard
- Enregistrer = commit direct sur GitHub (avec message de commit)
- **Google Apps Script** : ouvre et modifie directement les fichiers (`.gs`,
  `.html`, `appsscript.json`) de tes projets Apps Script, y compris ceux liés
  à un Google Sheets, et enregistre-les en un tap
- Assistant IA : décris ce que tu veux, il te renvoie le code, tu
  l'appliques dans l'éditeur si ça te convient
- Installable sur l'écran d'accueil du téléphone (PWA), utilisable comme
  une vraie appli

## Mise en ligne (5-10 minutes)

1. **Crée un nouveau dépôt GitHub**, public (le plan gratuit de GitHub
   n'active GitHub Pages que sur les dépôts publics). Ex : `code-studio`.
   Le code ici ne contient aucun secret : ton jeton et tes clés restent
   uniquement dans ton navigateur, jamais dans le dépôt.
2. **Dépose les fichiers de ce dossier** à la racine du dépôt (depuis
   l'appli GitHub mobile ou le site : bouton "Add file" → "Upload files").
3. Dans le dépôt : **Settings → Pages** → Source = "Deploy from a branch",
   branche `main`, dossier `/ (root)` → **Save**.
4. Après 1-2 minutes, l'URL de ton site apparaît en haut de cette page
   (`https://<ton-pseudo>.github.io/code-studio/`). Ouvre-la sur ton
   téléphone.
5. **Ajoute-la à l'écran d'accueil** : sur Chrome Android, menu ⋮ → "Ajouter
   à l'écran d'accueil" ; sur Safari iOS, bouton Partager → "Sur l'écran
   d'accueil". Elle s'ouvrira ensuite comme une appli normale.

## Première configuration (dans l'appli, icône ⚙️)

**GitHub** — crée un jeton d'accès personnel :
`github.com → Settings (ton compte) → Developer settings → Personal access
tokens`. Le plus simple est un token "classic" avec le droit `repo` coché.
Colle-le dans le champ correspondant.

**Assistant IA (optionnel)** — choisis un fournisseur :
- **Anthropic (Claude)** : crée une clé sur `console.anthropic.com` → API
  Keys. Modèle conseillé : `claude-sonnet-5-5`.
- **OpenRouter** : crée une clé sur `openrouter.ai/keys`. Indique le nom
  du modèle que tu veux utiliser (ex. un modèle gratuit du catalogue
  OpenRouter).
- **Personnalisé** : toute API compatible "OpenAI chat completions"
  (Groq, Mistral…) — fonctionne seulement si ce fournisseur autorise les
  appels directs depuis un navigateur (CORS). Si ça ne marche pas, c'est
  une restriction du fournisseur, pas un bug de l'appli : passe par
  OpenRouter à la place.

**Google Apps Script (optionnel)** — à faire une seule fois :
1. Va sur `script.google.com/home/usersettings` et active
   **« API Google Apps Script »**.
2. Sur `console.cloud.google.com`, crée un projet (ou prends-en un existant),
   puis **APIs et services → Bibliothèque** : active **Google Apps Script API**
   et **Google Drive API**.
3. **APIs et services → Écran de consentement OAuth** : type « Externe », puis
   ajoute ton adresse Gmail dans **Utilisateurs de test** (tant que l'appli
   reste en mode test, c'est suffisant).
4. **Identifiants → Créer des identifiants → ID client OAuth**, type
   « Application Web ». Dans **Origines JavaScript autorisées**, mets
   l'adresse de ton site **sans chemin ni `/` final**
   (ex : `https://<ton-pseudo>.github.io`).
5. Copie l'ID client dans l'appli (⚙️ → Google Apps Script), enregistre, puis
   ouvre ☰ → onglet **Apps Script** → **Se connecter à Google**.
6. Ajoute un script : colle son **ID ou son URL** (dans l'éditeur Apps Script,
   l'URL ressemble à `script.google.com/home/projects/<ID>/edit`), ou touche
   « Charger mes scripts depuis Drive » pour les scripts autonomes.

## Limites connues

- L'API GitHub utilisée ne gère pas les fichiers de plus d'environ 1 Mo.
- Pas encore de création de nouveau fichier/dossier directement dans
  l'appli (seulement l'édition de fichiers existants).
- Toujours la branche par défaut du dépôt (pas de changement de branche).
- Apps Script : la connexion Google dure environ 1 h (une fenêtre de
  reconnexion peut s'ouvrir ensuite) ; l'enregistrement relit le projet juste
  avant d'écrire et ne change que le fichier ouvert, mais si tu modifies le même
  script ailleurs au même moment, la dernière écriture gagne.
- Apps Script : pas encore de création / suppression / renommage de fichiers,
  ni d'exécution ou de déploiement du script depuis l'appli.
- La liste « Drive » ne montre que les scripts autonomes ; les scripts liés à un
  Sheets s'ajoutent par leur ID.
- Le jeton GitHub et les clés IA sont stockés dans le navigateur de
  l'appareil utilisé (localStorage) — à garder en tête sur un appareil
  partagé.

## Et ensuite ?

Toutes ces limites peuvent être levées (création de fichiers, choix de
branche, historique des commits, etc.) — dis-moi ce qui te serait le plus
utile en priorité.
