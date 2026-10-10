/**
 * Re-export vers la version canonique.
 * La logique de RolesGuard vit dans src/auth/guards/roles.guard.ts pour rester
 * colocalisée avec JwtAuthGuard et les types d'autorisation.
 */
export { RolesGuard } from '../../auth/guards/roles.guard';
