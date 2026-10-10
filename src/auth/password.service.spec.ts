import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    service = new PasswordService();
    await service.onModuleInit();
  });

  it('hache un mot de passe puis le vérifie correctement', async () => {
    const hash = await service.hash('un-mot-de-passe-suffisamment-long');
    expect(hash).not.toContain('un-mot-de-passe-suffisamment-long');
    await expect(service.verify(hash, 'un-mot-de-passe-suffisamment-long')).resolves.toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hash = await service.hash('le-bon-mot-de-passe');
    await expect(service.verify(hash, 'un-autre-mot-de-passe')).resolves.toBe(false);
  });

  it('ne lève jamais sur un hash malformé — renvoie false', async () => {
    await expect(service.verify('pas-un-hash-argon2-valide', 'peu-importe')).resolves.toBe(false);
  });

  it('verifyAgainstDecoy renvoie toujours false, quel que soit le mot de passe fourni', async () => {
    await expect(service.verifyAgainstDecoy('nimporte-quoi')).resolves.toBe(false);
  });
});
