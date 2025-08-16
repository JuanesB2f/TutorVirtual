import { PrismaClient } from '@prisma/client'

// Solo crear el cliente en el servidor
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'minimal',
  })
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

// Solo crear el cliente en el servidor
const prisma = process.server 
  ? (globalThis.prismaGlobal ?? prismaClientSingleton())
  : ({} as any)

export default prisma

if (process.env.NODE_ENV !== 'production' && process.server) {
  globalThis.prismaGlobal = prisma
}
