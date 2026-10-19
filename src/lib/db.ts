import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '../generated/prisma/client';

export type Db = PrismaClient;

/** A Prisma client on SQLite. Prisma 7 needs the libsql adapter for every database. */
export function createDb(url = process.env.DATABASE_URL ?? 'file:./dev.db'): Db {
  return new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}
