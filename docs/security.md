# CAHIER DE SÉCURITÉ — CLASSE INTELLIGENTE

**Version 1.0 — Règles obligatoires**

Ce document définit les règles de sécurité que le backend, le frontend, la base de données et l'infrastructure doivent respecter. Toute fonctionnalité nouvelle doit respecter ces règles avant d'être intégrée.

---

## 1. PRINCIPES FONDAMENTAUX

* La sécurité doit être appliquée **côté serveur**. Le frontend ne doit jamais être considéré comme fiable.
* Le principe du **moindre privilège** doit être appliqué partout.
* Chaque utilisateur ne doit accéder qu'aux ressources auxquelles il a explicitement droit.
* Les données d'une classe ne doivent jamais être accessibles depuis une autre classe.
* Les données d'un cours ne doivent jamais être accessibles à un professeur qui n'est pas autorisé sur ce cours.
* Aucun secret, mot de passe, clé API ou token privé ne doit être présent dans le frontend ou dans Git.
* Les erreurs retournées au client ne doivent jamais révéler d'informations internes.
* Toute opération sensible doit pouvoir être auditée.

---

## 2. AUTHENTIFICATION

* Utiliser une authentification moderne basée sur **access token + refresh token**.
* Les mots de passe doivent être hachés avec **Argon2id**.
* Ne jamais stocker de mot de passe en clair.
* Ne jamais utiliser MD5, SHA-1 ou SHA-256 seul pour stocker les mots de passe.
* Imposer une politique de mot de passe raisonnable.
* Mettre en place une limitation des tentatives de connexion.
* Ajouter un mécanisme de protection contre le credential stuffing et le brute force.
* Les access tokens doivent avoir une durée de vie courte.
* Les refresh tokens doivent être rotatifs et révocables.
* Ne jamais mettre de token sensible dans une URL.
* Les tokens doivent être générés avec un générateur cryptographiquement sécurisé.
* Prévoir la révocation des sessions.
* Prévoir la possibilité de déconnecter toutes les sessions d'un utilisateur.
* Si des cookies sont utilisés : `HttpOnly`, `Secure` et politique `SameSite` appropriée.

---

## 3. AUTORISATION ET RBAC

Les rôles minimum sont :

```text
RESPONSIBLE
PROFESSOR
STUDENT
```

Le backend doit vérifier les permissions pour **chaque requête sensible**.

Exemple :

```text
Utilisateur
    ↓
Appartient à la classe ?
    ↓
A accès au cours ?
    ↓
Quel rôle ?
    ↓
Cette action est-elle autorisée ?
```

Un professeur autorisé sur :

```text
Classe A → Réseaux
```

ne doit jamais pouvoir accéder à :

```text
Classe A → Mathématiques
Classe B → Réseaux
```

même en modifiant manuellement l'URL ou l'ID envoyé au backend.

Ne jamais considérer un `classId`, `courseId` ou `userId` fourni par le frontend comme fiable.

---

## 4. PROTECTION IDOR / BOLA

Toutes les ressources doivent être protégées contre les accès directs par identifiant.

Interdit :

```http
GET /api/v1/courses/crs_123
```

sans vérifier que l'utilisateur possède réellement les droits sur `crs_123`.

Le backend doit effectuer les contrôles d'autorisation **avant de retourner la ressource**.

Cette règle s'applique notamment à :

```text
classes
courses
documents
conversations
quizzes
invitations
statistics
analytics
users
```

---

## 5. INVITATIONS PROFESSEURS

Les invitations doivent :

* utiliser des tokens aléatoires cryptographiquement sécurisés ;
* être uniques ;
* avoir une durée d'expiration ;
* pouvoir être révoquées ;
* avoir un nombre d'utilisations contrôlé ;
* être associées à **un seul cours** ;
* ne jamais donner accès à toute la classe ;
* ne jamais contenir d'informations sensibles dans le token ;
* être invalidées après utilisation si l'invitation est à usage unique.

