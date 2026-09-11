import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const schema = readFileSync(schemaPath, 'utf8');

function modelBody(name: string): string | undefined {
  return schema.match(new RegExp(`model\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`))?.[1];
}

describe('SellerBlock Prisma schema', () => {
  it('stores one block per seller account with optional metadata', () => {
    const body = modelBody('SellerBlock');

    expect(body).toBeDefined();
    expect(body).toMatch(/accountId\s+String\s+@id/);
    expect(body).toMatch(/label\s+String\?/);
    expect(body).toMatch(/note\s+String\?/);
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
  });
});
