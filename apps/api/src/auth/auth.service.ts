import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '@crmtool/types';
import { now } from '../common/repository.js';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

export class AuthService {
  private readonly users = new Map<string, User>();

  register(tenantId: string, email: string, password: string, role: Role = 'marketer'): User {
    if ([...this.users.values()].some((user) => user.email === email))
      throw new Error('Email already registered');
    const user: User = {
      id: randomUUID(),
      tenantId,
      email,
      passwordHash: hashPassword(password),
      role,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  login(
    email: string,
    password: string,
  ): { accessToken: string; user: Omit<User, 'passwordHash'> } {
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    if (!user || !verifyPassword(password, user.passwordHash))
      throw new Error('Invalid credentials');
    const { passwordHash: _, ...safeUser } = user;
    return {
      accessToken: Buffer.from(
        JSON.stringify({ sub: user.id, tenantId: user.tenantId, role: user.role }),
      ).toString('base64url'),
      user: safeUser,
    };
  }
}

function hashPassword(password: string): string {
  const salt = randomUUID();
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 32));
}
