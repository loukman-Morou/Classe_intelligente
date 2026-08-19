                         ┌───────────────────────┐
                         │       FLUTTER         │
                         │                       │
                         │ Étudiant              │
                         │ Professeur            │
                         │ Responsable           │
                         └───────────┬───────────┘
                                     │
                                     ▼
                           ┌──────────────────┐
                           │    NESTJS API    │
                           └────────┬─────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
      AUTH/RBAC                CLASS DOMAIN               COURSE DOMAIN
          │                         │                         │
          │                    ┌────┴────┐              ┌─────┴─────┐
          │                    │         │              │           │
          │                Students  Professors     Documents   Invitations
          │                                             │
          │                                             ▼
          │                                      Processing Queue
          │                                             │
          │                                      ┌──────┴──────┐
          │                                      ▼             ▼
          │                                     OCR        Extraction
          │                                      │             │
          │                                      └──────┬──────┘
          │                                             ▼
          │                                         Chunking
          │                                             │
          │                                             ▼
          │                                         Embedding
          │                                             │
          ▼                                             ▼
     PostgreSQL ◄────────────────────────────────── pgvector
          │                                             │
          │                                             ▼
          │                                          RAG
          │                                             │
          │                                             ▼
          │                                            LLM
          │                                             │
          │                                  ┌──────────┴──────────┐
          │                                  ▼                     ▼
          │                             Étudiant             Analytics IA
          │                                                        │
          │                                                        ▼
          │                                               Radar pédagogique
          │                                                        │
          └────────────────────────────────────────────────────────┘
                                                                   │
                                                                   ▼
                                                              Professeur