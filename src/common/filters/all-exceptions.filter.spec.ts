import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from '../exceptions/app.exception';

function buildHost(requestId = 'req_test-123') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = {
    requestId,
    method: 'GET',
    originalUrl: '/api/v1/whatever',
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('formate une HttpException connue avec code/message/requestId', () => {
    const { host, status, json } = buildHost('req_abc');

    filter.catch(new BadRequestException('champ invalide'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'champ invalide',
        requestId: 'req_abc',
      },
    });
  });

  it('ne fuit jamais de détail interne pour une exception non gérée', () => {
    const { host, status, json } = buildHost('req_xyz');

    filter.catch(new Error('leaked stack trace / SQL / secret'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('leaked');
    expect(body.error.requestId).toBe('req_xyz');
  });

  it('agrège les messages de validation (class-validator) en une seule chaîne', () => {
    const { host, json } = buildHost();

    filter.catch(
      new BadRequestException({ message: ['email invalide', 'mot de passe trop court'] }),
      host,
    );

    expect(json.mock.calls[0][0].error.message).toBe(
      'email invalide, mot de passe trop court',
    );
  });

  it('préfère le code métier porté par AppException à un code générique dérivé du statut', () => {
    const { host, json, status } = buildHost('req_custom');

    filter.catch(new AppException('ACCOUNT_LOCKED', 'Compte temporairement verrouillé.', HttpStatus.TOO_MANY_REQUESTS), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'ACCOUNT_LOCKED',
        message: 'Compte temporairement verrouillé.',
        requestId: 'req_custom',
      },
    });
  });
});
