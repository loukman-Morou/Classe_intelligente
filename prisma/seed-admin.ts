/**
 * Script de création du premier compte ADMIN (bootstrap).
 *
 * USAGE :
 *   npx ts-node prisma/seed-admin.ts
 *
 * Variables d'environnement requises (via .env) :
 *   DATABASE_URL
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD   (min 12 chars, majuscule, minuscule, chiffre, spécial)
 *   ADMIN_FIRSTNAME
 *   ADMIN_LASTNAME
 *   MAX_ADMINS       (optionnel, défaut 3)
 *
 * Pour les ADMINs suivants : utiliser POST /admin/users/create-admin
 * (authentifié en tant qu'ADMIN existant).
 *
 * Idempotent : si un ADMIN avec cet email existe déjà, aucune action.
 * Respects le plafond MAX_ADMINS.
 */

import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

function validatePassword(password: string): void {
  const errors: string[] = [];
  if (password.length < 12)                               errors.push('≥ 12 caractères');
  if (!/[A-Z]/.test(password))                            errors.push('1 majuscule');
  if (!/[a-z]/.test(password))                            errors.push('1 minuscule');
  if (!/[0-9]/.test(password))                            errors.push('1 chiffre');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))          errors.push('1 caractère spécial');
  if (errors.length > 0) throw new Error(`Mot de passe invalide. Requis : ${errors.join(', ')}.`);
}

async function main() {
  const email     = process.env.ADMIN_EMAIL;
  const password  = process.env.ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRSTNAME;
  const lastName  = process.env.ADMIN_LASTNAME;
  const maxAdmins = parseInt(process.env.MAX_ADMINS ?? '3', 10);

  if (!email || !password || !firstName || !lastName) {
    throw new Error(
      'Variables manquantes. Requis : ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRSTNAME, ADMIN_LASTNAME.',
    );
  }

  validatePassword(password);

  const prisma = new PrismaClient();

  try {
    // Vérifier le plafond.
    const currentCount = await prisma.user.count({ where: { role: UserRole.ADMIN } });
    if (currentCount >= maxAdmins) {
      console.log(`✗ Plafond atteint (${currentCount}/${maxAdmins} admins). Aucune action.`);
      console.log('  → Pour augmenter le plafond : définir MAX_ADMINS dans .env');
      console.log('  → Pour ajouter un admin : POST /admin/users/create-admin (authentifié)');
      return;
    }

    // Idempotence : vérifier si cet email existe déjà.
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    });

    if (existing) {
      if (existing.role === UserRole.ADMIN) {
        console.log(`✓ Le compte ADMIN ${email} existe déjà. Aucune action.`);
      } else {
        console.error(`✗ L'email ${email} est utilisé par un compte ${existing.role}. Changez ADMIN_EMAIL.`);
        process.exit(1);
      }
      return;
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const admin = await prisma.user.create({
      data: { email, firstName, lastName, passwordHash, role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      select: { id: true, email: true, role: true },
    });

    console.log(`✓ Compte ADMIN créé : ${admin.email} (id: ${admin.id})`);
    console.log(`  Admins actifs : ${currentCount + 1}/${maxAdmins}`);
    if (currentCount + 1 < maxAdmins) {
      console.log(`  → Vous pouvez créer ${maxAdmins - currentCount - 1} admin(s) supplémentaire(s) via /admin/users/create-admin`);
    }
    console.log('  ⚠ Ne partagez jamais ce mot de passe. Changez-le immédiatement en production.');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('✗ Erreur :', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
