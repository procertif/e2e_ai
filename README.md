# Procertif — Suite de tests E2E

Suite de tests end-to-end [Playwright](https://playwright.dev/) pour la plateforme de certification [Procertif](https://app.procertif.dev). Les tests couvrent les parcours d'évaluation (quiz) et les workflows jury. L'UI et les tests sont en français.

## Prérequis

- Node.js 20+
- Chromium (installé via Playwright)

```bash
npm install
npx playwright install chromium
```

## Configuration

Créer un fichier `.env` à la racine :

```env
BASE_URL=https://app.procertif.dev
TEST_OTP=444444
PORT=3333
HEADLESS=true
LANG=fr
ANTHROPIC_CLIENT_ID=<client-id OAuth Anthropic>
ANTHROPIC_MODEL=claude-sonnet-4-6
```

| Variable | Défaut | Description |
|----------|--------|-------------|
| `BASE_URL` | `https://app.procertif.dev` | URL de l'application cible |
| `PORT` | `3333` | Port du serveur web (redémarrage requis) |
| `HEADLESS` | `true` | `false` pour lancer Chromium en mode fenêtré |
| `LANG` | `en` | Langue de l'interface : `fr` ou `en` |
| `ANTHROPIC_CLIENT_ID` | — | Client ID OAuth pour l'API Claude |
| `ANTHROPIC_MODEL` | — | Modèle Claude utilisé (ex : `claude-sonnet-4-6`) |


## Lancer les tests

```bash
# Tous les tests (CLI Playwright)
npm test

# Un test spécifique
npx playwright test cas1-quiz.spec.ts
```

## Interface web (Test Runner UI)

Un serveur Node.js expose une UI à `http://localhost:3333` pour lancer et gérer les tests sans passer par le CLI.

```bash
npm run server
```

## Docker

```bash
docker compose up
```

Le conteneur utilise le réseau hôte et monte les dossiers `app/`, `tests/`, `data/` et `screenshots/` depuis le système de fichiers local.

## Fonctionnalités de l'interface web

### Tests disponibles (panneau gauche)

- Liste tous les fichiers `*.spec.ts` du dossier `tests/`, avec badge de type (Quiz, Jury…) et durée estimée
- Recherche en temps réel par nom de test
- Deux onglets : **Tests** (liste individuelle) et **Groupes** (ajout par groupe entier)
- Bouton `+` pour ajouter un test à la file ; `×` pour le retirer
- Menu contextuel par test : **Renommer** (alias d'affichage, le fichier n'est pas renommé) et **Supprimer** (supprime définitivement le fichier de test, les screenshots, les actions, la spec et les données associées)

### File d'exécution (panneau droit)

- Les tests s'exécutent **séquentiellement** dans l'ordre de la file
- Réorganisation par **drag & drop**
- Chaque test peut être lancé individuellement via son bouton **Lancer**, ou tous d'un coup via **Lancer la file**
- Output Playwright affiché en temps réel dans la carte du test (streaming SSE)
- Statut visuel par carte : `Prêt` / `En cours…` / `Réussi ✓` / `Échoué ✗`
- Bouton **Stop** pour interrompre un test en cours (SIGKILL sur le processus Playwright)
- La file est persistée dans le `localStorage` (survit aux rechargements)
- En fin de session : modale récapitulative avec nombre de tests lancés / réussis / échoués, durée totale, liste des échecs, et liens vers les screenshots

### Groupes (`/groups`)

- Création, renommage et suppression de groupes de tests
- Assignation d'un test à un groupe via une modale de sélection
- Gestion en masse via la modale **Gérer les tests** (cases à cocher)
- Chaque groupe est coloré automatiquement et affiche le nombre de tests qu'il contient
- Les groupes sont persistés dans `data/groups.json`

### Screenshots (`/screenshots`)

- Affiche toutes les captures générées, organisées par test
- Chaque groupe de screenshots est repliable/dépliable
- Recherche par nom de test
- **Lightbox** au clic sur une capture : navigation clavier (←/→), compteur, légende
- Filtrage par session : `?f=all` (tous les tests de la dernière session) ou `?f=failed` (uniquement les tests échoués)

### Scénarios (`/scenarios`)

- Affiche les specs Gherkin générées pour chaque test (format français : *Étant donné / Quand / Alors*)
- Les specs sont générées automatiquement depuis le code du test et le journal d'actions (`data/actionTest/`)
- Bouton **Régénérer** pour relancer la génération via l'API Claude
- **Workflow test en attente** : les tests générés par le chat IA arrivent en état *pending* ; depuis cette page il est possible de les lancer, de les confirmer (déplacement vers `tests/`) ou de les rejeter

### Chat IA (`/chat`)

- Interface de chat intégrée pour interagir avec Claude
- Génère et modifie des tests via des prompts en langage naturel directement depuis l'UI
- **Outils disponibles** : Read, Write, Edit, Bash, Glob, LS, WebFetch, ReadImage — Claude peut lire et écrire des fichiers du projet
- **Appels d'outils interleaved** : les pills d'outils s'affichent à l'endroit exact où Claude les a utilisés dans le flux de la réponse, pas tous regroupés en tête de message
- **Instructions globales** : un panneau dépliable permet de définir des consignes appliquées automatiquement à chaque message (ex : *Toujours prendre un screenshot entre chaque action*), persistées en `localStorage`
- **Support images** : possibilité de joindre des captures d'écran au message (coller, glisser-déposer, bouton pièce jointe)
- **Sauvegarde de conversation** : bouton "Sauvegarder" dans le header, ouvre une modale pour nommer le fichier et l'enregistre au format JSON dans `tests/prompt/`
- **Bouton Stop** : interrompt une génération en cours

### Logs Chat (`/logs`)

- Historique de toutes les sessions de chat avec l'IA
- Affiche pour chaque session : tokens consommés (input / output / cache), nombre d'appels API
- Vue détaillée par session : liste des appels API avec modèle, durée, tokens, et le contenu complet des messages échangés

### Configuration (`/config`)

- Interface de gestion du fichier `.env` directement depuis le navigateur
- Variables connues avec libellé et description
- Variables personnalisées (clé/valeur libres) avec ajout/suppression dynamique
- Bouton **Sauvegarder** — les variables `PORT` nécessitent un redémarrage du serveur

## URLs

| URL | Description |
|-----|-------------|
| `http://localhost:3333/` | Test runner |
| `http://localhost:3333/screenshots` | Tous les screenshots |
| `http://localhost:3333/screenshots?f=all` | Screenshots de la dernière session |
| `http://localhost:3333/screenshots?f=failed` | Screenshots des tests échoués |
| `http://localhost:3333/groups` | Gestion des groupes |
| `http://localhost:3333/scenarios` | Scénarios Gherkin et tests en attente |
| `http://localhost:3333/chat` | Chat IA |
| `http://localhost:3333/logs` | Logs des sessions chat |
| `http://localhost:3333/config` | Configuration `.env` |

## Structure

```
app/                        # Test Runner UI
  server.js                 # Serveur HTTP (Node.js, port 3333)
  index.html / index.css        # Page principale (test runner)
  screenshots.html / screenshots.css  # Visionneuse de screenshots
  groups.html / groups.css  # Gestion des groupes
  scenarios.html / .css     # Scénarios Gherkin + workflow pending
  chat.html / chat.css      # Interface chat IA
  logs.html / logs.css      # Historique des sessions chat
  config.html               # Configuration .env
  i18n/                     # Traductions (en.json, fr.json)
  i18n.js                   # Chargeur i18n côté client

tests/                      # Specs Playwright (gitignorées, varient par environnement)
  <domaine>_<type>.spec.ts  # ex: badge_competences_ia.spec.ts, titre_rncp.spec.ts
  prompt/                   # Conversations chat sauvegardées (JSON)

data/                       # Données runtime (gitignorées)
  groups.json               # Groupes persistés
  last-session.json         # Dernière session (écrasé à chaque run)
  run-history.json          # Historique des durées d'exécution
  test-aliases.json         # Alias d'affichage des fichiers de test
  actionTest/               # Journaux d'actions par test (JSON)
  specs/                    # Specs Gherkin générées (Markdown)
  pending/                  # Tests générés par le chat en attente de confirmation
  promptTest/               # Historiques de prompts par test
  chat-logs/                # Logs des sessions chat IA (JSON)

screenshots/                # Captures générées par les tests (gitignorées)
```

## Conventions de nommage des specs

```
<domaine>_<type>.spec.ts
```

Exemples : `badge_competences_ia.spec.ts`, `titre_rncp.spec.ts`

## Notes

- Les tests ne contiennent pas d'assertions — ils capturent les workflows via screenshots.
- Les screenshots sont numérotés et labellisés via un helper `shot()` défini dans chaque test.
- L'exécution est séquentielle (`fullyParallel: false`, `retries: 0`).
- Navigateur : Chromium uniquement.
- Les tests, les screenshots et le dossier data sont dans le gitignore.
