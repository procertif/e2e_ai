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
ANTHROPIC_CLIENT_ID=<client-id OAuth Anthropic>
ANTHROPIC_MODEL=claude-sonnet-4-6
```

## Lancer les tests

```bash
# Tous les tests (CLI Playwright)
npm test

# Un test spécifique
npx playwright test cas1-quiz.spec.ts
```

## Interface web (Test Runner UI)

Un serveur Node.js expose une UI à `http://localhost:3333` pour lancer les tests sans passer par le CLI.

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

### File d'exécution (panneau droit)

- Les tests s'exécutent **séquentiellement** dans l'ordre de la file
- Réorganisation par **drag & drop**
- Chaque test peut être lancé individuellement via son bouton **Lancer**, ou tous d'un coup via **Lancer la file**
- Output Playwright affiché en temps réel dans la carte du test (streaming SSE)
- Statut visuel par carte : `Prêt` / `En cours…` / `Réussi ✓` / `Échoué ✗`
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
- **Instructions globales** : un panneau dépliable permet de définir des consignes appliquées automatiquement à chaque message (ex : *Toujours prendre un screenshot entre chaque action*), persistées en `localStorage`
- **Support images** : possibilité de joindre des captures d'écran au message
- **Historique** : jusqu'à 50 sessions de chat conservées en mémoire
- **Sauvegarde de conversation** : bouton "Sauvegarder" dans le header, ouvre une modale pour nommer le fichier et l'enregistre au format JSON dans `tests/prompt/`

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

## Structure

```
app/                        # Test Runner UI
  server.js                 # Serveur HTTP (Node.js, port 3333)
  index.html / index.css    # Page principale
  screenshots.html / .css   # Visionneuse de screenshots
  groups.html / groups.css  # Gestion des groupes
  scenarios.html / .css     # Scénarios Gherkin + workflow pending
  chat.html / chat.css      # Interface chat IA

tests/                      # Specs Playwright (gitignorées)
  cas1-quiz.spec.ts
  cas2-quiz.spec.ts
  cas3-quiz.spec.ts
  cas4-quiz.spec.ts
  cas1-jury.spec.ts
  prompt/                   # Conversations chat sauvegardées (JSON)

data/                       # Données runtime (gitignorées)
  groups.json               # Groupes persistés
  last-session.json         # Dernière session (écrasé à chaque run)
  run-history.json          # Historique des durées d'exécution
  actionTest/               # Journaux d'actions par test (JSON)
  specs/                    # Specs Gherkin générées (Markdown)

screenshots/                # Captures générées par les tests (gitignorées)
```

## Conventions de nommage des specs

```
<cas>-<type>.spec.ts
```

Exemples : `cas1-quiz.spec.ts`, `cas1-jury.spec.ts`

## Notes

- Les tests ne contiennent pas d'assertions — ils capturent les workflows via screenshots.
- L'authentification utilise un magic code (email + OTP via `TEST_OTP`) et est inlinée dans chaque test.
- L'exécution est séquentielle (`fullyParallel: false`, `retries: 0`).
- Navigateur : Chromium uniquement.
- Les tests, screenshots et données runtime sont gitignorés.