Le backend doit vérifier :

```text
Invitation valide ?
        ↓
Non expirée ?
        ↓
Non révoquée ?
        ↓
Utilisateur autorisé ?
        ↓
Cours toujours actif ?
        ↓
Création de l'accès professeur
```

---

## 6. BASE DE DONNÉES

* PostgreSQL doit être inaccessible directement depuis Internet.
* Seul le backend doit pouvoir communiquer avec la base.
* Utiliser un utilisateur PostgreSQL avec les permissions minimales nécessaires.
* Ne jamais utiliser le compte administrateur PostgreSQL depuis l'application.
* Toutes les requêtes doivent utiliser Prisma/ORM ou des requêtes paramétrées.
* Ne jamais construire des requêtes SQL avec concaténation de données utilisateur.
* Activer les contraintes de clés étrangères.
* Utiliser des transactions pour les opérations critiques.
* Ajouter des index sur les champs fréquemment recherchés.
* Prévoir des sauvegardes automatiques.
* Tester régulièrement la restauration des sauvegardes.
* Chiffrer les sauvegardes contenant des données sensibles.
* Ne jamais stocker de secrets directement dans `schema.prisma`.

---

## 7. ISOLATION DES DONNÉES

Le système doit garantir une isolation stricte :

```text
Classe A
 ├── Étudiants A
 ├── Professeurs A
 ├── Cours A
 └── Documents A

Classe B
 ├── Étudiants B
 ├── Professeurs B
 ├── Cours B
 └── Documents B
```

Aucune requête ne doit pouvoir mélanger les données de deux classes sans autorisation explicite.

Pour le système RAG, la recherche vectorielle doit obligatoirement être filtrée par le contexte autorisé :

```text
classId
courseId
permissions utilisateur
```

---

## 8. SÉCURITÉ DU RAG / IA

L'IA ne doit jamais être considérée comme une source d'autorisation.

Le backend doit contrôler les permissions **avant** la recherche documentaire.

Flux obligatoire :

```text
Question
   ↓
Authentification
   ↓
Autorisation
   ↓
Identification du cours
   ↓
Recherche uniquement dans le cours autorisé
   ↓
Récupération des documents
   ↓
LLM
   ↓
Réponse
```

Ne jamais envoyer au modèle des documents auxquels l'utilisateur n'a pas accès.

Mettre en place une protection contre :

* prompt injection ;
* extraction de données d'autres utilisateurs ;
* tentative de contournement des restrictions ;
* fuite de contenu entre classes ;
* exposition de prompts système ;
* exposition de clés API.

Le modèle ne doit jamais décider :

```text
"Cet utilisateur peut voir ce document."
```

C'est le backend qui décide.

---

## 9. QUESTIONS ANONYMES

Lorsqu'un étudiant active le mode anonyme :

* son identité ne doit pas être affichée au professeur ;
* les statistiques doivent être agrégées ;
* les questions individuelles ne doivent pas permettre une ré-identification facile ;
* éviter d'afficher des statistiques sur des groupes trop petits ;
* les données techniques nécessaires à la sécurité peuvent être conservées séparément avec accès fortement restreint.

L'anonymat présenté à l'utilisateur ne doit donc pas empêcher les mécanismes internes de sécurité et d'audit.

---

## 10. UPLOAD DE FICHIERS

Tous les fichiers doivent être considérés comme **non fiables**.

Obligatoire :

* limiter la taille maximale ;
* limiter les extensions ;
* vérifier réellement le type MIME ;
* vérifier la signature/magic bytes du fichier ;
* renommer les fichiers côté serveur ;
* ne jamais utiliser directement le nom fourni par l'utilisateur comme chemin système ;
* empêcher les path traversal ;
* stocker les fichiers hors du dossier public ;
* analyser les fichiers lorsque nécessaire ;
* ne jamais exécuter un fichier uploadé ;
* empêcher l'upload de fichiers dangereux ;
* appliquer des quotas par utilisateur/classe.

