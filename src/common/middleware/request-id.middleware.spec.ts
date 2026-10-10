import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it("génère un requestId serveur et l'expose en header, sans faire confiance à un header client", () => {
    const middleware = new RequestIdMiddleware();
    const req: any = { headers: { 'x-request-id': 'client-forged-id' } };
    const setHeader = jest.fn();
    const res: any = { setHeader };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).not.toBe('client-forged-id');
    expect(req.requestId.startsWith('req_')).toBe(true);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('génère un requestId différent à chaque appel', () => {
    const middleware = new RequestIdMiddleware();
    const make = () => {
      const req: any = {};
      middleware.use(req, { setHeader: jest.fn() } as any, jest.fn());
      return req.requestId;
    };

    expect(make()).not.toBe(make());
  });
});
