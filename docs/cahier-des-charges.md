# CAHIER DES CHARGES

## Plateforme de classe intelligente avec assistant IA pédagogique

**Version : 1.0**

> Document de référence produit (vision, rôles, parcours, MVP). Fourni par le porteur
> du projet. Ne pas modifier son contenu ici — toute divergence entre ce document et
> `backend-architecture.md` / `docs/security.md` / `docs/api-contract.md` doit être
> résolue explicitement (voir PROGRESS.md pour les points ouverts) plutôt que
> silencieusement tranchée par l'implémentation.

---

# 1. Présentation du projet

Le projet consiste à développer une application mobile/web éducative destinée principalement aux étudiants et établissements francophones, avec une priorité donnée au contexte africain.

L'application doit fonctionner exclusivement autour du concept de **classe intelligente**.

Elle ne doit pas être conçue comme une bibliothèque personnelle de documents ou comme un concurrent direct de NotebookLM.

L'unité fondamentale du système est la **classe**.

Chaque classe possède :

* des étudiants ;
* un responsable ;
* un ou plusieurs cours ;
* éventuellement plusieurs professeurs ;
* des documents pédagogiques ;
* une IA capable de répondre aux étudiants à partir des documents autorisés ;
* un système d'analyse permettant d'identifier anonymement les difficultés rencontrées par les étudiants.

Le système doit également permettre aux professeurs d'utiliser les questions posées par les étudiants pour identifier les notions difficiles et améliorer leurs cours.

---

# 2. Vision du produit

Le produit doit créer une boucle pédagogique :

**Professeur → Cours → Étudiants → Questions → IA → Analyse des difficultés → Professeur → Amélioration du cours**

L'application doit donc être à la fois :

1. un espace numérique de classe ;
2. une bibliothèque de cours officielle ;
3. un tuteur IA pour les étudiants ;
4. un outil d'analyse pédagogique pour les professeurs ;
5. un outil de gestion pour le responsable de classe.

---

# 3. Objectifs

## 3.1 Objectif principal

Permettre à une classe de centraliser ses cours et d'utiliser une IA spécialisée dans ces cours, tout en donnant aux professeurs une vision anonymisée des difficultés rencontrées par les étudiants.

## 3.2 Objectifs secondaires

* Simplifier au maximum l'accès aux cours.
* Éviter la dispersion des documents.
* Permettre aux étudiants de poser des questions sans gêne.
* Fournir des réponses basées sur les cours de la classe.
* Permettre aux professeurs d'identifier les notions difficiles.
* Faciliter l'amélioration progressive des cours.
* Limiter la consommation de données.
* Prévoir un fonctionnement partiellement hors connexion.
* Garantir une séparation stricte des données entre classes.
* Permettre une évolution future vers les établissements scolaires et universitaires.

---

# 4. Principe fondamental : la classe est l'unité centrale

Il n'existe pas d'espace personnel de stockage de cours pour l'étudiant.

L'étudiant appartient à une ou plusieurs classes et accède aux cours auxquels il a droit dans ces classes.

Une nouvelle année universitaire doit créer une nouvelle classe. Il ne faut jamais
réutiliser la même classe pour une nouvelle promotion.

---

# 5. Gestion du cycle de vie des classes

```text
ACTIVE → INACTIVE → ARCHIVED → DELETED
```

**ACTIVE** : fonctionnement normal.

**INACTIVE** : aucune activité significative pendant une période configurable
(ex. 90 jours). La classe n'est pas supprimée ; le responsable est notifié.

