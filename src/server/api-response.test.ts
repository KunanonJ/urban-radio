import { describe, expect, test } from 'vitest';

import { jsonError, jsonOk, methodNotAllowed } from './api-response';

describe('jsonOk', () => {
  test('defaults to 200 + JSON content-type', async () => {
    const res = jsonOk({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  test('respects custom status + merges custom headers', () => {
    const res = jsonOk(
      { id: 'x' },
      {
        status: 201,
        headers: { 'X-Test': 'yes' },
      },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('x-test')).toBe('yes');
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
  });
});

describe('jsonError', () => {
  test('emits { error } with the status code', async () => {
    const res = jsonError(404, 'Not found');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('attaches optional details payload', async () => {
    const res = jsonError(400, 'Validation failed', {
      fieldErrors: { name: ['required'] },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { fieldErrors: Record<string, string[]> };
    };
    expect(body.error).toBe('Validation failed');
    expect(body.details.fieldErrors.name).toEqual(['required']);
  });
});

describe('methodNotAllowed', () => {
  test('405 with Allow header listing the methods', () => {
    const res = methodNotAllowed(['GET', 'POST']);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, POST');
  });
});