Exemple :

```text
../../../../etc/passwd
```

doit être rejeté.

---

## 11. STOCKAGE

Les documents doivent être stockés dans un stockage privé :

```text
S3 / Cloudflare R2 / équivalent
```

Les fichiers ne doivent pas être publiquement accessibles.

Le frontend doit recevoir des **URLs temporaires/signées** lorsqu'il doit télécharger un fichier.

Ne jamais exposer :

```text
AWS_ACCESS_KEY
AWS_SECRET_KEY
S3 credentials
```

au frontend.

---

## 12. API

Toutes les API doivent :

* utiliser HTTPS en production ;
* utiliser `/api/v1` ;
* valider toutes les entrées ;
* limiter les requêtes ;
* appliquer des quotas ;
* vérifier les permissions ;
* utiliser des réponses d'erreur standardisées ;
* ne jamais retourner de données inutiles ;
* ne jamais exposer les stack traces ;
* ne jamais exposer les requêtes SQL ;
* ne jamais exposer les chemins internes du serveur.

Mettre en place :

```text
Rate limiting
Request validation
CORS strict
Security headers
Request IDs
Timeouts
Payload limits
```

---

## 13. PROTECTION CONTRE LES ATTAQUES WEB

Protéger l'application contre au minimum :

```text
SQL Injection
XSS
CSRF
IDOR / BOLA
Brute Force
Credential Stuffing
Path Traversal
SSRF
Command Injection
File Upload Attacks
Prompt Injection
Data Leakage
Enumeration Attacks
Rate Limit Abuse
```

Utiliser les protections natives de NestJS et de l'infrastructure plutôt que de réinventer les mécanismes de sécurité.

---

## 14. CORS

Ne jamais utiliser en production :

```text
Access-Control-Allow-Origin: *
```

Autoriser uniquement les domaines officiels de l'application.

Exemple :

```text
https://app.classe-intelligente.com
```

---

## 15. SECRETS ET VARIABLES D'ENVIRONNEMENT

Les secrets doivent uniquement être fournis via des variables d'environnement ou un gestionnaire de secrets.

Exemple :

```env
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
OPENAI_API_KEY=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
```

Ne jamais committer :

```text
.env
.env.production
private keys
API keys
database passwords
JWT secrets
```

Le repository doit contenir uniquement :

```text
.env.example
```

avec des valeurs fictives.

---

## 16. LOGS

Les logs ne doivent jamais contenir :

```text
password
accessToken
refreshToken
API key
session cookie
documents privés
questions privées complètes
données personnelles inutiles
```

Les logs doivent contenir suffisamment d'informations pour diagnostiquer un problème :

```text
timestamp
requestId
endpoint
statusCode
userId pseudonymisé si nécessaire
duration
errorCode
```

---

## 17. AUDIT

Les opérations sensibles doivent être enregistrées :

```text
Connexion
Déconnexion
Échec de connexion
Création de classe
Suppression de classe
Invitation professeur
Révocation professeur
Upload document
Suppression document
Modification permissions
Accès administrateur
```

Les logs d'audit doivent être protégés contre leur modification par les utilisateurs ordinaires.

---

## 18. RGPD / DONNÉES PERSONNELLES

Collecter uniquement les données nécessaires.

Prévoir :

```text
Suppression du compte
Export des données
Suppression des données
Gestion du consentement lorsque nécessaire
Politique de conservation
Politique de confidentialité
```

Définir clairement :

```text
Quelles données sont collectées ?
Pourquoi ?
Combien de temps ?
Qui peut les consulter ?
Quand sont-elles supprimées ?
```

Les données des étudiants ne doivent pas être utilisées pour entraîner un modèle externe sans base légale et information/consentement appropriés lorsque requis.

---

## 19. CONSERVATION DES CLASSES INACTIVES

Ne pas supprimer immédiatement une classe inactive.

Utiliser :

```text
ACTIVE
   ↓
INACTIVE
   ↓
ARCHIVED
   ↓
PENDING_DELETION
   ↓
DELETED
```

