# Procertif — Suite de tests E2E

Suite de tests end-to-end [Playwright](https://playwright.dev/) pour la plateforme de certification [Procertif](https://app.procertif.dev). Les tests couvrent les parcours d'évaluation (quiz) et les workflows jury. L'UI et les tests sont en français.

## Prérequis

- Node.js 18+
- Chromium (installé via Playwright)

```bash
npm install
npx playwright install chromium
```

## Lancer les tests

```bash
# Tous les tests (CLI Playwright)
npm test

# Un test spécifique
npx playwright test 1-cas1-quiz-noai.spec.ts
```

## Interface web (Test Runner UI)

Un serveur Node.js expose une UI à `http://localhost:3333` pour lancer les tests sans passer par le CLI.

```bash
npm run server
```

### Fonctionnalités

#### Tests disponibles (panneau gauche)

- Liste tous les fichiers `*.spec.ts` du dossier `tests/`, avec badge de type (Quiz, Jury, Correction…)
- Recherche en temps réel par nom de test
- Deux onglets : **Tests** (liste individuelle) et **Groupes** (ajout par groupe entier)
- Bouton `+` pour ajouter un test à la file ; `×` pour le retirer

#### File d'exécution (panneau droit)

- Les tests s'exécutent **séquentiellement** dans l'ordre de la file
- Réorganisation par **drag & drop**
- Chaque test peut être lancé individuellement via son bouton **Lancer**, ou tous d'un coup via **Lancer la file**
- Output Playwright affiché en temps réel dans la carte du test (streaming SSE)
- Statut visuel par carte : `Prêt` / `En cours…` / `Réussi ✓` / `Échoué ✗`
- La file est persistée dans le `localStorage` (survit aux rechargements)
- En fin de session : modale récapitulative avec nombre de tests lancés / réussis / échoués, durée totale, liste des échecs, et liens vers les screenshots

#### Groupes (`/groups`)

- Création, renommage et suppression de groupes de tests
- Assignation d'un test à un groupe via une modale de sélection (clic sur le test dans le panneau gauche)
- Gestion en masse via la modale **Gérer les tests** (cases à cocher)
- Chaque groupe est coloré automatiquement et affiche le nombre de tests qu'il contient
- Les groupes sont persistés dans `data/groups.json`

#### Screenshots (`/screenshots`)

- Affiche toutes les captures générées, organisées par test
- Chaque groupe de screenshots est repliable/dépliable
- Recherche par nom de test
- **Lightbox** au clic sur une capture : navigation clavier (←/→), compteur, légende
- Filtrage par session : `?f=all` (tous les tests de la dernière session) ou `?f=failed` (uniquement les tests échoués) — la session est sauvegardée dans `data/last-session.json` et écrasée à chaque run

#### Chat IA (`/chat`)

- Interface de chat intégrée pour interagir avec Claude
- Permet de générer ou modifier des tests via des prompts en langage naturel directement depuis l'UI
- **Instructions globales** : un panneau dépliable permet de définir des consignes appliquées automatiquement à chaque message (ex : *Toujours prendre un screenshot entre chaque action*), persistées en `localStorage`
- **Sauvegarde de conversation** : bouton "Sauvegarder" dans le header, ouvre une modale pour nommer le fichier et l'enregistre au format JSON dans `tests/prompt/`

### URLs

| URL | Description |
|-----|-------------|
| `http://localhost:3333/` | Test runner |
| `http://localhost:3333/screenshots` | Tous les screenshots |
| `http://localhost:3333/screenshots?f=all` | Screenshots de la dernière session |
| `http://localhost:3333/screenshots?f=failed` | Screenshots des tests échoués |
| `http://localhost:3333/groups` | Gestion des groupes |
| `http://localhost:3333/chat` | Chat IA |

## Structure

```
tests/                      # Specs Playwright
  1-cas1-quiz-noai.spec.ts
  1-cas2-quiz-noai.spec.ts
  1-cas3-quiz-noai.spec.ts
  1-cas4-quiz-noai.spec.ts
  2-cas1-jury-noai.spec.ts
  prompt/                   # Conversations chat sauvegardées (JSON)

app/                        # Test Runner UI
  server.js                 # Serveur HTTP (Node.js, port 3333)
  index.html / index.css    # Page principale
  screenshots.html / .css   # Visionneuse de screenshots
  groups.html / groups.css  # Gestion des groupes
  chat.html / chat.css      # Interface chat IA

data/                       # Données runtime (gitignorées)
  groups.json               # Groupes persistés
  last-session.json         # Dernière session (écrasé à chaque run)
  run-history.json          # Historique des durées d'exécution

screenshots/                # Captures générées par les tests (gitignorées)
```

## Conventions de nommage des specs

```
<ordre>-<cas>-<type>-noai.spec.ts
```

Exemples : `1-cas1-quiz-noai.spec.ts`, `2-cas1-jury-noai.spec.ts`

## Notes

- Les tests ne contiennent pas d'assertions — ils capturent les workflows via screenshots.
- L'authentification utilise un magic code (email + OTP `444444`) et est inlinée dans chaque test.
- L'exécution est séquentielle (`fullyParallel: false`, `retries: 0`).
- Navigateur : Chromium uniquement.
- Les screenshots et données runtime sont gitignorées.
