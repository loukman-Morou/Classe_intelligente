# CONTRAT API — CLASSE INTELLIGENTE

**Version : 1.0**

Ce document constitue le contrat entre le **backend** et le **frontend**. Toute modification importante doit être discutée avant d'être implémentée.

---

## 1. Règles générales

**Base URL :**

```text
/api/v1
```

**Authentification :**

```http
Authorization: Bearer <access_token>
```

**Format JSON :**

```json
{
  "data": {}
}
```

**Erreur :**

```json
{
  "error": {
    "code": "CLASS_NOT_FOUND",
    "message": "Classe introuvable",
    "requestId": "req_123"
  }
}
```

Le frontend doit utiliser `error.code` pour gérer les erreurs.

---

# 2. Authentification

```http
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

### Login

```json
{
  "email": "user@email.com",
  "password": "password"
}
```

Réponse :

```json
{
  "data": {
    "user": {
      "id": "usr_123",
      "firstName": "Jean",
      "lastName": "Dupont",
      "email": "user@email.com"
    },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

---

# 3. Classes

### Créer

```http
POST /classes
```

```json
{
  "name": "L2 Informatique",
  "academicYear": "2026-2027",
  "description": "Deuxième année informatique"
}
```

### Autres opérations

```http
GET    /classes
GET    /classes/:classId
PATCH  /classes/:classId
POST   /classes/:classId/archive
POST   /classes/:classId/restore
```

Une classe possède :

```text
id
name
academicYear
description
status
ownerId
createdAt
updatedAt
```

Statuts :

```text
ACTIVE
INACTIVE
ARCHIVED
PENDING_DELETION
DELETED
```

---

# 4. Membres

```http
GET    /classes/:classId/members
DELETE /classes/:classId/members/:userId
```

Les rôles sont :

```text
RESPONSIBLE
PROFESSOR
STUDENT
```

Un utilisateur peut appartenir à plusieurs classes.

---

# 5. Cours

### Créer

```http
POST /classes/:classId/courses
```

```json
{
  "name": "Réseaux",
  "description": "Cours de réseaux informatiques"
}
```

### Autres opérations

```http
GET    /classes/:classId/courses
GET    /courses/:courseId
PATCH  /courses/:courseId
DELETE /courses/:courseId
```

Un cours appartient à **une seule classe**.

---

# 6. Professeurs

Un professeur n'a accès qu'aux cours qui lui sont attribués.

### Créer une invitation

```http
POST /courses/:courseId/invitations
```

Réponse :

```json
{
  "data": {
    "invitationId": "inv_123",
    "url": "https://app.../invite/xxxxx",
    "expiresAt": "2026-08-27T10:00:00Z"
  }
}
```

### Accepter

```http
POST /invitations/:token/accept
```

### Gestion

```http
GET    /courses/:courseId/professors
DELETE /courses/:courseId/professors/:professorId
```

Le lien d'invitation doit être :

* unique ;
* aléatoire ;
* expirant ;
* révocable ;
* utilisable selon la politique choisie.

---

# 7. Documents

### Demander une URL d'upload

```http
POST /courses/:courseId/documents/upload-url
```

```json
{
  "fileName": "chapitre-1.pdf",
  "contentType": "application/pdf",
  "size": 5242880
}
```

Réponse :

```json
{
  "data": {
    "documentId": "doc_123",
    "uploadUrl": "...",
    "expiresAt": "..."
  }
}
```

Le frontend envoie ensuite directement le fichier vers le stockage.

### Finaliser

```http
POST /documents/:documentId/complete
```

### Consulter

```http
GET /documents/:documentId
GET /courses/:courseId/documents
```

### Supprimer

```http
DELETE /documents/:documentId
```

Statuts :

```text
UPLOADED
PROCESSING
READY
FAILED
DELETED
```

---

# 8. IA / Chat

Endpoint principal :

```http
POST /courses/:courseId/chat
```

```json
{
  "message": "Explique-moi le subnetting.",
  "conversationId": null,
  "anonymous": true
}
```

Réponse :

```json
{
  "data": {
    "messageId": "msg_123",
    "conversationId": "conv_123",
    "answer": "Le subnetting consiste à...",
    "sources": [
      {
        "documentId": "doc_123",
        "documentName": "Réseaux chapitre 3",
        "page": 12
      }
    ]
  }
}
```

**Règle fondamentale :**

L'IA doit répondre prioritairement à partir des documents du cours.

Si l'information n'est pas disponible :

```text
Cette information ne figure pas dans les documents disponibles pour ce cours.
```

Le backend doit toujours vérifier :

```text
user → class → course → permission
```

---

# 9. Conversations

```http
GET /courses/:courseId/conversations
GET /conversations/:conversationId
```

Les conversations anonymes ne doivent pas être exposées au professeur avec l'identité de l'étudiant.

---

# 10. Résumés

```http
POST /courses/:courseId/summaries
```

```json
{
  "documentId": "doc_123",
  "scope": "DOCUMENT"
}
```

---

# 11. Quiz

```http
POST /courses/:courseId/quizzes/generate
GET  /courses/:courseId/quizzes
GET  /quizzes/:quizId
```

Exemple :

```json
{
  "numberOfQuestions": 10,
  "type": "MCQ",
  "difficulty": "MEDIUM"
}
```

---

# 12. Radar pédagogique

### Questions fréquentes

```http
GET /courses/:courseId/analytics/questions
```

Réponse :

```json
{
  "data": {
    "totalQuestions": 642,
    "topics": [
      {
        "topic": "Subnetting",
        "questionCount": 47
      },
      {
        "topic": "CIDR",
        "questionCount": 32
      }
    ]
  }
}
```

### Difficultés détectées

```http
GET /courses/:courseId/pedagogical-insights
```

Réponse :

```json
{
  "data": [
    {
      "topic": "Subnetting",
      "severity": "HIGH",
      "questionCount": 47,
      "recommendation": "Ajouter davantage d'exemples."
    }
  ]
}
```

Les données affichées aux professeurs doivent être **agrégées et anonymisées**.

---

# 13. Statistiques

### Professeur

```http
GET /courses/:courseId/statistics
```

### Responsable

```http
GET /classes/:classId/dashboard
```

Exemple :

```json
{
  "data": {
    "students": 87,
    "professors": 6,
    "courses": 8,
    "documents": 124,
    "questions": 3542
  }
}
```

---

# 14. Permissions

Chaque endpoint sensible doit vérifier :

```text
Utilisateur authentifié ?
        ↓
Membre de la classe ?
        ↓
Rôle ?
        ↓
Accès au cours ?
        ↓
Permission ?
        ↓
Autoriser / Refuser
```

Exemple :

```text
Professeur A → Réseaux → OK
Professeur A → Mathématiques → 403
Étudiant A → Classe B → 403
```

**La sécurité doit être contrôlée côté backend.**

Il ne faut jamais faire confiance au frontend.

---

# 15. Codes HTTP

```text
200 → OK
201 → Created
204 → No Content

400 → Bad Request
401 → Unauthorized
403 → Forbidden
404 → Not Found
409 → Conflict
413 → File Too Large
422 → Validation Error
429 → Too Many Requests

500 → Internal Server Error
503 → Service Unavailable
```

---

# 16. Pagination

Pour les listes importantes :

```http
GET /classes/:classId/members?page=1&limit=20
```

Réponse :

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 87,
    "totalPages": 5
  }
}
```

---

# 17. Architecture API

```text
/api/v1
│
├── auth
├── users
├── classes
├── courses
├── invitations
├── documents
├── conversations
├── quizzes
├── analytics
├── pedagogical-insights
└── ...
```

Convention :

```text
GET     /resources
POST    /resources
GET     /resources/:id
PATCH   /resources/:id
DELETE  /resources/:id
```

---

# 18. Règle entre Backend et Frontend

Le backend et le frontend doivent respecter ce contrat.

**Backend :**

* implémente les endpoints ;
* valide les données ;
* contrôle les permissions ;
* documente les réponses ;
* expose Swagger/OpenAPI.

**Frontend :**

* consomme uniquement les endpoints définis ;
* ne fait jamais confiance aux données utilisateur ;
* ne reproduit pas la logique de sécurité du backend ;
* utilise les `error.code` pour gérer les erreurs.

**Swagger/OpenAPI sera la référence technique officielle du contrat API.**

---

## Flux principal de l'application

```text
RESPONSABLE
   │
   ├── Crée classe
   ├── Crée cours
   ├── Ajoute documents
   └── Invite professeur
                │
                ▼
PROFESSEUR
   │
   └── Accède uniquement à son cours
                │
                ▼
ÉTUDIANTS
   │
   ├── Consultent les cours
   ├── Posent des questions à l'IA
   ├── Génèrent résumés/quiz
   └── Posent anonymement des questions
                │
                ▼
        RADAR PÉDAGOGIQUE
                │
                ▼
           PROFESSEUR
                │
                └── Améliore son cours
```