La suppression doit être précédée d'une période de rétention configurable.

Exemple :

```text
Année scolaire terminée
        ↓
Classe archivée
        ↓
Période de conservation
        ↓
Notification responsable
        ↓
Suppression définitive
```

La suppression doit également supprimer ou anonymiser les données associées selon la politique de conservation.

---

## 20. CHIFFREMENT

Obligatoire :

```text
HTTPS/TLS → communications
Encryption at rest → stockage
Encryption → sauvegardes
```

Les mots de passe doivent être **hachés**, pas chiffrés.

Les secrets nécessitant une récupération doivent être protégés par un gestionnaire de secrets.

---

## 21. FRONTEND

Le frontend ne doit jamais contenir :

```text
DATABASE_URL
JWT_SECRET
OPENAI_API_KEY
S3_SECRET
admin credentials
```

Le frontend doit considérer toutes les données reçues comme potentiellement manipulées.

Ne jamais mettre une permission uniquement dans l'interface :

```text
if (user.role === "PROFESSOR")
```

Cette logique peut améliorer l'UX, mais **l'autorisation réelle doit toujours être vérifiée par le backend**.

---

## 22. INFRASTRUCTURE

En production :

```text
Internet
   ↓
HTTPS / Reverse Proxy
   ↓
API
   ↓
PostgreSQL privé
   ↓
Storage privé
```

Redis/queues doivent également être privés.

Ne pas exposer directement :

```text
PostgreSQL
Redis
Storage
Admin interfaces
```

sur Internet.

---

## 23. TESTS DE SÉCURITÉ

Avant chaque version importante :

```text
Tests unitaires
Tests d'intégration
Tests d'autorisation
Tests API
Tests upload
Tests RAG
Tests de rate limiting
Tests de permissions
```

Tester explicitement :

```text
Étudiant A → données étudiant B
Professeur A → cours professeur B
Professeur → autre classe
Utilisateur non authentifié → API privée
Token expiré → API
Invitation expirée → acceptation
Document supprimé → téléchargement
ID modifié manuellement → accès refusé
```

Tous doivent être refusés.

---

## 24. DÉPENDANCES

* Utiliser uniquement des dépendances nécessaires.
* Maintenir les packages à jour.
* Exécuter régulièrement :

```bash
npm audit
```

* Vérifier les vulnérabilités critiques avant les déploiements.
* Ne pas installer une bibliothèque uniquement parce qu'elle est populaire.
* Verrouiller les versions via le lockfile.

---

## 25. CI/CD

Chaque Pull Request doit idéalement exécuter :

```text
Lint
Type checking
Unit tests
Integration tests
Build
Dependency security scan
```

Aucun code ne doit être fusionné si les tests critiques échouent.

---

## 26. SAUVEGARDES

La base de données doit disposer de sauvegardes automatiques.

Principe :

```text
Backup automatique
        ↓
Stockage séparé
        ↓
Chiffrement
        ↓
Rétention
        ↓
Tests de restauration réguliers
```

Une sauvegarde qui n'a jamais été restaurée/testée ne doit pas être considérée comme fiable.

---

## 27. RÈGLE ABSOLUE POUR LE PROJET

Aucune fonctionnalité ne doit être considérée comme terminée simplement parce qu'elle fonctionne.

Elle doit respecter :

```text
Fonctionnalité
     +
Authentification
     +
Autorisation
     +
Validation
     +
Isolation des données
     +
Protection contre l'abus
     +
Logs/audit si nécessaire
     +
Tests de sécurité
     ↓
VALIDÉE
```

**Objectif final :**

```text
ZERO confiance envers le frontend
ZERO accès implicite
ZERO secret dans Git
ZERO document privé publiquement accessible
ZERO accès inter-classe
ZERO accès professeur hors de son cours
ZERO décision d'autorisation confiée à l'IA
ZERO donnée sensible inutile dans les logs
```


