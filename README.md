# Procertif — E2E AI

Plateforme de tests end-to-end [Playwright](https://playwright.dev/) pilotée par IA pour l'application [Procertif](https://app.procertif.dev). Les tests sont créés, corrigés et maintenus avec l'aide d'assistants Claude, chacun cadré par des outils restreints et une validation humaine obligatoire. UI et tests en français.

## Architecture

- **`backend/`** — API Express (Node 20). Injection de dépendances via `src/container.js`, modules dans `src/modules/`, assistants IA dans `src/ai/`. Base SQLite (Prisma) dans `data/app.db`.
- **`frontend/`** — SPA React + Vite (build servi par le backend en production).
- **`src/`** — utilitaires partagés des specs (`testUtils.ts`, reporter d'étapes).
- **`data/`** — toutes les données runtime (gitignoré, détail plus bas). Tous les dossiers sont auto-créés au démarrage du backend.

## Démarrage

```bash
npm install && npx playwright install chromium
npm --prefix backend install
npm --prefix frontend install

npm run build      # build du front (servi par le backend)
npm run server     # backend sur http://localhost:3333
# dev front avec hot-reload : npm --prefix frontend run dev (port 5173)
```

L'accès à l'UI demande un login : le client échange `AUTH_TOKEN` contre un JWT de 12 h.

## Configuration (`.env` à la racine)

```env
# — Obligatoire —
AUTH_TOKEN=change-me                     # secret partagé du login UI
JWT_PRIVATE_KEY=change-me-aussi          # signature des JWT

# — Serveur & tests —
PORT=3333
DEFAULT_URL=https://app.procertif.dev
HEADLESS=true
LANG=fr

# — IA (Claude) —
ANTHROPIC_CLIENT_ID=<oauth-client-id>
ANTHROPIC_MODEL=claude-sonnet-4-6

# — Repos git —
GITHUB_TOKEN=<token-sauvegarde>          # push de data/versioned/
GITHUB_REPO_URL=https://github.com/<org>/<repo-sauvegarde>.git
TEST_GITHUB_TOKEN=<token-app-testee>     # fetch du code testé (FindSelector)
TEST_GITHUB_REPO_URL=https://github.com/<org>/<app-testee>.git

# — Sécurité (optionnel, défauts sensés) —
LOGIN_MAX_ATTEMPTS=5
LOGIN_WINDOW_SECONDS=60
WEBFETCH_ALLOWED_DOMAINS=                # vide = web public ; ex: procertif.com,docs.exemple.fr

# — Machine de déploiement uniquement (optionnel) —
DEPLOY_UPDATE_INTERVAL_SECONDS=300       # cadence de l'auto-update (deploy/)
# DEPLOY_REPO_PAT=…                      # inutile tant que le repo est public

```

`TEST_RUNNER_UID` / `TEST_RUNNER_GID` / `TEST_RUNNER_HOME` sont posés par l'image Docker, pas par le `.env`.

| Variable | Description |
|----------|-------------|
| `AUTH_TOKEN` | Secret partagé du login (obligatoire) |
| `JWT_PRIVATE_KEY` | Secret de signature des JWT (obligatoire) |
| `PORT` | Port du backend (défaut `3333`) |
| `DEFAULT_URL` | URL cible par défaut des tests |
| `HEADLESS` | `false` pour ouvrir Chromium en fenêtré |
| `LANG` | Langue de l'UI : `fr` ou `en` |
| `ANTHROPIC_CLIENT_ID` / `ANTHROPIC_MODEL` | OAuth client-id et modèle Claude |
| `GITHUB_TOKEN` / `GITHUB_REPO_URL` | Repo de sauvegarde de `data/versioned/` (onglet Sauvegarde) |
| `TEST_GITHUB_TOKEN` / `TEST_GITHUB_REPO_URL` | Repo de l'application testée (FindSelector) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` | Rate-limit du login (défaut 5 / 60 s) |
| `WEBFETCH_ALLOWED_DOMAINS` | Allowlist de domaines pour l'outil WebFetch de l'IA (vide = tout le web public ; les IP privées sont toujours bloquées) |
| `TEST_RUNNER_UID` / `TEST_RUNNER_GID` / `TEST_RUNNER_HOME` | Compte restreint `e2erunner` exécutant les tests (posé par l'image Docker) |
| `DEPLOY_UPDATE_INTERVAL_SECONDS` / `DEPLOY_REPO_PAT` | Auto-update sur machine de déploiement (voir `deploy/`) ; le PAT n'est utile que si le repo devient privé |

## L'interface

### Tests (`/`)

Quatre sous-onglets :

- **Liste des tests** — parcours de tous les tests : cartes avec durée de la dernière exécution réussie, environnement (badge couleur), groupes. À droite, menu **Informations** (Métadonnée / Scénario / Captures d'écran) et **File d'exécution**. Renommage (alias) depuis les métadonnées, suppression complète (fichier + scénario + captures + historique), ajout à la file, envoi en correction.
- **Création de tests** (onglet d'arrivée) — flux en deux états. Un nouveau test se crée avec un simple titre ; on rédige d'abord son **scénario** (résultat attendu Gherkin) avec l'assistant IA dédié, puis sa validation **lance automatiquement** la construction du fichier de test par l'IA (exploration du code de l'app via FindSelector, écriture du brouillon, itérations RunTest). Batch Démarrer / Pause / Arrêter. Un test n'est validable que s'il **passe**.
- **File d'exécution** (intégrée à Liste des tests) — exécution séquentielle, play/pause/stop, drag & drop, ajout par groupes, envoi en correction, création de campagne, sortie console en direct (SSE), récap de fin de session.
- **Correction de tests** — les tests échoués (campagnes ou envois manuels) arrivent ici avec leur sortie console. Onglets Console / Éditeur (Monaco) / IA / Captures / Scénario. Batch de correction, badges d'état, validation qui écrit le fichier réel. L'IA de correction peut **proposer une édition du scénario** (bandeau au-dessus du chat) quand la spec ne correspond plus au comportement légitime de l'app ; la validation du scénario réédité relance automatiquement la mise à jour du test.

### Le modèle « scénario = spécification »

Chaque test est adossé à un scénario Gherkin français (« Résultat attendu ») qui fait contrat : toute modification du comportement vérifié passe d'abord par le scénario (assistant dédié, outil `WriteScenarioSpec` exclusif), puis le test est mis en conformité. Les prompts système imposent ce flux.

### Autres pages

- **Campagnes** — exécutions groupées historisées ; les échecs partent en correction en un clic.
- **Groupes** — organisation des tests, couleurs, gestion en masse.
- **Logs** — historique des sessions IA (tokens, appels API, contenu).
- **Environnements** — cibles d'exécution : URL, variables (valeurs jamais exposées aux IA — clés seulement, sorties scrubbées), branche du repo testé pour FindSelector, couleur.
- **Sauvegarde** — `data/versioned/` est un repo git synchronisé/poussé vers `GITHUB_REPO_URL` ; l'onglet montre le diff par catégorie.
- **Configuration** — prompts système des 3 assistants (Correction, Création de test, Scénario). Le prompt de base est **obligatoire et en lecture seule** (accordéon) ; seul un **complément personnalisé** est éditable, ajouté à la fin.

## Les assistants IA

Une **file globale unique** sérialise tous les appels IA (une seule exécution à la fois), avec pause/arrêt par type. Trois assistants, chacun avec ses outils :

| Assistant | Outils | Écrit où |
|-----------|--------|----------|
| Correction | WriteTestFile, ReadDataFile, ListEnvironmentVariables, RunTest, FindSelector, WebFetch, ProposeScenarioEdit | brouillon en mémoire, fichier réel à la validation humaine |
| Création | idem sans ProposeScenarioEdit | idem |
| Scénario | WriteScenarioSpec, ReadDataFile, FindSelector, WebFetch | la spec du scénario uniquement |

Garde-fous : chemins bornés à `data/` (secrets `environments/`, `config/`, `app.db` exclus), WebFetch protégé SSRF (IP privées bloquées post-DNS, allowlist optionnelle), valeurs d'environnement scrubbées des sorties de test, validation humaine avant tout fichier réel.

## Exécution des tests

```bash
npm test                                  # CLI Playwright directe
npx playwright test data/versioned/tests/<nom>.spec.ts
```

Depuis l'UI, les runs passent par le backend ; sous Docker ils s'exécutent sous le compte restreint **`e2erunner`** (sans shell, env minimal, cf. `docker-entrypoint.sh`). Sortie Playwright dans `data/test-results/run/` (vidé/recréé à chaque run).

## Docker

```bash
docker compose up -d --build
```

L'image embarque Node + Chromium ; `data/`, `.env`, `backend/`, `src/` sont bind-mountés. L'entrypoint verrouille `data/` (owner-only) puis ré-ouvre le strict nécessaire à `e2erunner` : lecture des specs, écriture de `screenshots/` et `test-results/`.

### Mise à jour automatique (`deploy/`)

Sur la machine de déploiement : timer systemd qui vérifie `origin/main` (fetch anonyme — repo public ; `DEPLOY_REPO_PAT` en lecture seule à poser dans le `.env` seulement si le repo devient privé) et fait `git pull + compose up -d --build` quand un commit arrive. Cadence via `DEPLOY_UPDATE_INTERVAL_SECONDS`. Installation : voir en-tête de `deploy/auto-update.sh`.

## Structure de `data/`

```
data/
  app.db                # SQLite (aliases, historique runs, logs IA, file IA)
  versioned/            # Repo git de sauvegarde (synchronisé vers GitHub)
    tests/              # Specs Playwright confirmées (*.spec.ts)
    scenarios/          # Scénarios (spec Gherkin + actions) — 1 JSON par test
    groups/  campaigns/
  corrections/          # Brouillons de correction (draft + chat) — 1 JSON par test
  creations/            # Brouillons de création — idem
  testMeta/             # Métadonnées par test (créé le, maj le, dernière exéc…)
  environments/         # Environnements avec valeurs en clair (jamais versionné, jamais lisible par l'IA)
  config/               # Compléments de prompts (prompts.json)
  screenshots/          # Captures des runs (écrites par les tests)
  test-results/run/     # OutputDir Playwright (éphémère)
  testedRepositories/   # Code source de l'app testée par branche (FindSelector)
  actionTest/  pending/ # Listes d'actions, specs en attente
```

## Notes

- Exécution séquentielle (`fullyParallel: false`, `retries: 0`), Chromium uniquement, timeouts d'étape ≤ 10 s imposés par les prompts.
- Nommage des specs : `<domaine>_<type>.spec.ts` (ex. `badge_competences_ia.spec.ts`) ; le titre humain vit dans l'alias.
- `data/` est gitignoré dans ce repo — la sauvegarde des assets de test passe par le repo `data/versioned/`.