**ARCHIVED** : lecture seule (plus d'ajout de cours/membres/questions/documents),
données historiques conservées.

**DELETED** : après période de rétention, suppression définitive — annoncée à
l'avance, confirmée si nécessaire, journalisée, irréversible après expiration de la
période de récupération.

Recommandation de rétention (à valider juridiquement/commercialement) :
90 jours → inactive, 180 jours → archivage, 12 à 24 mois après archivage →
suppression possible. Durée configurable par l'administration.

---

# 6. Optimisation du stockage

Distinguer données structurées (classe, utilisateurs, cours, permissions,
statistiques, historique nécessaire) et gros fichiers (PDF, images, scans, OCR).
Lors de l'archivage, les gros fichiers peuvent être déplacés vers un stockage moins
coûteux. Éviter les copies redondantes d'un même fichier.

---

# 7. Rôles

## Responsable de classe

Peut : créer la classe, modifier ses informations, gérer les étudiants, créer les
cours, ajouter les documents, inviter les professeurs, attribuer les professeurs aux
cours, retirer les accès, consulter les statistiques globales, archiver la classe.

## Professeur

Accès limité aux cours qui lui sont attribués (jamais toute la classe). Peut :
consulter son cours, consulter les documents autorisés, ajouter/modifier des
documents selon permissions, consulter les questions fréquentes et difficultés de
son cours, consulter les analyses pédagogiques, éventuellement créer des quiz. Ne
peut pas consulter les données privées individuelles des étudiants.

## Étudiant

Peut : rejoindre une classe, consulter les cours disponibles, lire les documents,
poser des questions à l'IA, demander une explication/un résumé, générer des quiz,
réviser, rechercher une information, poser une question anonymement. Ne possède pas
de bibliothèque personnelle de cours.

---

# 8. Invitation d'un professeur

Le responsable invite un professeur à un cours précis. L'invitation générée doit
être : unique, sécurisée, limitée au cours concerné, éventuellement à usage unique,
avec date d'expiration, révocable par le responsable. Le lien ne donne jamais
directement un accès permanent — il sert uniquement à créer une autorisation.

---

# 9. Permissions

RBAC + permissions au niveau du cours, avec vérification avant chaque accès
sensible : appartenance à la classe → rôle → accès au cours → permission suffisante
→ autoriser/refuser. Un professeur de Réseaux ne doit jamais pouvoir récupérer les
documents de Mathématiques en modifiant un identifiant dans une URL.

---

# 10. Cours

Chaque cours appartient à une seule classe et peut posséder plusieurs professeurs,
documents, conversations IA, statistiques, analyses de difficultés, quiz.

---

# 11. Documents

Formats minimum : PDF, JPG, JPEG, PNG (architecture extensible à d'autres formats).

Flux : Upload → Stockage privé → Analyse → OCR/extraction → Nettoyage → Découpage →
Vectorisation → Indexation → Document disponible.

Statuts : `UPLOADED`, `PROCESSING`, `READY`, `FAILED`.

---

# 12. OCR

Extraction depuis documents imprimés, photographies de cours, scans, notes
manuscrites (si qualité suffisante). Le système doit signaler clairement une
reconnaissance incertaine — ne jamais présenter un texte OCR incertain comme une
vérité absolue.

---

# 13. IA de classe (RAG)

Flux : Question → Identification du contexte → Vérification des permissions →
Recherche dans les documents autorisés → Récupération des passages pertinents → LLM
→ Réponse + Sources. L'IA utilise prioritairement les documents du cours concerné.

## Règle fondamentale

L'IA ne doit jamais prétendre qu'une information vient du cours si elle n'y figure
pas. Si l'information n'est pas trouvée :
> « Cette information ne figure pas dans les documents disponibles pour ce cours. »

Une explication générale reste possible si activée, mais toujours distinguée
clairement du contenu du cours.

## Sources

Chaque réponse importante doit pouvoir afficher les documents utilisés (nom,
chapitre/page), pour que l'étudiant puisse vérifier l'information.

## Fonctionnalités IA étudiant

Question, explication simple/détaillée, résumé, quiz, exercice, révision
interrogative, recherche dans les documents.

---

# 14. Questions anonymes et radar pédagogique

L'étudiant peut poser une question anonymement ; le professeur ne doit pas pouvoir
l'identifier à partir de la question affichée.

Le radar pédagogique analyse les questions pour identifier les thèmes fréquemment
demandés (ex. Subnetting 47, CIDR 32, Broadcast 28, Routage 19) — présentés comme
« questions fréquentes / difficultés détectées », jamais comme une mesure certaine de
la compréhension réelle de chaque étudiant.

## Protection de l'anonymat

Le professeur voit des agrégats (« 47 questions similaires → Subnetting »), jamais
une liste nominative. Les statistiques portant sur un nombre très faible de
participants doivent être protégées contre la ré-identification indirecte.

## Suggestions pédagogiques

L'IA peut produire des suggestions à partir des difficultés détectées, mais ne doit
jamais modifier automatiquement le cours sans validation du professeur.

## Évolution du cours / comparaison avant-après

Le professeur peut faire évoluer son cours (versions successives, historique
conservé). Une comparaison avant/après doit être présentée comme une évolution des
demandes, pas comme une preuve scientifique automatique d'amélioration des
apprentissages.

---

# 15. Tableaux de bord

**Professeur** : cours auxquels il a accès, documents, questions, difficultés, quiz,
statistiques.

**Responsable** : nombre d'étudiants/professeurs, cours, documents, activité
globale, invitations, état de la classe, dernière activité, état de stockage ;
actions : suspendre un membre, retirer un professeur, supprimer un cours, archiver
la classe.

---

# 16. Classes scolaires/universitaires

Une classe est associée à une période (nom, année académique, établissement). Une
nouvelle année crée une nouvelle classe indépendante — les anciens étudiants et
conversations ne sont jamais transférés automatiquement ; les cours peuvent
éventuellement être copiés comme nouvelle version, sans données personnelles ni
historique des anciens étudiants.

---

# 17. Architecture technique

```text
Flutter → NestJS API → PostgreSQL + pgvector → Redis + BullMQ → Object Storage →
OCR/Document Processing → RAG → LLM
```

Backend : NestJS + TypeScript, architecture modulaire (voir
`backend-architecture.md`).

Base de données : PostgreSQL + pgvector — tables principales : `users`, `classes`,
`class_members`, `courses`, `course_professors`, `course_invitations`, `documents`,
`document_chunks`, `conversations`, `messages`, `question_topics`,
`question_analytics`, `pedagogical_insights`, `quizzes`, `notifications`,
`audit_logs` (détail : `docs/database.md`).

Fichiers : jamais dans PostgreSQL — stockage objet privé (S3/Cloudflare
R2/Supabase Storage ou équivalent), PostgreSQL ne garde que les métadonnées.

Traitement asynchrone : Redis + BullMQ pour OCR, extraction PDF, chunking,
embeddings, indexation, génération de quiz, analyse des questions, statistiques,
notifications.

---

# 18. Sécurité

Voir `docs/security.md` (cahier de sécurité dédié, qui fait autorité).

---

# 19. Frontend (Flutter)

Interface adaptée au rôle (Étudiant / Professeur / Responsable), avec des parcours
volontairement simples (l'utilisateur n'a pas besoin de comprendre RAG, embeddings,
OCR, vector database, LLM, tokens).

Fonctionnement optimisé pour connexion faible : minimiser images, téléchargements,
appels API, synchronisations inutiles ; documents consultables hors connexion ;
fonctionnalités nécessitant le serveur (IA) clairement signalées comme telles.

---

# 20. Notifications

**Étudiant** : nouveau cours/document/quiz, annonce du responsable.
**Professeur** : nouveau document, invitation, évolution importante des questions,
nouvelle difficulté fréquente.
**Responsable** : invitation acceptée, classe inactive, problème de traitement d'un
document, expiration prochaine d'une classe.

---

# 21. Journalisation

Audit des actions sensibles : qui, quelle action, sur quelle ressource, quand,
depuis quel contexte (détail : `docs/security.md` §Audit).

---

# 22. Administration globale

Espace séparé pour gérer utilisateurs, classes, établissements, documents,
stockage, consommation IA, erreurs, signalements, classes inactives/archivées,
suppressions programmées. L'administrateur global n'est jamais confondu avec le
responsable d'une classe.

---

# 23. Modèle économique futur

Architecture pensée pour supporter (sans les implémenter en v1) : Gratuit / Premium
/ Classe / Institution, avec limites sur classes, stockage, requêtes IA, étudiants.

---

# 24. Hors périmètre v1

Ne pas intégrer dans la première version : réseau social, messagerie générale,
génération vidéo, podcasts IA, assistant vocal avancé, marketplace, gamification
complexe, système de récompenses, marketplace de cours, espace personnel étudiant,
dizaines de modèles IA.

---

# 25. MVP obligatoire

**Responsable** : création de classe/cours, ajout de documents, gestion des
étudiants, invitation professeur par lien sécurisé.
**Professeur** : acceptation d'invitation, accès à son seul cours, consultation des
documents, questions fréquentes, difficultés détectées.
**Étudiant** : rejoindre une classe, consulter les cours, lire les documents, poser
une question à l'IA (avec réponse basée sur les cours + sources), résumé, quiz,
question anonyme.
**Système** : authentification, RBAC, permissions par cours, OCR, RAG, recherche
vectorielle, stockage privé, statistiques anonymisées, archivage des classes.

## Critère de réussite (scénario de bout en bout)

Responsable crée classe → crée cours "Réseaux" → ajoute un PDF → traitement →
étudiants rejoignent → consultent le cours → posent des questions → l'IA répond avec
sources → questions similaires regroupées anonymement → professeur invité sur
"Réseaux" → accepte → ne voit que "Réseaux" → voit questions fréquentes et
difficultés → améliore son cours → nouvelle version publiée, historique conservé →
en fin d'année, la classe peut être archivée.

---

# 26. Principe de conception final

> Chaque fonctionnalité doit servir la classe, l'apprentissage ou l'amélioration de
> l'enseignement. Si une fonctionnalité ne sert aucun de ces trois objectifs, elle ne
> doit pas être ajoutée simplement parce qu'elle utilise de l'IA.

---

# 27. Principe stratégique

L'application ne cherche pas à remplacer NotebookLM (travail individuel), ChatGPT
(questions générales), Google Drive (stockage générique) ou les LMS complets des
universités. Elle occupe une place spécifique : **la couche intelligente entre le
cours, l'étudiant et le professeur.** C'est cette spécialisation qui guide toute la
conception technique et fonctionnelle.
