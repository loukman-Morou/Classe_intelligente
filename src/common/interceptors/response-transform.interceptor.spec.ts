import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

describe('ResponseTransformInterceptor', () => {
  const interceptor = new ResponseTransformInterceptor();
  const context = {} as ExecutionContext;

  function handlerReturning(value: unknown): CallHandler {
    return { handle: () => of(value) };
  }

  it('enveloppe un corps de réponse simple dans { data }', (done) => {
    interceptor.intercept(context, handlerReturning({ status: 'ok' })).subscribe((result) => {
      expect(result).toEqual({ data: { status: 'ok' } });
      done();
    });
  });

  it("n'enveloppe pas deux fois un corps qui contient déjà `data`", (done) => {
    interceptor
      .intercept(context, handlerReturning({ data: { status: 'ok' } }))
      .subscribe((result) => {
        expect(result).toEqual({ data: { status: 'ok' } });
        done();
      });
  });

  it('enveloppe aussi les tableaux', (done) => {
    interceptor.intercept(context, handlerReturning([1, 2, 3])).subscribe((result) => {
      expect(result).toEqual({ data: [1, 2, 3] });
      done();
    });
  });
});
