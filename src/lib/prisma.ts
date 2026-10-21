import { PrismaClient } from "../../generated/prisma/client";

// 开发模式下热更新会反复重新加载模块，用全局单例避免创建多个数据库连接
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
