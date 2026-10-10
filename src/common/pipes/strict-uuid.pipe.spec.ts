import { BadRequestException } from '@nestjs/common';
import { StrictUuidPipe } from './strict-uuid.pipe';

const pipe = new StrictUuidPipe();

describe('StrictUuidPipe', () => {
  const VALID = [
    '550e8400-e29b-41d4-a716-446655440000',
    'a3bb189e-8bf9-4fba-b2e6-47a2d37cab07',
    'A3BB189E-8BF9-4FBA-B2E6-47A2D37CAB07', // majuscules acceptées
  ];

  const INVALID = [
    '',
    '   ',
    'not-a-uuid',
    '550e8400-e29b-41d4-a716',              // trop court
    '550e8400-e29b-41d4-a716-44665544000Z', // caractère invalide
    '../../etc/passwd',                      // path traversal
    "' OR '1'='1",                           // SQL injection
    '0'.repeat(36),                          // format incorrect
    null as unknown as string,
    undefined as unknown as string,
    { id: 'injection' } as unknown as string,
  ];

  VALID.forEach((uuid) => {
    it(`accepte "${uuid.slice(0, 20)}…"`, () => {
      expect(pipe.transform(uuid)).toBe(uuid.toLowerCase());
    });
  });

  INVALID.forEach((val) => {
    it(`rejette ${JSON.stringify(String(val)).slice(0, 40)}`, () => {
      expect(() => pipe.transform(val as string)).toThrow(BadRequestException);
    });
  });

  it('normalise les UUIDs en minuscules', () => {
    const upper = 'A3BB189E-8BF9-4FBA-B2E6-47A2D37CAB07';
    expect(pipe.transform(upper)).toBe(upper.toLowerCase());
  });

  it('le message d\'erreur ne révèle pas le nom du paramètre (sécurité)', () => {
    try {
      pipe.transform('../../etc/passwd');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const msg = (e as BadRequestException).message;
      expect(msg).not.toContain('classId');
      expect(msg).not.toContain('courseId');
      expect(msg).not.toContain('uuid');
    }
  });
});
